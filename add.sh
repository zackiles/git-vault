#!/usr/bin/env sh
# add.sh - Add a file or directory to git-vault
#
# Syntax: add.sh <path>
#   <path> can be a file or directory

set -e # Exit on errors
set -u # Treat unset variables as errors

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

# Create 1Password item for git-vault password
create_op_item() {
  local hash="$1"
  local path="$2"
  local password="$3"
  local vault_name
  local project_name
  local item_name

  vault_name=$(get_vault_name)
  project_name=$(get_project_name)
  item_name="git-vault-${project_name}-${hash}"

  echo "Attempting to create item '$item_name' in vault '$vault_name'..."

  # Create item with password, path, and status fields
  # Use op item create --generate-password if password is empty? No, we collected one.
  if op item create \
    --category "Secure Note" \
    --title "$item_name" \
    --vault "$vault_name" \
    --template="" \
    "password=$password" \
    "path=$path" \
    "status=active" >/dev/null; then
      echo "Successfully created 1Password item '$item_name' in vault '$vault_name'." >&2
      return 0
  else
      echo "Error: Failed to create 1Password item '$item_name' in vault '$vault_name'." >&2
      echo "       Check vault name, permissions, and network connection." >&2
      return 1
  fi
}
# --- End 1Password Helper Functions ---

# --- Get Script Directory and Source Utils ---
GIT_VAULT_DIR=$(dirname "$0") # Assumes script is run from .git-vault
UTILS_PATH="$GIT_VAULT_DIR/utils.sh"
if [ -f "$UTILS_PATH" ]; then
  # shellcheck source=utils.sh
  . "$UTILS_PATH"
else
  echo "Error: Utility script '$UTILS_PATH' not found." >&2
  exit 1
fi
# --- End Sourcing ---

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
# Get absolute paths
REAL_PATH=$(realpath "$PATH_TO_PROTECT")
REPO_ROOT=$(git rev-parse --show-toplevel)
# Use a portable way to get relative path using Python or a shell-only approach
if command -v python3 >/dev/null 2>&1; then
  RELATIVE_PATH_TO_PROTECT=$(python3 -c "import os.path; print(os.path.relpath('$REAL_PATH', '$REPO_ROOT'))")
elif command -v python >/dev/null 2>&1; then
  RELATIVE_PATH_TO_PROTECT=$(python -c "import os.path; print(os.path.relpath('$REAL_PATH', '$REPO_ROOT'))")
else
  # Pure shell fallback that works in both bash and sh
  # Remove common prefix and ensure it starts with proper path separator
  RELATIVE_PATH_TO_PROTECT=$(echo "$REAL_PATH" | sed "s|^${REPO_ROOT}/||")
  if [ "$REAL_PATH" = "$RELATIVE_PATH_TO_PROTECT" ]; then
    # If no change, the path might be outside the repo or might need different handling
    echo "Error: Failed to convert $REAL_PATH to a path relative to $REPO_ROOT" >&2
    exit 1
  fi
fi

# If it's a directory, ensure trailing slash for hashing consistency
if [ -d "$REAL_PATH" ]; then
  IS_DIRECTORY=true
  # Add trailing slash if not already present for consistency
  case "$RELATIVE_PATH_TO_PROTECT" in
      */) : ;; # Already ends with slash
      *) RELATIVE_PATH_TO_PROTECT="${RELATIVE_PATH_TO_PROTECT}/" ;; # Add slash
  esac
else
    IS_DIRECTORY=false
fi

# --- Environment Setup ---
# Get the vault directories (use GIT_VAULT_DIR determined above)
# SCRIPT_DIR=$(dirname "$0") # No longer needed
# GIT_VAULT_DIR=".git-vault" # Use variable from above
STORAGE_DIR="$GIT_VAULT_DIR/storage"
PATHS_FILE="$GIT_VAULT_DIR/paths.list"
LFS_CONFIG_FILE="$GIT_VAULT_DIR/lfs-config"
STORAGE_MODE_FILE="$GIT_VAULT_DIR/storage-mode"

# Determine storage mode
STORAGE_MODE="file" # Default if file doesn't exist
if [ -f "$STORAGE_MODE_FILE" ]; then
  STORAGE_MODE=$(cat "$STORAGE_MODE_FILE")
fi
echo "Storage mode: $STORAGE_MODE"

# Ensure paths file exists
[ -f "$PATHS_FILE" ] || touch "$PATHS_FILE"
mkdir -p "$STORAGE_DIR"

# --- Path Hash Generation ---
# Create a unique identifier based on the path (for file names)
# Use the relative path for the hash
PATH_HASH=$(printf "%s" "$RELATIVE_PATH_TO_PROTECT" | sha1sum | cut -c1-8)
# Check if path is already managed
if grep -q "^$PATH_HASH " "$PATHS_FILE"; then
  echo "Error: '$RELATIVE_PATH_TO_PROTECT' (hash: $PATH_HASH) is already managed by git-vault." >&2
  exit 1
fi

# --- Password Collection ---
PW_FILE="$GIT_VAULT_DIR/git-vault-${PATH_HASH}.pw"

# Securely prompt for password
echo "Enter encryption password for '$RELATIVE_PATH_TO_PROTECT':"
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
ARCHIVE_NAME=$(echo "$RELATIVE_PATH_TO_PROTECT" | tr '/' '-')
ARCHIVE_FILE="${STORAGE_DIR}/${ARCHIVE_NAME}.tar.gz.gpg"

if $IS_DIRECTORY; then
  # For directories, we can't just use tar's -C option because we want
  # to preserve the final directory name in the archive.
  # So we create a parent directory in the temp dir.
  PARENT_DIR=$(dirname "$REAL_PATH")
  BASE_NAME=$(basename "$REAL_PATH")
  mkdir -p "$TEMP_DIR/src"
  cp -a "$REAL_PATH" "$TEMP_DIR/src/"

  # Create the archive from our temporary structure
  tar -czf "$TEMP_DIR/archive.tar.gz" -C "$TEMP_DIR/src" "$BASE_NAME"
else
  # For files, archive relative to repo root to preserve path
  tar -czf "$TEMP_DIR/archive.tar.gz" -C "$REPO_ROOT" "$RELATIVE_PATH_TO_PROTECT"
fi

# Encrypt the archive
if ! echo "$PASSWORD" | gpg --batch --yes --passphrase-fd 0 -c -o "$ARCHIVE_FILE" "$TEMP_DIR/archive.tar.gz"; then
    echo "Error: GPG encryption failed." >&2
    exit 1
fi

# --- Password/Marker Storage ---
if [ "$STORAGE_MODE" = "1password" ]; then
  # Check 1Password status before attempting to store
  if ! check_op_status; then
    echo "Error: 1Password CLI issues detected. Cannot store password." >&2
    # Clean up the archive we just created
    rm -f "$TEMP_DIR/archive.tar.gz" "$ARCHIVE_FILE" 2>/dev/null
    exit 1
  fi

  echo "Storing password in 1Password..."
  # Use the relative path when storing in 1Password item
  if ! create_op_item "$PATH_HASH" "$RELATIVE_PATH_TO_PROTECT" "$PASSWORD" "$GIT_VAULT_DIR"; then
    echo "Error: Failed to store password in 1Password." >&2
    # Clean up the archive
    rm -f "$TEMP_DIR/archive.tar.gz" "$ARCHIVE_FILE" 2>/dev/null
    exit 1
  fi

  # Create empty marker file instead of password file
  touch "$PW_FILE.1p"
  echo "Password stored in 1Password. Marker file created: $PW_FILE.1p"
else
  # Original file-based storage
  echo "$PASSWORD" > "$PW_FILE"
  chmod 600 "$PW_FILE"  # Secure the password file
  echo "Password saved in: $PW_FILE"
fi

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
echo "$PATH_HASH $RELATIVE_PATH_TO_PROTECT" >> "$PATHS_FILE"

# --- Update .gitignore ---
# Define gitignore location
GITIGNORE_FILE=".gitignore"
GITIGNORE_PATTERN="/$RELATIVE_PATH_TO_PROTECT"
PW_IGNORE_PATTERN="$GIT_VAULT_DIR/*.pw"
PW_1P_IGNORE_PATTERN="$GIT_VAULT_DIR/*.pw.1p"
PW_COMMENT_LINE="# Git-Vault password files (DO NOT COMMIT)"
PW_1P_COMMENT_LINE="# Git-Vault 1Password marker files (DO NOT COMMIT)"

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

# Add 1Password marker ignore pattern if needed (and not already added by install)
if [ "$STORAGE_MODE" = "1password" ] && ! grep -qxF "$PW_1P_IGNORE_PATTERN" "$GITIGNORE_FILE"; then
  echo "$PW_1P_COMMENT_LINE" >> "$GITIGNORE_FILE"
  echo "$PW_1P_IGNORE_PATTERN" >> "$GITIGNORE_FILE"
  echo "Added 1Password marker ignore pattern to .gitignore."
fi

# --- Stage Files for Commit ---
# Add the relevant files to git staging
FILES_TO_STAGE="$ARCHIVE_FILE $PATHS_FILE $GITIGNORE_FILE"
if [ "$STORAGE_MODE" = "1password" ]; then
    FILES_TO_STAGE="$FILES_TO_STAGE $PW_FILE.1p"
fi
git add $FILES_TO_STAGE > /dev/null 2>&1 || true

# --- Success ---
if [ "$STORAGE_MODE" != "1password" ]; then
  echo "Password saved in: $PW_FILE" # Only show this for file mode
fi
echo "Archive stored in: $ARCHIVE_FILE"
if [ "$ARCHIVE_SIZE" -ge "$LFS_THRESHOLD" ] && command -v git-lfs >/dev/null 2>&1; then
  echo "Archive will be managed by Git LFS (${ARCHIVE_SIZE}MB, threshold: ${LFS_THRESHOLD}MB)"
fi
echo "Success: '$RELATIVE_PATH_TO_PROTECT' is now managed by git-vault."
