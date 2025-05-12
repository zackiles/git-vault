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
echo "Success: '$PATH_TO_PROTECT' is now managed by git-vault."
