#!/usr/bin/env sh
# Git hook script: pre-commit - Encrypts managed paths before commit.

set -e # Exit on error
# pipefail is intentionally omitted here as the loop might process an empty manifest.

# --- Dependency Checks ---
command -v gpg >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault encrypt): gpg command not found! Aborting commit."; exit 1; }
command -v tar >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault encrypt): tar command not found! Aborting commit."; exit 1; }
command -v git >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault encrypt): git command not found! Aborting commit."; exit 1; }
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
    echo "HOOK Error (git-vault encrypt): Failed to retrieve password from 1Password item '$item_name' in vault '$vault_name'." >&2
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
    echo "HOOK ERROR (git-vault encrypt): Could not locate .git-vault directory from hook execution path." >&2
    exit 1 # Critical to find utils
fi

UTILS_PATH_HOOKS="$GIT_VAULT_DIR_HOOKS/utils.sh"
if [ -f "$UTILS_PATH_HOOKS" ]; then
  # shellcheck source=utils.sh
  . "$UTILS_PATH_HOOKS"
else
  echo "HOOK ERROR (git-vault encrypt): Utility script '$UTILS_PATH_HOOKS' not found." >&2
  exit 1
fi
# --- End Sourcing ---

# --- Environment Setup ---
# Hooks run from the .git directory or repo root depending on Git version.
# Robustly find the repo root.
REPO=$(git rev-parse --show-toplevel) || { echo "HOOK ERROR (git-vault encrypt): Could not determine repository root."; exit 1; }
cd "$REPO" || { echo "HOOK ERROR (git-vault encrypt): Could not change to repository root '$REPO'."; exit 1; }

GIT_VAULT_DIR_CONFIG=".git-vault" # For functions like get_vault_name that expect path from repo root
MANIFEST="$GIT_VAULT_DIR_CONFIG/paths.list"
STORAGE_DIR="$GIT_VAULT_DIR_CONFIG/storage"

# --- Check if Manifest Exists ---
if [ ! -f "$MANIFEST" ]; then
  # echo "HOOK INFO (git-vault encrypt): Manifest '$MANIFEST' not found, nothing to encrypt." >&2
  exit 0 # No manifest, valid state, allow commit.
fi

# --- Process Manifest Entries ---
echo "HOOK: Running git-vault pre-commit encryption..."
EXIT_CODE=0 # Overall exit code for the hook
HAS_ENCRYPTED_ANYTHING=0 # Track if we actually performed any encryption

# Use IFS='' and -r to handle paths with spaces or special characters correctly
while IFS=' ' read -r HASH PATH_IN REST || [ -n "$HASH" ]; do # Process even if last line has no newline
  # Skip comment lines (starting with #) and empty lines
  case "$HASH" in
    '#'*|'') continue ;;
  esac

  # Skip lines not matching the expected format (hash path) - simple check
  if [ -z "$HASH" ] || [ -z "$PATH_IN" ] || [ "${#HASH}" -ne 8 ]; then
      echo "HOOK INFO (git-vault encrypt): Skipping malformed line in $MANIFEST: $HASH $PATH_IN $REST" >&2
      continue
  fi

  PWFILE="$GIT_VAULT_DIR_CONFIG/git-vault-$HASH.pw"
  PWFILE_1P="${PWFILE}.1p" # Marker file for 1Password mode
  # Use tr for consistent slash-to-dash conversion (matching add.sh)
  ARCHIVE_NAME=$(echo "$PATH_IN" | tr '/' '-')
  ARCHIVE="$STORAGE_DIR/$ARCHIVE_NAME.tar.gz.gpg"

  # --- Pre-encryption Checks ---
  # 1. Check if password file exists
  if [ ! -f "$PWFILE" ] && [ ! -f "$PWFILE_1P" ]; then
    echo "HOOK WARN (git-vault encrypt): Neither password file ('$PWFILE') nor 1Password marker ('$PWFILE_1P') found for '$PATH_IN' (hash $HASH). Cannot encrypt this path." >&2
    # EXIT_CODE=1 # Mark failure if this should block commit
    continue # Skip this entry
  fi

  # 2. Check if the plaintext path exists in the working tree
  if [ ! -e "$PATH_IN" ]; then
    # This might be okay if the user intentionally removed the path but forgot to run remove.sh
    # Or it could be an intermediate state during a complex merge/rebase.
    # Let's only warn, as the archive should still be in Git.
    # If the archive is *also* missing, decryption hooks might handle it.
    echo "HOOK INFO (git-vault encrypt): Plaintext path '$PATH_IN' (hash $HASH) not found in working tree. Skipping encryption for this path." >&2
    continue # Skip encryption for this path
  fi

  # 3. Check if the path is actually staged for commit
  # Use git diff --cached --quiet to check if PATH_IN (or anything inside it if dir) is staged
  if git diff --cached --quiet -- "$PATH_IN"; then
    # Path is not staged, no need to re-encrypt
    # echo "HOOK INFO (git-vault encrypt): Path '$PATH_IN' is not staged for commit. Skipping encryption." >&2
    continue
  fi

  # --- Determine Mode and Get Password ---
  PASSWORD=""
  USE_1PASSWORD=false
  if [ -f "$PWFILE_1P" ]; then
    USE_1PASSWORD=true
    # Check 1P status
    if ! check_op_status; then
        echo "HOOK WARN (git-vault encrypt): 1Password CLI issues detected for '$PATH_IN' (hash $HASH). Cannot encrypt." >&2
        # EXIT_CODE=1 # Mark failure if we want to block commit on OP issues
        continue # Skip this entry
    fi
    # Get password from 1Password
    PASSWORD=$(get_op_password "$HASH" "$GIT_VAULT_DIR_CONFIG")
    if [ $? -ne 0 ]; then
        echo "HOOK ERROR (git-vault encrypt): Failed to retrieve password from 1Password for '$PATH_IN' (hash $HASH). Cannot encrypt." >&2
        EXIT_CODE=1 # Definitely block commit if password retrieval fails
        continue # Skip this entry
    fi
    if [ -z "$PASSWORD" ]; then # Should be caught by get_op_password, but double check
        echo "HOOK ERROR (git-vault encrypt): Retrieved empty password from 1Password for '$PATH_IN' (hash $HASH). Cannot encrypt." >&2
        EXIT_CODE=1
        continue
    fi
  elif [ -f "$PWFILE" ]; then
    # File mode - password will be read by gpg via --passphrase-file
    : # No action needed here
  else
    # Neither marker nor password file exists
    echo "HOOK WARN (git-vault encrypt): Neither password file ('$PWFILE') nor 1Password marker ('$PWFILE_1P') found for '$PATH_IN' (hash $HASH). Cannot encrypt this path." >&2
    # EXIT_CODE=1 # Mark failure if this should block commit
    continue # Skip this entry
  fi

  # --- Perform Encryption ---
  echo "HOOK: Encrypting '$PATH_IN' -> '$ARCHIVE' (hash: $HASH)"
  # Use -C to ensure paths inside tarball are relative to repo root
  # Use --yes with gpg in batch mode to avoid prompts
  # Pipe password for 1P mode, use file for file mode
  if $USE_1PASSWORD; then
    # Ensure tar output goes to stdout before piping to gpg
    if ! (tar czf - -C "$REPO" "$PATH_IN" | echo "$PASSWORD" | gpg --batch --yes --passphrase-fd 0 -c -o "$ARCHIVE"); then
        echo "HOOK ERROR (git-vault encrypt): Encryption failed for '$PATH_IN' (hash: $HASH) using 1Password." >&2
        echo "       Check 1Password access and ensure '$PATH_IN' is accessible." >&2
        EXIT_CODE=1 # Mark failure, commit should be aborted
        continue # Try next entry if any
    fi
  else # File mode
    if ! tar czf - -C "$REPO" "$PATH_IN" | gpg --batch --yes --passphrase-file "$PWFILE" -c -o "$ARCHIVE"; then
        echo "HOOK ERROR (git-vault encrypt): Encryption failed for '$PATH_IN' (hash: $HASH) using file '$PWFILE'." >&2
        echo "       Check the password in '$PWFILE' and ensure '$PATH_IN' is accessible." >&2
        EXIT_CODE=1 # Mark failure, commit should be aborted
        continue # Try next entry if any
    fi
  fi

  # --- Stage the Updated Archive ---
  # Add the updated archive to the Git staging area
  git add "$ARCHIVE"
  HAS_ENCRYPTED_ANYTHING=1 # Mark that we did something

done < "$MANIFEST"

# --- Final Hook Exit Status ---
if [ $EXIT_CODE -ne 0 ]; then
  echo "HOOK ERROR (git-vault encrypt): One or more encryptions failed. Aborting commit." >&2
elif [ $HAS_ENCRYPTED_ANYTHING -eq 1 ]; then
  echo "HOOK: git-vault pre-commit encryption finished successfully."
# else
  # echo "HOOK INFO (git-vault encrypt): No paths required encryption."
fi

exit $EXIT_CODE # Exit with 0 if all successes, 1 if any failure
