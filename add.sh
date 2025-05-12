#!/bin/bash
# add.sh - Add a file or directory to git-vault
#
# Syntax: add.sh <path>
#   <path> can be a file or directory

set -e # Exit on errors
set -u # Treat unset variables as errors

# --- Initial Validation ---
if [ $# -lt 1 ]; then
  echo "Error: Missing required argument <path>."
  echo "Usage: add.sh <path>"
  exit 1
fi

# Get the input path (handling spaces)
PATH_TO_PROTECT="$1"
# Remove any trailing slash from directories
PATH_TO_PROTECT="${PATH_TO_PROTECT%/}"
IS_DIRECTORY=false

# Check if path exists
if [ ! -e "$PATH_TO_PROTECT" ]; then
  echo "Error: '$PATH_TO_PROTECT' does not exist."
  exit 1
fi

# Check if it's a directory
if [ -d "$PATH_TO_PROTECT" ]; then
  IS_DIRECTORY=true
  # For dirs, we add the trailing slash back for consistency in the manifest
  PATH_TO_PROTECT="${PATH_TO_PROTECT}/"
fi

# --- Path Normalization ---
# Get the absolute path (resolving symbolic links)
REAL_PATH=$(realpath "$PATH_TO_PROTECT")

# --- Environment Setup ---
# Get the vault directories (from the script location)
SCRIPT_DIR=$(dirname "$0")
GIT_VAULT_DIR=".git-vault"
STORAGE_DIR="$GIT_VAULT_DIR/storage"
PATHS_FILE="$GIT_VAULT_DIR/paths.list"
LFS_CONFIG_FILE="$GIT_VAULT_DIR/lfs-config"

# Ensure paths file exists
[ -f "$PATHS_FILE" ] || touch "$PATHS_FILE"
mkdir -p "$STORAGE_DIR"

# --- Path Hash Generation ---
# Create a unique identifier based on the path (for file names)
PATH_HASH=$(printf "%s" "$PATH_TO_PROTECT" | sha1sum | cut -c1-8)
# Check if path is already managed
if grep -q "^$PATH_HASH " "$PATHS_FILE"; then
  echo "Error: '$PATH_TO_PROTECT' is already managed by git-vault."
  exit 1
fi

# --- Password Collection ---
PW_FILE="$GIT_VAULT_DIR/git-vault-${PATH_HASH}.pw"

# Securely prompt for password
echo "Enter encryption password for '$PATH_TO_PROTECT':"
read -r -s PASSWORD
echo "Confirm password:"
read -r -s PASSWORD_CONFIRM

# Verify passwords match
if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
  echo "Error: Passwords do not match."
  exit 1
fi

# --- Create Archive ---
# Create temporary directory
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Determine archive name (replace slashes with hyphens)
ARCHIVE_NAME=$(echo "$PATH_TO_PROTECT" | tr '/' '-')
ARCHIVE_FILE="${STORAGE_DIR}/${ARCHIVE_NAME}.tar.gz.gpg"

if $IS_DIRECTORY; then
  # For directories, we can't just use tar's -C option because we want
  # to preserve the final directory name in the archive.
  # So we create a parent directory in the temp dir.
  PARENT_DIR=$(dirname "$PATH_TO_PROTECT")
  BASE_NAME=$(basename "$PATH_TO_PROTECT")
  mkdir -p "$TEMP_DIR/src"
  cp -a "$REAL_PATH" "$TEMP_DIR/src/"

  # Create the archive from our temporary structure
  tar -czf "$TEMP_DIR/archive.tar.gz" -C "$TEMP_DIR/src" "$BASE_NAME"
else
  # For files, we can just archive directly
  tar -czf "$TEMP_DIR/archive.tar.gz" -C "$(dirname "$REAL_PATH")" "$(basename "$REAL_PATH")"
fi

# Encrypt the archive
echo "$PASSWORD" | gpg --batch --yes --passphrase-fd 0 -c -o "$ARCHIVE_FILE" "$TEMP_DIR/archive.tar.gz"
echo "$PASSWORD" > "$PW_FILE"
chmod 600 "$PW_FILE"  # Secure the password file

# --- LFS handling for large archives ---
# Check if LFS config exists and read threshold
LFS_THRESHOLD=5 # Default 5MB if config file doesn't exist
if [ -f "$LFS_CONFIG_FILE" ]; then
  LFS_THRESHOLD=$(cat "$LFS_CONFIG_FILE")
fi

# Get archive size in MB (rounded up for comparison)
# du shows sizes in blocks, so we need to convert to bytes and then to MB
if command -v du >/dev/null 2>&1; then
  if du --help 2>&1 | grep -q '\--block-size'; then
    # GNU du (Linux)
    ARCHIVE_SIZE=$(du --block-size=1M "$ARCHIVE_FILE" | cut -f1)
  else
    # BSD du (macOS)
    ARCHIVE_SIZE=$(du -m "$ARCHIVE_FILE" | cut -f1)
  fi
else
  # Fallback if du is not available (unlikely)
  ARCHIVE_SIZE=$(($(stat -c%s "$ARCHIVE_FILE" 2>/dev/null || stat -f%z "$ARCHIVE_FILE") / 1024 / 1024))
fi

# Check if we should use LFS based on archive size and availability
if [ "$ARCHIVE_SIZE" -ge "$LFS_THRESHOLD" ]; then
  echo "Archive size (${ARCHIVE_SIZE}MB) exceeds LFS threshold (${LFS_THRESHOLD}MB)."

  if command -v git-lfs >/dev/null 2>&1; then
    echo "Using Git LFS for this archive."

    # Check if git-lfs is initialized in the repo
    if ! git lfs version >/dev/null 2>&1; then
      echo "Initializing Git LFS in the repository."
      git lfs install --local
    fi

    # Create or update .gitattributes file
    GITATTRIBUTES_FILE=".gitattributes"
    touch "$GITATTRIBUTES_FILE"

    # Create a specific pattern for this file if it's not covered by wildcard
    LFS_WILDCARD_PATTERN="$STORAGE_DIR/*.tar.gz.gpg filter=lfs diff=lfs merge=lfs -text"
    LFS_SPECIFIC_PATTERN="$ARCHIVE_FILE filter=lfs diff=lfs merge=lfs -text"

    # Check if we need to add a specific pattern (if wildcard doesn't exist)
    if ! grep -qxF "$LFS_WILDCARD_PATTERN" "$GITATTRIBUTES_FILE"; then
      if ! grep -qxF "$LFS_SPECIFIC_PATTERN" "$GITATTRIBUTES_FILE"; then
        echo "$LFS_SPECIFIC_PATTERN" >> "$GITATTRIBUTES_FILE"
        echo "Added LFS tracking for '$ARCHIVE_FILE' in .gitattributes."

        # Stage .gitattributes
        git add "$GITATTRIBUTES_FILE" > /dev/null 2>&1 || true
      fi
    else
      echo "Using existing wildcard LFS tracking pattern for git-vault archives."
    fi

    # Mark the file for LFS tracking
    git lfs track "$ARCHIVE_FILE" > /dev/null 2>&1 || true
  else
    echo "Git LFS not available. Large archive will be stored directly in Git."
    echo "For better performance with large files, consider installing Git LFS."
  fi
fi

# --- Update Manifest ---
# Add entry to the paths file
echo "$PATH_HASH $PATH_TO_PROTECT" >> "$PATHS_FILE"

# --- Update .gitignore ---
# Define gitignore location
GITIGNORE_FILE=".gitignore"
GITIGNORE_PATTERN="/$PATH_TO_PROTECT"
PW_IGNORE_PATTERN="$GIT_VAULT_DIR/*.pw"
PW_COMMENT_LINE="# Git-Vault password files (DO NOT COMMIT)"

# Create .gitignore if it doesn't exist
if [ ! -f "$GITIGNORE_FILE" ]; then
  touch "$GITIGNORE_FILE"
fi

# Check if pattern already exists
if ! grep -qxF "$GITIGNORE_PATTERN" "$GITIGNORE_FILE"; then
  # Add the path pattern to .gitignore
  echo "$GITIGNORE_PATTERN" >> "$GITIGNORE_FILE"
  echo "Added '$GITIGNORE_PATTERN' to .gitignore."
fi

# Check if password ignore pattern exists
if ! grep -qxF "$PW_IGNORE_PATTERN" "$GITIGNORE_FILE"; then
  # Add the comment and pattern
  echo "$PW_COMMENT_LINE" >> "$GITIGNORE_FILE"
  echo "$PW_IGNORE_PATTERN" >> "$GITIGNORE_FILE"
  echo "Added password ignore pattern to .gitignore."
fi

# --- Stage Files for Commit ---
# Add the relevant files to git staging
git add "$ARCHIVE_FILE" "$PATHS_FILE" "$GITIGNORE_FILE" > /dev/null 2>&1 || true

# --- Success ---
echo "Password saved in: $PW_FILE"
echo "Archive stored in: $ARCHIVE_FILE"
if [ "$ARCHIVE_SIZE" -ge "$LFS_THRESHOLD" ] && command -v git-lfs >/dev/null 2>&1; then
  echo "Archive will be managed by Git LFS (${ARCHIVE_SIZE}MB, threshold: ${LFS_THRESHOLD}MB)"
fi
echo "Success: '$PATH_TO_PROTECT' is now managed by git-vault."
