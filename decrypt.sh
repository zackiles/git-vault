#!/usr/bin/env sh
# Git hook script: post-checkout / post-merge - Decrypts managed paths after checkout/merge.

set -eu # Exit on error, treat unset variables as error.
# pipefail is intentionally omitted here as the loop might process an empty manifest.

# --- Dependency Checks ---
command -v gpg >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault decrypt): gpg command not found! Decryption skipped."; exit 0; } # Don't block hook chain
command -v tar >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault decrypt): tar command not found! Decryption skipped."; exit 0; } # Don't block hook chain
command -v git >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault decrypt): git command not found! Decryption skipped."; exit 0; } # Don't block hook chain
command -v mkdir >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault decrypt): mkdir command not found! Decryption skipped."; exit 0; }
command -v rm >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault decrypt): rm command not found! Decryption skipped."; exit 0; }
# --- End Dependency Checks ---

# --- 1Password Helper Functions ---
# Duplicated from install.sh as needed.

# Check if 1Password CLI is available and properly signed in
check_op_status() {
  # Check if op command exists
  if ! command -v op >/dev/null 2>&1; then
    echo "Error: 1Password CLI 'op' not found. Install it from https://1password.com/downloads/command-line/" >&2
    return 1
  fi

  # Check if user is signed in
  if ! op whoami >/dev/null 2>&1; then
    echo "Error: Not signed in to 1Password CLI. Sign in with: op signin" >&2
    return 1
  fi

  return 0
}

# Get Git-Vault vault name (reads from config file)
get_vault_name() {
  local vault_file=".git-vault/1password-vault"

  if [ -f "$vault_file" ]; then
    cat "$vault_file"
  else
    echo "Git-Vault" # Default vault name
  fi
}

# Get project name for item naming (relative to current repo)
get_project_name() {
  local project_name
  project_name=$(git remote get-url origin 2>/dev/null | sed -E 's|^.*/([^/]+)(\\.git)?$|\\1|' || true)
  if [ -z "$project_name" ]; then
    project_name=$(basename "$(git rev-parse --show-toplevel)")
  fi
  echo "$project_name"
}

# Get password from 1Password
get_op_password() {
  local hash="$1"
  local vault_name
  local project_name
  local item_name

  vault_name=$(get_vault_name)
  project_name=$(get_project_name)
  item_name="git-vault-${project_name}-${hash}"

  # Get password field from the item
  local password
  password=$(op item get "$item_name" --vault "$vault_name" --fields password 2>/dev/null)
  local op_exit_code=$?

  if [ $op_exit_code -ne 0 ] || [ -z "$password" ]; then
    echo "HOOK Error (git-vault decrypt): Failed to retrieve password from 1Password item '$item_name' in vault '$vault_name'." >&2
    echo "       Check item name, vault name, permissions, and sign-in status." >&2
    return 1 # Indicate failure
  fi

  echo "$password"
  return 0 # Indicate success
}
# --- End 1Password Helper Functions ---

# --- Get Script Directory (relative to .git or repo root) & Source Utils ---
# Hooks can run from .git/hooks or a custom hooks dir. We need to find .git-vault from there.

# Heuristic to find GIT_VAULT_DIR from hook
# This assumes .git-vault is at the repo root.
if [ -d ".git-vault" ]; then # Likely running from repo root (e.g. custom hook path set to root)
    GIT_VAULT_DIR_HOOKS=".git-vault"
elif [ -d "../../.git-vault" ]; then # Likely running from .git/hooks
    GIT_VAULT_DIR_HOOKS="../../.git-vault"
elif [ -d "../.git-vault" ]; then # Could be another custom hook depth
    GIT_VAULT_DIR_HOOKS="../.git-vault"
else
    echo "HOOK ERROR (git-vault decrypt): Could not locate .git-vault directory from hook execution path." >&2
    exit 0 # Don't block hook chain for utils path issue
fi

UTILS_PATH_HOOKS="$GIT_VAULT_DIR_HOOKS/utils.sh"
if [ -f "$UTILS_PATH_HOOKS" ]; then
  # shellcheck source=utils.sh
  . "$UTILS_PATH_HOOKS"
else
  echo "HOOK ERROR (git-vault decrypt): Utility script '$UTILS_PATH_HOOKS' not found. Skipping decryption." >&2
  exit 0 # Don't block hook chain
fi
# --- End Sourcing ---

# --- Environment Setup ---
# Hooks run from the .git directory or repo root depending on Git version.
# Robustly find the repo root.
REPO=$(git rev-parse --show-toplevel) || { echo "HOOK ERROR (git-vault decrypt): Could not determine repository root."; exit 0; } # Don't block hook chain
cd "$REPO" || { echo "HOOK ERROR (git-vault decrypt): Could not change to repository root '$REPO'."; exit 0; }

GIT_VAULT_DIR_CONFIG=".git-vault" # For functions like get_vault_name that expect path from repo root
MANIFEST="$GIT_VAULT_DIR_CONFIG/paths.list"
STORAGE_DIR="$GIT_VAULT_DIR_CONFIG/storage"

# --- Check if Manifest Exists ---
if [ ! -f "$MANIFEST" ]; then
  # This is normal if the tool hasn't been used yet.
  # echo "HOOK INFO (git-vault decrypt): Manifest '$MANIFEST' not found, nothing to decrypt." >&2
  exit 0 # No manifest, valid state, continue hook chain.
fi

# --- Process Manifest Entries ---
echo "HOOK: Running git-vault post-checkout/post-merge decryption..."
HAS_DECRYPTED_ANYTHING=0 # Track if we actually performed any decryption

# Use IFS='' and -r to handle paths with spaces or special characters correctly
while IFS=' ' read -r HASH PATH_IN REST || [ -n "$HASH" ]; do # Process even if last line has no newline
  # Skip comment lines (starting with #) and empty lines
  case "$HASH" in
    '#'*|'') continue ;;
  esac

  # Skip lines not matching the expected format (hash path) - simple check
  if [ -z "$HASH" ] || [ -z "$PATH_IN" ] || [ "${#HASH}" -ne 8 ]; then
      echo "HOOK INFO (git-vault decrypt): Skipping malformed line in $MANIFEST: $HASH $PATH_IN $REST" >&2
      continue
  fi

  PWFILE="$GIT_VAULT_DIR_CONFIG/git-vault-$HASH.pw"
  PWFILE_1P="${PWFILE}.1p" # Marker file for 1Password mode
  # Use tr for consistent slash-to-dash conversion (matching add.sh)
  ARCHIVE_NAME=$(echo "$PATH_IN" | tr '/' '-')
  ARCHIVE="$STORAGE_DIR/$ARCHIVE_NAME.tar.gz.gpg"
  TARGET_PATH="$REPO/$PATH_IN"

  # --- Determine Mode and Check Password Availability ---
  PASSWORD=""
  USE_1PASSWORD=false
  if [ -f "$PWFILE_1P" ]; then
    USE_1PASSWORD=true
    # Check 1P status
    if ! check_op_status; then
        echo "HOOK INFO (git-vault decrypt): 1Password CLI issues detected for '$PATH_IN' (hash $HASH). Skipping decryption." >&2
        continue # Skip this entry
    fi
    # Get password from 1Password
    PASSWORD=$(get_op_password "$HASH" "$GIT_VAULT_DIR_CONFIG")
    if [ $? -ne 0 ] || [ -z "$PASSWORD" ]; then
        echo "HOOK INFO (git-vault decrypt): Failed to retrieve password from 1Password for '$PATH_IN' (hash $HASH). Skipping decryption." >&2
        continue # Skip this entry
    fi
  elif [ -f "$PWFILE" ]; then
    # File mode - password file exists
    : # No action needed here
  else
    # Neither marker nor password file exists
    echo "HOOK INFO (git-vault decrypt): Neither password file ('$PWFILE') nor 1Password marker ('$PWFILE_1P') found for '$PATH_IN' (hash $HASH). Skipping decryption for this path." >&2
    continue # Skip this entry
  fi

  # --- Pre-decryption Checks ---
  # 1. Check if the archive file exists
  if [ ! -f "$ARCHIVE" ]; then
    echo "HOOK INFO (git-vault decrypt): Archive file '$ARCHIVE' for '$PATH_IN' (hash $HASH) missing. Skipping decryption for this path." >&2
    # This can happen legitimately if the vault was just added but not committed/pulled yet,
    # or if there was a merge conflict involving the archive.
    continue # Skip this entry
  fi

  # --- Ensure Target Directory Exists and Prepare for Extraction ---
  TARGET_DIR=$(dirname "$TARGET_PATH")
  # Create parent directories if they don't exist
  if ! mkdir -p "$TARGET_DIR"; then
      echo "HOOK ERROR (git-vault decrypt): Failed to create parent directory '$TARGET_DIR' for '$PATH_IN'. Skipping decryption." >&2
      continue
  fi

  # Remove existing plaintext path *if it exists* before extracting.
  # This is crucial to avoid merging old/new content if extraction fails midway
  # or if the type changed (e.g., file to directory).
  if [ -e "$TARGET_PATH" ]; then
      echo "HOOK INFO (git-vault decrypt): Removing existing '$TARGET_PATH' before decryption."
      if ! rm -rf "$TARGET_PATH"; then
          echo "HOOK ERROR (git-vault decrypt): Failed to remove existing '$TARGET_PATH'. Skipping decryption." >&2
          continue
      fi
  fi

  # --- Perform Decryption and Extraction ---
  echo "HOOK: Decrypting '$ARCHIVE' -> '$PATH_IN' (hash: $HASH)"
  # Decrypt and extract. Use --yes for batch mode.
  # Extract relative to the REPO root (-C "$REPO").
  # Pipe password for 1P mode, use file for file mode
  if $USE_1PASSWORD; then
    if ! echo "$PASSWORD" | gpg --batch --yes --passphrase-fd 0 -d "$ARCHIVE" | tar xzf - -C "$REPO"; then
      echo "HOOK ERROR (git-vault decrypt): Decryption or extraction failed for '$PATH_IN' (hash: $HASH) using 1Password." >&2
      echo "       Check 1Password credential, archive integrity ('$ARCHIVE'), and permissions." >&2
      # Don't abort the entire hook chain, as other decryptions might succeed.
      # The target path might be missing or incomplete after a failure.
    else
        HAS_DECRYPTED_ANYTHING=1 # Mark that we successfully decrypted something
    fi
  else # File mode
    if ! gpg --batch --yes --passphrase-file "$PWFILE" -d "$ARCHIVE" | tar xzf - -C "$REPO"; then
      echo "HOOK ERROR (git-vault decrypt): Decryption or extraction failed for '$PATH_IN' (hash: $HASH) using file '$PWFILE'." >&2
      echo "       Check the password in '$PWFILE', the archive integrity ('$ARCHIVE'), and permissions." >&2
      # Don't abort the entire hook chain, as other decryptions might succeed.
      # The target path might be missing or incomplete after a failure.
    else
        HAS_DECRYPTED_ANYTHING=1 # Mark that we successfully decrypted something
    fi
  fi

done < "$MANIFEST"

# --- Final Hook Completion Message ---
if [ $HAS_DECRYPTED_ANYTHING -eq 1 ]; then
    echo "HOOK: git-vault post-checkout/post-merge decryption finished."
# else
    # echo "HOOK INFO (git-vault decrypt): No paths required decryption."
fi

exit 0 # Hooks should generally exit 0 unless there's a catastrophic failure that needs to block Git.
