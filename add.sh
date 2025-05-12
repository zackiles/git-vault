#!/usr/bin/env sh
set -euo pipefail
# Usage: add.sh <relative-path>

# Check if file exists and exit if it doesn't
check_exists() {
    local file="$1"
    if [ ! -e "$file" ]; then
        echo "Error: '$file' does not exist"
        exit 1
    fi
}

# Check if dependencies are installed
for dep in gpg tar sha1sum shasum; do
    if command -v "$dep" >/dev/null 2>&1; then
        if [ "$dep" = "sha1sum" ]; then
            SHA1CMD="sha1sum"
            break
        elif [ "$dep" = "shasum" ]; then
            SHA1CMD="shasum"
            break
        fi
    fi
done

# For sha1, check if either sha1sum (Linux) or shasum (macOS) is available
if [ -z "${SHA1CMD:-}" ]; then
    echo "Error: Either sha1sum or shasum is required"
    exit 1
fi

# Ensure required commands exist
for cmd in gpg tar; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "Error: $cmd is required but not installed"
        exit 1
    fi
done

# Check GPG version for compatibility
GPG_VERSION=$(gpg --version | head -n 1 | awk '{print $3}')
GPG_MAJOR=$(echo "$GPG_VERSION" | cut -d. -f1)
GPG_MINOR=$(echo "$GPG_VERSION" | cut -d. -f2)

if [ "$GPG_MAJOR" -lt 2 ]; then
    echo "Warning: Using GPG version $GPG_VERSION. Version 2.0 or higher is recommended."
    # We don't exit as old versions may still work
fi

# Get the vault directories (from the script location)
SCRIPT_DIR=$(dirname "$0")
VAULT_DIR="$SCRIPT_DIR"
STORAGE_DIR="$(dirname "$VAULT_DIR")/storage"
PATHS_FILE="$VAULT_DIR/paths.list"

# Ensure paths file exists
[ -f "$PATHS_FILE" ] || touch "$PATHS_FILE"
mkdir -p "$STORAGE_DIR"

# Validate input path
[ $# -ne 1 ] && echo "Usage: $0 <path-to-encrypt>" && exit 1
PATH_IN="$1"

# Portable way to get absolute path (works on Linux and macOS)
get_absolute_path() {
    local path="$1"
    # Check if it's already absolute
    case "$path" in
        /*) echo "$path" ;;
        *)  # Relative path - make absolute
            echo "$(cd "$(dirname "$path")" && pwd)/$(basename "$path")"
            ;;
    esac
}

# Get absolute path for input
if [ -e "$PATH_IN" ]; then
    # If the path exists, we can use the more reliable method
    ABS_PATH_IN=$(get_absolute_path "$PATH_IN")
else
    # Handle paths that don't exist yet (needed for canonicalize-missing behavior)
    ABS_PATH_IN="$(cd "$(dirname "$PATH_IN")" 2>/dev/null && pwd)/$(basename "$PATH_IN")" || {
        echo "Error: Invalid path or directory in '$PATH_IN'"
        exit 1
    }
fi

# Ensure the path exists
check_exists "$ABS_PATH_IN"

# Get the relative path from the repo root
REPO_ROOT=$(cd "$VAULT_DIR/.." && pwd)
REL_PATH=${ABS_PATH_IN#"$REPO_ROOT/"}

# Check if this path is already managed
if grep -q "^[a-z0-9]\{8\} $REL_PATH$" "$PATHS_FILE"; then
    echo "Error: '$REL_PATH' is already managed by git-vault"
    exit 1
fi

# Calculate the hash for this path (8 chars is enough for uniqueness in most repos)
HASH=$(printf "%s" "$REL_PATH" | $SHA1CMD | cut -c1-8)
PW_FILE="$VAULT_DIR/git-vault-$HASH.pw"

# If path is a directory, ensure trailing slash for clear indication
if [ -d "$ABS_PATH_IN" ] && [[ "$REL_PATH" != */ ]]; then
    REL_PATH="$REL_PATH/"
fi

# Create a password file for this path
if [ -f "$PW_FILE" ]; then
    echo "ERROR: Password file already exists for another path with same hash."
    echo "Please try renaming '$REL_PATH' slightly to get a different hash."
    exit 1
fi

# Allow user to set a password
echo "Enter password for '$REL_PATH': "
read -r PASSWORD
echo "Confirm password: "
read -r PASSWORD_CONFIRM

if [ -z "$PASSWORD" ]; then
    echo "Error: Password cannot be empty."
    exit 1
fi

if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
    echo "Error: Passwords do not match."
    exit 1
fi

# Prepare archive name (replace slashes with dashes)
# Use a simpler, more reliable approach to replace "/" with "-"
ARCHIVE_NAME=$(echo "$REL_PATH" | tr '/' '-')
ARCHIVE_PATH="$STORAGE_DIR/$ARCHIVE_NAME.tar.gz.gpg"

# IMPORTANT: Create the parent directory for the archive
mkdir -p "$STORAGE_DIR"
# Ensure parent directory of the archive exists (in case of slashes in ARCHIVE_NAME)
mkdir -p "$(dirname "$ARCHIVE_PATH")"

# Create temporary file for the password
TEMP_FILE=$(mktemp)
# Extract original on exit
cleanup() {
  [ -f "$TEMP_FILE" ] && rm -f "$TEMP_FILE"
}
trap cleanup EXIT

echo "$PASSWORD" > "$TEMP_FILE"

# Create archive of the path
echo "Creating encrypted archive for '$REL_PATH'..."
if [ -d "$ABS_PATH_IN" ]; then
    # For directories, tar from inside the dir to avoid full paths
    (cd "$(dirname "$ABS_PATH_IN")" && tar -czf - "$(basename "$ABS_PATH_IN")") | \
    gpg --batch --yes --passphrase-file "$TEMP_FILE" -c -o "$ARCHIVE_PATH"
else
    # For files, tar them directly
    tar -czf - -C "$(dirname "$ABS_PATH_IN")" "$(basename "$ABS_PATH_IN")" | \
    gpg --batch --yes --passphrase-file "$TEMP_FILE" -c -o "$ARCHIVE_PATH"
fi

# Validation: Try to decrypt and extract to ensure it works
echo "Validating encryption/decryption..."
VALIDATION_DIR=$(mktemp -d)
# Cleanup on exit
cleanup_validation() {
  [ -d "$VALIDATION_DIR" ] && rm -rf "$VALIDATION_DIR"
}
trap cleanup_validation EXIT

if ! gpg --batch --yes --passphrase-file "$TEMP_FILE" -d "$ARCHIVE_PATH" | \
     tar -xzf - -C "$VALIDATION_DIR"; then
    echo "Error: Encryption/decryption validation failed."
    rm -f "$ARCHIVE_PATH" # Cleanup failed archive
    rm -f "$TEMP_FILE"
    exit 1
fi

# All validations passed - save the password and update the manifest
echo "$PASSWORD" > "$PW_FILE"
echo "$HASH $REL_PATH" >> "$PATHS_FILE"

# Update .gitignore to ignore this path
GITIGNORE_FILE="$REPO_ROOT/.gitignore"
touch "$GITIGNORE_FILE"
IGNORE_PATTERN="/$REL_PATH"

# Only add to gitignore if it's not already in there
if ! grep -qxF "$IGNORE_PATTERN" "$GITIGNORE_FILE"; then
    echo "Adding '$IGNORE_PATTERN' to .gitignore..."
    echo "$IGNORE_PATTERN" >> "$GITIGNORE_FILE"
    git add "$GITIGNORE_FILE" 2>/dev/null || true
fi

# Stage the archive and paths file for commit
git add "$ARCHIVE_PATH" "$PATHS_FILE" 2>/dev/null || true

echo "Success: '$REL_PATH' is now managed by git-vault."
echo "Archive stored in: $ARCHIVE_PATH"
echo "Password saved in: $PW_FILE"
echo "IMPORTANT: Commit the changes to .gitignore, paths.list, and the archive!"
exit 0
