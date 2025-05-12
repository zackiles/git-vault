#!/usr/bin/env sh
set -euo pipefail

# --- Parse Arguments ---
TARGET_DIR=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -t|--target-dir)
      if [ -z "$2" ] || [ "${2#-}" != "$2" ]; then
        echo "Error: $1 requires a directory path argument" >&2
        exit 1
      fi
      TARGET_DIR="$2"
      shift 2
      ;;
    *)
      echo "Error: Unknown option $1" >&2
      echo "Usage: $0 [--target-dir|-t <directory>]" >&2
      exit 1
      ;;
  esac
done

# --- Script Setup ---
# Use specified target directory or default to current git repo root
if [ -z "$TARGET_DIR" ]; then
  TARGET_REPO_ROOT=$(git rev-parse --show-toplevel) || exit 1
  echo "No target directory specified, using current git repository root: $TARGET_REPO_ROOT"
else
  if [ ! -d "$TARGET_DIR" ]; then
    echo "Error: Target directory $TARGET_DIR does not exist or is not a directory" >&2
    exit 1
  fi
  # Use absolute path for target directory
  TARGET_REPO_ROOT=$(cd "$TARGET_DIR" && pwd) || exit 1
  echo "Using specified target directory: $TARGET_REPO_ROOT"
fi

# Ensure target directory is a git repository
if [ ! -d "$TARGET_REPO_ROOT/.git" ] && ! git -C "$TARGET_REPO_ROOT" rev-parse --git-dir > /dev/null 2>&1; then
  echo "Error: Target directory $TARGET_REPO_ROOT is not a git repository" >&2
  exit 1
fi

cd "$TARGET_REPO_ROOT" || exit 1

TARGET_GIT_VAULT_DIR="git-vault"
STORAGE_DIR="storage"
TARGET_MANIFEST="$TARGET_GIT_VAULT_DIR/paths.list"
GIT_DIR=$(git -C "$TARGET_REPO_ROOT" rev-parse --git-dir) # Usually .git, but could be elsewhere

# Check for custom hooks path
CUSTOM_HOOKS_PATH=$(git -C "$TARGET_REPO_ROOT" config --get core.hooksPath 2>/dev/null || echo "")
if [ -n "$CUSTOM_HOOKS_PATH" ]; then
  # If relative path, make it relative to the repository root
  case "$CUSTOM_HOOKS_PATH" in
    /*) # Absolute path
      HOOKS_DIR="$CUSTOM_HOOKS_PATH"
      ;;
    *)  # Relative path (to repo root)
      HOOKS_DIR="$TARGET_REPO_ROOT/$CUSTOM_HOOKS_PATH"
      ;;
  esac
  echo "Using custom hooks directory: $HOOKS_DIR"
else
  # Default hooks directory
  HOOKS_DIR="$GIT_DIR/hooks"
  echo "Using default hooks directory: $HOOKS_DIR"
fi

TARGET_GIT_VAULT_DIR_REL="git-vault" # Relative path to vault scripts from repo root

# Define source script paths (relative to the location of install.sh)
# Adjust these if install.sh is not in the same dir as other scripts in the source repo
SOURCE_SCRIPT_DIR=$(dirname "$0") # Assumes install.sh location
ADD_SH_SRC="${SOURCE_SCRIPT_DIR}/add.sh"
REMOVE_SH_SRC="${SOURCE_SCRIPT_DIR}/remove.sh"
ENCRYPT_SH_SRC="${SOURCE_SCRIPT_DIR}/encrypt.sh"
DECRYPT_SH_SRC="${SOURCE_SCRIPT_DIR}/decrypt.sh"
PATHS_LIST_SRC="${SOURCE_SCRIPT_DIR}/paths.list" # Source paths.list template

# --- Ensure Directories and Files Exist ---
echo "Ensuring required directories and files exist in target repo..."
mkdir -p "$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR" "$TARGET_REPO_ROOT/$STORAGE_DIR" "$HOOKS_DIR"
# Create target manifest if it doesn't exist (don't overwrite)
[ ! -f "$TARGET_REPO_ROOT/$TARGET_MANIFEST" ] && touch "$TARGET_REPO_ROOT/$TARGET_MANIFEST"

# --- Copy Scripts into Target Repo ---
echo "Copying git-vault scripts into target '$TARGET_GIT_VAULT_DIR/'..."
# Check if source files exist before copying
[ ! -f "$ADD_SH_SRC" ] && { echo "Error: Source script '$ADD_SH_SRC' not found."; exit 1; }
[ ! -f "$REMOVE_SH_SRC" ] && { echo "Error: Source script '$REMOVE_SH_SRC' not found."; exit 1; }
[ ! -f "$ENCRYPT_SH_SRC" ] && { echo "Error: Source script '$ENCRYPT_SH_SRC' not found."; exit 1; }
[ ! -f "$DECRYPT_SH_SRC" ] && { echo "Error: Source script '$DECRYPT_SH_SRC' not found."; exit 1; }
[ ! -f "$PATHS_LIST_SRC" ] && { echo "Error: Source template '$PATHS_LIST_SRC' not found."; exit 1; }

cp "$ADD_SH_SRC" "$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR/add.sh"
cp "$REMOVE_SH_SRC" "$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR/remove.sh"
cp "$ENCRYPT_SH_SRC" "$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR/encrypt.sh"
cp "$DECRYPT_SH_SRC" "$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR/decrypt.sh"
# Copy paths.list only if the target doesn't exist, preserving existing user manifest
[ ! -f "$TARGET_REPO_ROOT/$TARGET_MANIFEST" ] && cp "$PATHS_LIST_SRC" "$TARGET_REPO_ROOT/$TARGET_MANIFEST"

# --- Update .gitignore ---
echo "Updating .gitignore..."
GITIGNORE_FILE="$TARGET_REPO_ROOT/.gitignore"
PW_IGNORE_PATTERN="$TARGET_GIT_VAULT_DIR_REL/*.pw"
# Add .gitignore if it doesn't exist
touch "$GITIGNORE_FILE"

# Add password file ignore pattern if not present
if ! grep -qxF "$PW_IGNORE_PATTERN" "$GITIGNORE_FILE"; then
    echo "Adding '$PW_IGNORE_PATTERN' to $GITIGNORE_FILE"
    printf "\n# Git-Vault password files (DO NOT COMMIT)\n%s\n" "$PW_IGNORE_PATTERN" >> "$GITIGNORE_FILE"
fi
# Ensure storage/ is NOT ignored (remove explicit ignore, uncomment negation if present)
# Note: This logic is simplified; assumes simple ignore rules. Might need enhancement for complex .gitignore files.
if grep -qE "^\/?storage\/?$" "$GITIGNORE_FILE"; then
    echo "WARN: 'storage/' seems to be ignored in $GITIGNORE_FILE. Git-Vault needs it tracked."
    echo "      Please manually remove or negate the ignore rule (e.g., '!storage/')."
elif grep -qE "^\!storage\/?$" "$GITIGNORE_FILE"; then
     echo "'!storage/' negation found in $GITIGNORE_FILE (correct)."
else
     echo "'storage/' directory tracking status seems ok in $GITIGNORE_FILE."
fi

# --- Git Hook Installation Function ---
install_hook() {
  local hook_name="$1" # e.g., pre-commit
  local script_name="$2" # e.g., encrypt.sh
  local hook_path="$HOOKS_DIR/$hook_name"
  
  # Calculate the relative path from the hooks directory to the git-vault scripts
  # This is more complex for custom hook paths
  local hooks_to_repo_root=""
  
  # For default hooks in .git/hooks, it's typically "../.."
  # For custom hooks in .githooks, it's typically ""
  if [ "$HOOKS_DIR" = "$GIT_DIR/hooks" ]; then
    # Default hooks location (.git/hooks) - need to go up to repo root
    hooks_to_repo_root="../.." 
  elif [ "$HOOKS_DIR" = "$TARGET_REPO_ROOT/.githooks" ]; then
    # Custom hooks at repository level - already at repo root
    hooks_to_repo_root="." 
  else
    # For other custom locations, calculate relative path
    # This is a simplification and might need more robust path calculation
    hooks_to_repo_root="."
  fi
  
  # Use absolute path for better reliability, especially in test environments
  local hook_script_path="$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR_REL/$script_name"
  local marker="# git-vault hook marker"
  
  echo " - Processing $hook_name hook..."
  echo "   Hook script path will be: $hook_script_path"

  if [ -f "$hook_path" ]; then
    # Hook exists
    if grep -Fxq "$marker" "$hook_path"; then
      # Marker found, check if command is already correct
      # Note: Simple grep check; might not handle complex existing scripts perfectly.
      if grep -Fq "$hook_script_path" "$hook_path"; then
         echo "   git-vault command already present and marked in $hook_name."
         chmod +x "$hook_path" # Ensure executable
         return 0
      else
         echo "   WARN: Found git-vault marker in '$hook_path' but the script command seems different or missing."
         echo "   Expected command similar to: $hook_script_path \"\$@\""
         echo "   Please inspect '$hook_path' manually. Skipping update."
         return 1 # Indicate potential issue
      fi
    else
      # Hook exists but no marker - append safely
      echo "   Existing $hook_name hook found without git-vault marker. Appending git-vault command."
      # Backup existing hook
      local backup_file="$hook_path.bak.$(date +%s)"
      cp "$hook_path" "$backup_file"
      echo "   Backup created at $backup_file"
      # Append marker and command
      printf "\n%s\n%s \"%s\"\n" "$marker" "$hook_script_path" '$@' >> "$hook_path"
      chmod +x "$hook_path"
      echo "   Appended git-vault command to $hook_name."
    fi
  else
    # Hook doesn't exist, create it
    echo "   Creating $hook_name hook at $hook_path."
    # Use /bin/sh for broader compatibility in hooks
    printf "#!/bin/sh\n\n%s\n\n# Execute the git-vault script\nexec %s \"%s\"\n" "$marker" "$hook_script_path" '$@' > "$hook_path"
    chmod +x "$hook_path"
    echo "   Created $hook_path."
  fi
  return 0
}

# --- Install Hooks ---
echo "Installing/updating Git hooks..."
install_hook "pre-commit" "encrypt.sh"
install_hook "post-checkout" "decrypt.sh"
install_hook "post-merge" "decrypt.sh"
echo "Hook installation complete."

# --- Print Usage Instructions ---
echo ""
echo "Git-Vault installation complete."
echo "Usage:"
echo "  Add a path:    $TARGET_GIT_VAULT_DIR_REL/add.sh <relative-path-to-file-or-dir>"
echo "  Remove a path: $TARGET_GIT_VAULT_DIR_REL/remove.sh <relative-path-to-file-or-dir>"
echo ""
echo "Remember to commit changes to .gitignore and the storage/ directory."

exit 0
