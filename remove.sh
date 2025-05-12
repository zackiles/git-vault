#!/usr/bin/env sh
set -euo pipefail
# Usage: remove.sh <relative-path>

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

# --- Environment Setup ---
REPO=$(git rev-parse --show-toplevel)
cd "$REPO" || { echo "Error: Could not change directory to repo root '$REPO'."; exit 1; }
GIT_VAULT_DIR="git-vault"
STORAGE_DIR="storage"
MANIFEST="$GIT_VAULT_DIR/paths.list"
GITIGNORE_FILE=".gitignore"

# --- Hash and File Paths ---
# Ensure manifest exists before trying to read it
if [ ! -f "$MANIFEST" ]; then
    echo "Error: Manifest file '$MANIFEST' not found. Cannot remove path."
    exit 1
fi

HASH=$(printf "%s" "$PATH_IN" | $SHASUM_CMD | cut -c1-8)
PWFILE="$GIT_VAULT_DIR/git-vault-$HASH.pw"
# Use tr for consistent slash-to-dash conversion (matching add.sh)
ARCHIVE_NAME=$(echo "$PATH_IN" | tr '/' '-')
ARCHIVE="$STORAGE_DIR/$ARCHIVE_NAME.tar.gz.gpg"

# --- Check if Managed ---
echo "Checking status of '$PATH_IN'..."
if ! grep -q "^$HASH " "$MANIFEST"; then
    echo "Error: '$PATH_IN' (hash $HASH) is not currently managed by git-vault according to '$MANIFEST'."
    exit 1
fi
if [ ! -f "$PWFILE" ]; then
    echo "Error: Password file '$PWFILE' for '$PATH_IN' is missing." >&2
    echo "       Cannot verify password or proceed with removal without it." >&2
    exit 1
fi
# Archive might legitimately not exist if it hasn't been committed/pushed yet,
# but we need it for password verification.
if [ ! -f "$ARCHIVE" ]; then
    echo "Error: Archive file '$ARCHIVE' for '$PATH_IN' is missing." >&2
    echo "       Cannot verify password or proceed with removal without it." >&2
    exit 1
fi

# --- Verify Password ---
echo "Verifying password for '$PATH_IN'..."
# Attempt decryption to /dev/null to check the password
if ! gpg --batch --yes --passphrase-file "$PWFILE" -d "$ARCHIVE" > /dev/null 2>&1; then
  echo "Error: Password verification failed using '$PWFILE' for archive '$ARCHIVE'." >&2
  echo "       Please check the password file content. Aborting removal." >&2
  exit 1
fi
echo "Password verified successfully."

# --- Perform Removal Steps --- #
echo "Proceeding with removal..."

# 1. Remove from manifest
echo " - Removing entry from manifest '$MANIFEST'..."
# Use sed -i for in-place edit. Provide backup extension (.bak) for safety.
sed -i.bak "/^$HASH /d" "$MANIFEST"
rm -f "$MANIFEST.bak" # Clean up backup file on success

# 2. Rename password file
REMOVED_PWFILE="${PWFILE%.pw}.removed"
echo " - Renaming password file to '$REMOVED_PWFILE'..."
mv "$PWFILE" "$REMOVED_PWFILE"

# 3. Remove archive from Git index (if tracked) and filesystem
echo " - Removing archive file '$ARCHIVE' from Git index and filesystem..."
# --ignore-unmatch prevents error if the file isn't tracked
git rm --cached --ignore-unmatch "$ARCHIVE" > /dev/null
rm -f "$ARCHIVE"

# 4. Offer to remove from .gitignore
echo " - Checking '$GITIGNORE_FILE' for ignore rule..."
# Construct the expected ignore pattern (same logic as add.sh)
IGNORE_PATTERN="$PATH_IN"
if [ -d "$PATH_IN" ]; then
    IGNORE_PATTERN="/$PATH_IN/" # Directory pattern
else
    IGNORE_PATTERN="/$PATH_IN" # File pattern
fi

# Check if the ignore pattern exists in .gitignore
# Use grep -x for exact line match
if grep -qx "$IGNORE_PATTERN" "$GITIGNORE_FILE"; then
    printf "Remove '%s' from %s? [y/N]: " "$IGNORE_PATTERN" "$GITIGNORE_FILE"
    read -r response
    echo # Add newline after read
    if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
        echo "   Removing '$IGNORE_PATTERN' from $GITIGNORE_FILE..."
        # Use sed to delete the line containing the exact pattern
        # Note: Assumes pattern is on its own line. May need refinement for complex .gitignore
        sed -i.bak "\|^$IGNORE_PATTERN$|d" "$GITIGNORE_FILE"
        # Also try removing the comment line added by add.sh if present
        COMMENT_PATTERN="# Added by git-vault for: $PATH_IN"
        sed -i.bak "\|^${COMMENT_PATTERN}$|d" "$GITIGNORE_FILE"
        rm -f "$GITIGNORE_FILE.bak" # Clean up backups

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
echo "  - Password file renamed to '$REMOVED_PWFILE'."
echo "  - Archive '$ARCHIVE' removed from Git and filesystem."
echo "  - '$GITIGNORE_FILE' checked (and possibly updated)."
echo ""
echo "Please commit the changes made to:"
echo "  - $MANIFEST"
echo "  - $GITIGNORE_FILE (if modified)"
echo "  - Any removal of '$ARCHIVE' tracked by Git."
echo ""
echo "The original plaintext path '$PATH_IN' remains in your working directory."
echo "The password file was renamed to '$REMOVED_PWFILE' for potential recovery."

exit 0
