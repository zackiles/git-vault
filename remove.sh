#!/usr/bin/env sh
set -euo pipefail
# Usage: remove.sh <relative-path>

# --- 1Password Helper Functions ---
# Duplicated from install.sh as we are not creating a separate helper file.

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

  echo "Attempting to read password from 1Password item '$item_name' in vault '$vault_name'..." >&2

  # Get password field from the item
  # Use op read OP_VAULT/${item_name}/password ? Simpler: op item get --fields password
  local password
  password=$(op item get "$item_name" --vault "$vault_name" --fields password 2>/dev/null)
  local op_exit_code=$?

  if [ $op_exit_code -ne 0 ] || [ -z "$password" ]; then
    echo "Error: Failed to retrieve password from 1Password item '$item_name' in vault '$vault_name'." >&2
    echo "       Check item name, vault name, permissions, and sign-in status." >&2
    return 1
  fi

  echo "$password"
  return 0
}

# Mark item as removed in 1Password (don't actually delete)
mark_op_item_removed() {
  local hash="$1"
  local vault_name
  local project_name
  local item_name

  vault_name=$(get_vault_name)
  project_name=$(get_project_name)
  item_name="git-vault-${project_name}-${hash}"

  echo "Attempting to mark 1Password item '$item_name' as removed in vault '$vault_name'..." >&2

  # Update the status field to "removed"
  if op item edit "$item_name" --vault "$vault_name" "status=removed" >/dev/null; then
      echo "Successfully marked 1Password item '$item_name' as removed." >&2
      return 0
  else
      echo "Error: Failed to mark 1Password item '$item_name' as removed." >&2
      echo "       Check item name, vault name, permissions, and sign-in status." >&2
      return 1
  fi
}
# --- End 1Password Helper Functions ---

# --- Get Script Directory and Source Utils ---
GIT_VAULT_DIR_REMOVE=$(dirname "$0") # Specific name to avoid conflict if sourced script uses same name
UTILS_PATH_REMOVE="$GIT_VAULT_DIR_REMOVE/utils.sh"
if [ -f "$UTILS_PATH_REMOVE" ]; then
  # shellcheck source=utils.sh
  . "$UTILS_PATH_REMOVE"
else
  echo "Error (git-vault remove): Utility script '$UTILS_PATH_REMOVE' not found." >&2
  exit 1
fi
# --- End Sourcing ---

# --- Dependency Checks ---
command -v gpg >/dev/null 2>&1 || { echo >&2 "Error: gpg is required but not installed. Aborting."; exit 1; }
SHASUM_CMD="sha1sum"
if ! command -v sha1sum >/dev/null 2>&1; then
    if command -v shasum >/dev/null 2>&1; then
        SHASUM_CMD="shasum -a 1"
    else
        echo >&2 "Error: sha1sum or shasum (for SHA1) is required but not found. Aborting."
        exit 1
    fi
fi
command -v sed >/dev/null 2>&1 || { echo >&2 "Error: sed is required but not installed. Aborting."; exit 1; }
# --- End Dependency Checks ---

# --- Argument Validation ---
if [ -z "${1:-}" ]; then
    echo "Usage: $0 <relative-path-to-file-or-dir>" >&2
    exit 1
fi
PATH_IN=$1
# Remove any trailing slash from input for consistency before hashing
PATH_IN="${PATH_IN%/}"

# --- Environment Setup ---
REPO=$(git rev-parse --show-toplevel)
cd "$REPO" || { echo "Error: Could not change directory to repo root '$REPO'."; exit 1; }
# GIT_VAULT_DIR=".git-vault" # Use GIT_VAULT_DIR_REMOVE from sourcing logic
STORAGE_DIR="$GIT_VAULT_DIR_REMOVE/storage"
MANIFEST="$GIT_VAULT_DIR_REMOVE/paths.list"
GITIGNORE_FILE=".gitignore"

# --- Hash and File Paths ---
# Ensure manifest exists before trying to read it
if [ ! -f "$MANIFEST" ]; then
    echo "Error: Manifest file '$MANIFEST' not found. Cannot remove path."
    exit 1
fi

HASH=$(printf "%s" "$PATH_IN" | $SHASUM_CMD | cut -c1-8)
# Add trailing slash back if it was a directory originally (based on manifest)
# This is needed for the IGNORE_PATTERN check later
original_path_in_manifest=$(grep "^$HASH " "$MANIFEST" | sed -E "s/^$HASH //" || true)
case "$original_path_in_manifest" in
    */) PATH_IN_FOR_IGNORE="${PATH_IN}/" ;; # Add slash back for ignore pattern
    *) PATH_IN_FOR_IGNORE="$PATH_IN" ;; # It was a file
esac

PWFILE="$GIT_VAULT_DIR_REMOVE/git-vault-$HASH.pw"
PWFILE_1P="${PWFILE}.1p" # Marker file for 1Password mode
# Use tr for consistent slash-to-dash conversion (matching add.sh)
ARCHIVE_NAME=$(echo "$original_path_in_manifest" | tr '/' '-')
ARCHIVE="$STORAGE_DIR/$ARCHIVE_NAME.tar.gz.gpg"

# --- Check if Managed ---
echo "Checking status of '$PATH_IN'..."
if ! grep -q "^$HASH " "$MANIFEST"; then
    echo "Error: '$PATH_IN' (hash $HASH) is not currently managed by git-vault according to '$MANIFEST'."
    exit 1
fi

# Determine mode based on marker file existence
USE_1PASSWORD=false
if [ -f "$PWFILE_1P" ]; then
  USE_1PASSWORD=true
  echo "Detected 1Password mode for this path (marker file exists)."
elif [ ! -f "$PWFILE" ]; then # If no marker AND no pw file, it's an error
  echo "Error: Neither password file ('$PWFILE') nor 1Password marker ('$PWFILE_1P') found for '$PATH_IN'." >&2
  echo "       Cannot verify password or proceed with removal." >&2
  exit 1
fi

# --- Verify Password ---
STORED_PASSWORD=""
if $USE_1PASSWORD; then
  echo "Verifying password via 1Password for '$PATH_IN'..."
  if ! check_op_status; then
    echo "Error: 1Password CLI issues detected. Aborting removal." >&2
    exit 1
  fi
  STORED_PASSWORD=$(get_op_password "$HASH" "$GIT_VAULT_DIR_REMOVE")
  if [ $? -ne 0 ]; then
      echo "Error: Failed to retrieve password from 1Password. Aborting removal." >&2
      exit 1
  fi
else
  echo "Verifying password via local file for '$PATH_IN'..."
  # Password verification for file mode happens via gpg decryption attempt below
fi

# Attempt decryption to /dev/null to check the password
# For 1Password mode, we pipe the retrieved password
# For file mode, we use the passphrase file
echo "Attempting GPG decryption test..."
if $USE_1PASSWORD; then
  if ! echo "$STORED_PASSWORD" | gpg --batch --yes --passphrase-fd 0 -d "$ARCHIVE" > /dev/null 2>&1; then
    echo "Error: Password verification failed using 1Password credential for archive '$ARCHIVE'." >&2
    echo "       The password in 1Password might be incorrect or the archive corrupted. Aborting removal." >&2
    exit 1
  fi
else
  if ! gpg --batch --yes --passphrase-file "$PWFILE" -d "$ARCHIVE" > /dev/null 2>&1; then
    echo "Error: Password verification failed using '$PWFILE' for archive '$ARCHIVE'." >&2
    echo "       Please check the password file content. Aborting removal." >&2
    exit 1
  fi
fi

# --- Perform Removal Steps --- #
echo "Proceeding with removal..."

# 1. Remove from manifest
echo " - Removing entry from manifest '$MANIFEST'..."
# Use temp file and mv for POSIX-compliant in-place edit
sed "/^$HASH /d" "$MANIFEST" > "$MANIFEST.tmp"
mv "$MANIFEST.tmp" "$MANIFEST"

# 2. Rename/Remove password file or marker file
if $USE_1PASSWORD; then
  echo " - Marking 1Password item as removed..."
  if ! mark_op_item_removed "$HASH" "$GIT_VAULT_DIR_REMOVE"; then
      echo "Error: Failed to mark 1Password item as removed. Continuing with local cleanup." >&2
      # Don't exit, allow local file cleanup to proceed, but warn user
  fi
  echo " - Removing 1Password marker file '$PWFILE_1P'..."
  rm -f "$PWFILE_1P"
else
  REMOVED_PWFILE="${PWFILE%.pw}.removed"
  echo " - Renaming password file to '$REMOVED_PWFILE'..."
  mv "$PWFILE" "$REMOVED_PWFILE"
fi

# 3. Remove archive from Git index (if tracked) and filesystem
echo " - Removing archive file '$ARCHIVE' from Git index and filesystem..."
# --ignore-unmatch prevents error if the file isn't tracked
git rm --cached --ignore-unmatch "$ARCHIVE" > /dev/null
rm -f "$ARCHIVE"

# 4. Offer to remove from .gitignore
echo " - Checking '$GITIGNORE_FILE' for ignore rule..."

# PATH_IN should already have a trailing slash if it's a directory, based on how it was added.
# We form the pattern exactly as add.sh would:
IGNORE_PATTERN="/$PATH_IN_FOR_IGNORE"

# Check if the ignore pattern exists in .gitignore
# Use grep -x for exact line match
if grep -qx "$IGNORE_PATTERN" "$GITIGNORE_FILE"; then
    printf "Remove '%s' from %s? [y/N]: " "$IGNORE_PATTERN" "$GITIGNORE_FILE"
    read -r response || true # Add || true to handle potential read errors
    echo # Add newline after read
    if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
        echo "   Removing '$IGNORE_PATTERN' from $GITIGNORE_FILE..."
        # Use temp file and mv for POSIX-compliant in-place edit
        sed "\|^$IGNORE_PATTERN$|d" "$GITIGNORE_FILE" > "$GITIGNORE_FILE.tmp"
        mv "$GITIGNORE_FILE.tmp" "$GITIGNORE_FILE"

        # Check if manifest is now empty and remove generic patterns if so
        if [ -r "$MANIFEST" ]; then
            remaining_paths_count=$(grep -cE '^[a-f0-9]{8} ' "$MANIFEST" || true)
        else
            remaining_paths_count=0
        fi
        if [ "$remaining_paths_count" -eq 0 ]; then
            echo "   Manifest is now empty. Removing generic password ignore pattern..."
            PW_IGNORE_PATTERN="$GIT_VAULT_DIR_REMOVE/*.pw"
            # This is the comment typically added by install.sh
            PW_COMMENT_LINE="# Git-Vault password files (DO NOT COMMIT)"
            PW_1P_IGNORE_PATTERN="$GIT_VAULT_DIR_REMOVE/*.pw.1p"
            PW_1P_COMMENT_LINE="# Git-Vault 1Password marker files (DO NOT COMMIT)"

            # Robust alternative: Use grep -v to filter lines and overwrite
            temp_gitignore=$(mktemp)
            (
              grep -vxF "$PW_COMMENT_LINE" "$GITIGNORE_FILE" | \
              grep -vxF "$PW_IGNORE_PATTERN" | \
              grep -vxF "$PW_1P_COMMENT_LINE" | \
              grep -vxF "$PW_1P_IGNORE_PATTERN"
            ) > "$temp_gitignore"
            mv "$temp_gitignore" "$GITIGNORE_FILE"
        fi

        echo "   Staging updated $GITIGNORE_FILE..."
        git add "$GITIGNORE_FILE"
    else
        echo "   Keeping '$IGNORE_PATTERN' in $GITIGNORE_FILE."
    fi
else
    echo "   Ignore pattern '$IGNORE_PATTERN' not found in $GITIGNORE_FILE."
fi

# --- Completion Message ---
echo ""
echo "Success: '$PATH_IN' has been unmanaged from git-vault."
echo "  - Entry removed from '$MANIFEST'."
if $USE_1PASSWORD; then
    echo "  - 1Password item marked as removed."
    echo "  - 1Password marker file '$PWFILE_1P' removed."
else
    echo "  - Password file renamed to '$REMOVED_PWFILE'."
fi
echo "  - Archive '$ARCHIVE' removed from Git and filesystem."
echo "  - '$GITIGNORE_FILE' checked (and possibly updated)."
echo ""
echo "Please commit the changes made to:"
echo "  - $MANIFEST"
echo "  - $GITIGNORE_FILE (if modified)"
echo "  - Any removal of '$ARCHIVE' tracked by Git."
echo ""
echo "The original plaintext path '$PATH_IN' remains in your working directory."
if $USE_1PASSWORD; then
    echo "The password item in 1Password was marked as 'removed' but not deleted."
else
    echo "The password file was renamed to '$REMOVED_PWFILE' for potential recovery."
fi

exit 0
