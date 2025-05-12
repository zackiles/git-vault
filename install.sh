#!/usr/bin/env sh
set -euo pipefail

# --- Constants ---
# Allow configuration of release URL via environment variable (useful for testing)
GITHUB_RELEASE_BASE_URL="${GIT_VAULT_RELEASE_URL:-https://github.com/zacharyiles/git-vault/releases/latest/download}"
EMBEDDED_PATHS_LIST="# Git-Vault Managed Paths
# Format: <file-path>#<hash>
# Do not edit manually"
# Default LFS threshold in MB
DEFAULT_LFS_THRESHOLD=5

# --- Dependency Management ---
# List of required dependencies and their package names for different platforms
REQUIRED_DEPS="gpg tar mktemp"
SHASUM_DEPS="sha1sum shasum" # At least one must be present
SED_DEPS="sed" # Additional utilities

# Package names for different platforms
LINUX_APT_PACKAGES="gnupg tar coreutils sed"
LINUX_DNF_PACKAGES="gnupg tar coreutils sed"
LINUX_PACMAN_PACKAGES="gnupg tar coreutils sed"
MACOS_BREW_PACKAGES="gnupg coreutils"

# Function to check if a command exists
check_dependency() {
  command -v "$1" >/dev/null 2>&1
}

# Function to check if any of the alternative commands exist
check_alternative_deps() {
  local found=false
  for cmd in $1; do
    if check_dependency "$cmd"; then
      found=true
      break
    fi
  done
  [ "$found" = true ]
}

# Function to detect the platform and package manager
detect_platform() {
  local kernel
  kernel=$(uname -s)
  case "$kernel" in
    Linux)
      if [ -f /etc/debian_version ] || [ -f /etc/ubuntu_version ] || command -v apt-get >/dev/null 2>&1; then
        echo "linux-apt"
      elif [ -f /etc/fedora-release ] || command -v dnf >/dev/null 2>&1; then
        echo "linux-dnf"
      elif [ -f /etc/arch-release ] || command -v pacman >/dev/null 2>&1; then
        echo "linux-pacman"
      else
        echo "linux-unknown"
      fi
      ;;
    Darwin)
      echo "macos"
      ;;
    CYGWIN*|MINGW*|MSYS*)
      echo "windows"
      ;;
    *)
      echo "unknown"
      ;;
  esac
}

# Function to check all dependencies and return list of missing ones
check_all_dependencies() {
  local missing_deps=""

  # Check required dependencies
  for dep in $REQUIRED_DEPS; do
    if ! check_dependency "$dep"; then
      missing_deps="$missing_deps $dep"
    fi
  done

  # Check for sha1sum or shasum
  if ! check_alternative_deps "$SHASUM_DEPS"; then
    missing_deps="$missing_deps sha1sum/shasum"
  fi

  # Check additional utilities
  for dep in $SED_DEPS; do
    if ! check_dependency "$dep"; then
      missing_deps="$missing_deps $dep"
    fi
  done

  echo "$missing_deps"
}

# Function to install dependencies based on platform
install_dependencies() {
  local platform="$1"
  local missing_deps="$2"
  local exit_code=0

  case "$platform" in
    linux-apt)
      echo "Installing dependencies using apt..."
      if ! sudo apt-get update; then
        echo "Error: Failed to update package lists" >&2
        return 1
      fi
      if ! sudo apt-get install -y $LINUX_APT_PACKAGES; then
        echo "Error: Failed to install packages" >&2
        return 1
      fi
      ;;
    linux-dnf)
      echo "Installing dependencies using dnf..."
      if ! sudo dnf install -y $LINUX_DNF_PACKAGES; then
        echo "Error: Failed to install packages" >&2
        return 1
      fi
      ;;
    linux-pacman)
      echo "Installing dependencies using pacman..."
      if ! sudo pacman -Sy --noconfirm $LINUX_PACMAN_PACKAGES; then
        echo "Error: Failed to install packages" >&2
        return 1
      fi
      ;;
    macos)
      if ! command -v brew >/dev/null 2>&1; then
        echo "Homebrew is required but not installed. Please install Homebrew first:"
        echo "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        return 1
      fi
      echo "Installing dependencies using Homebrew..."
      if ! brew install $MACOS_BREW_PACKAGES; then
        echo "Error: Failed to install packages" >&2
        return 1
      fi
      ;;
    windows)
      echo "Git Bash/MinGW environment detected."
      echo "Most dependencies should be included with Git for Windows."
      echo "If any are missing, please install Git for Windows with all components:"
      echo "  https://git-scm.com/download/win"
      return 0
      ;;
    *)
      echo "Error: Unsupported platform for automatic dependency installation" >&2
      return 1
      ;;
  esac

  # Re-verify that all dependencies are now installed
  echo "Verifying installation of dependencies..."
  local still_missing=""

  # Check required dependencies again
  for dep in $REQUIRED_DEPS; do
    if ! check_dependency "$dep"; then
      still_missing="$still_missing $dep"
    fi
  done

  # Check for sha1sum or shasum again
  if ! check_alternative_deps "$SHASUM_DEPS"; then
    still_missing="$still_missing sha1sum/shasum"
  fi

  # Check additional utilities again
  for dep in $SED_DEPS; do
    if ! check_dependency "$dep"; then
      still_missing="$still_missing $dep"
    fi
  done

  if [ -n "$still_missing" ]; then
    echo "Error: Some dependencies are still missing after installation:$still_missing" >&2
    echo "Please install them manually" >&2
    return 1
  fi

  echo "All dependencies successfully installed!"
  return $exit_code
}

# --- Helper Functions ---
# Downloads a file from GitHub releases if not found locally
download_or_use_local() {
  local filename="$1"
  local target_path="$2"
  local source_dir="$3"

  # First try to use local file (for local development/testing)
  if [ -f "${source_dir}/${filename}" ]; then
    echo "Using local copy of ${filename}"
    cp "${source_dir}/${filename}" "${target_path}"
    return 0
  fi

  # If local file not found, try to download from GitHub releases
  echo "Local copy of ${filename} not found, downloading from GitHub releases..."
  if command -v curl > /dev/null; then
    if ! curl -sSL "${GITHUB_RELEASE_BASE_URL}/${filename}" -o "${target_path}"; then
      echo "Error: Failed to download ${filename} using curl"
      return 1
    fi
  elif command -v wget > /dev/null; then
    if ! wget -q "${GITHUB_RELEASE_BASE_URL}/${filename}" -O "${target_path}"; then
      echo "Error: Failed to download ${filename} using wget"
      return 1
    fi
  else
    echo "Error: Neither curl nor wget found. Cannot download ${filename}"
    return 1
  fi

  # Verify download succeeded
  if [ ! -s "${target_path}" ]; then
    echo "Error: Downloaded file ${filename} is empty or failed to download"
    return 1
  fi

  echo "Successfully downloaded ${filename}"
  return 0
}

# --- Parse Arguments ---
TARGET_DIR=""
LFS_THRESHOLD=$DEFAULT_LFS_THRESHOLD
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
    --min-lfs=*)
      LFS_THRESHOLD="${1#*=}"
      if ! [[ "$LFS_THRESHOLD" =~ ^[0-9]+$ ]]; then
        echo "Error: --min-lfs requires a positive integer value in MB" >&2
        exit 1
      fi
      shift
      ;;
    --min-lfs)
      if [ -z "$2" ] || ! [[ "$2" =~ ^[0-9]+$ ]]; then
        echo "Error: $1 requires a positive integer value in MB" >&2
        exit 1
      fi
      LFS_THRESHOLD="$2"
      shift 2
      ;;
    *)
      echo "Error: Unknown option $1" >&2
      echo "Usage: $0 [--target-dir|-t <directory>] [--min-lfs=<size-in-MB>]" >&2
      exit 1
      ;;
  esac
done

# --- Main Script ---
# Check for dependencies
platform=$(detect_platform)
missing_deps=$(check_all_dependencies)

if [ -n "$missing_deps" ]; then
  echo "Missing required dependencies:$missing_deps"
  echo

  if [ "$platform" = "unknown" ] || [ "$platform" = "linux-unknown" ]; then
    echo "Error: Your platform does not support automatic dependency installation."
    echo "Please install the following dependencies manually:$missing_deps"
    exit 1
  fi

  read -p "Would you like to install the missing dependencies? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    if ! install_dependencies "$platform" "$missing_deps"; then
      echo "Error: Failed to install dependencies. Please install them manually:$missing_deps"
      exit 1
    fi
    echo "Dependencies installed successfully."
  else
    echo "Dependencies are required for git-vault to function properly."
    echo "Please install them manually:$missing_deps"
    exit 1
  fi
fi

# --- Main Installation Logic ---
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

TARGET_GIT_VAULT_DIR=".git-vault"
STORAGE_DIR="$TARGET_GIT_VAULT_DIR/storage"
TARGET_MANIFEST="$TARGET_GIT_VAULT_DIR/paths.list"
LFS_CONFIG_FILE="$TARGET_GIT_VAULT_DIR/lfs-config"
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

TARGET_GIT_VAULT_DIR_REL=".git-vault" # Relative path to vault scripts from repo root

# Define source script paths (relative to the location of install.sh)
SOURCE_SCRIPT_DIR=$(dirname "$0") # Assumes install.sh location

# --- Ensure Directories and Files Exist ---
echo "Ensuring required directories and files exist in target repo..."
mkdir -p "$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR" "$TARGET_REPO_ROOT/$STORAGE_DIR" "$HOOKS_DIR"

# --- Install Script Files ---
echo "Installing git-vault scripts into target '$TARGET_GIT_VAULT_DIR/'..."

# Create paths.list file from embedded content if it doesn't exist
if [ ! -f "$TARGET_REPO_ROOT/$TARGET_MANIFEST" ]; then
  echo "Creating paths.list manifest file from embedded template..."
  echo "$EMBEDDED_PATHS_LIST" > "$TARGET_REPO_ROOT/$TARGET_MANIFEST"
fi

# Install script files, either from local copies or GitHub release
SCRIPT_FILES="add.sh remove.sh encrypt.sh decrypt.sh"
for script in $SCRIPT_FILES; do
  # Try local file first, then download from GitHub if needed
  if ! download_or_use_local "$script" "$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR/$script" "$SOURCE_SCRIPT_DIR"; then
    echo "Failed to install $script"
    exit 1
  fi
  # Make sure the script is executable
  chmod +x "$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR/$script"
done

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

# Ensure storage/ directory is properly tracked
STORAGE_DIR_REL="$TARGET_GIT_VAULT_DIR_REL/storage"  # Update to use new storage dir path
if grep -q "^$STORAGE_DIR_REL" "$GITIGNORE_FILE"; then
    echo "WARNING: '$STORAGE_DIR_REL/' is ignored in .gitignore but MUST be tracked."
    echo "        Please modify your .gitignore to ensure '$STORAGE_DIR_REL/' is not ignored."
fi

# --- Git LFS Setup ---
echo "Checking for Git LFS support..."
# Save the LFS threshold to config file for use by other scripts
echo "$LFS_THRESHOLD" > "$TARGET_REPO_ROOT/$LFS_CONFIG_FILE"
echo "LFS threshold set to ${LFS_THRESHOLD}MB (stored in $LFS_CONFIG_FILE)"

# Check if git-lfs is available
if command -v git-lfs >/dev/null 2>&1; then
  echo "Git LFS detected. Setting up LFS for git-vault..."

  # Initialize Git LFS in the repository if not already done
  if ! git -C "$TARGET_REPO_ROOT" lfs version >/dev/null 2>&1; then
    git -C "$TARGET_REPO_ROOT" lfs install --local
    echo "Git LFS initialized in the repository."
  else
    echo "Git LFS already initialized in the repository."
  fi

  # Create a .gitattributes file if it doesn't exist
  GITATTRIBUTES_FILE="$TARGET_REPO_ROOT/.gitattributes"
  touch "$GITATTRIBUTES_FILE"

  # Add the LFS tracking pattern for archives
  LFS_PATTERN="$STORAGE_DIR_REL/*.tar.gz.gpg filter=lfs diff=lfs merge=lfs -text"
  if ! grep -qxF "$LFS_PATTERN" "$GITATTRIBUTES_FILE"; then
    echo "# Git-Vault LFS tracking for large encrypted archives" >> "$GITATTRIBUTES_FILE"
    echo "$LFS_PATTERN" >> "$GITATTRIBUTES_FILE"
    echo "Added LFS tracking for encrypted archives to .gitattributes"

    # Stage .gitattributes for commit
    git -C "$TARGET_REPO_ROOT" add "$GITATTRIBUTES_FILE" > /dev/null 2>&1 || true
  else
    echo "LFS tracking for git-vault archives already configured in .gitattributes"
  fi
else
  echo "Git LFS not detected. Large files will be stored directly in Git."
  echo "To use Git LFS for improved handling of large archives:"
  echo "  1. Install Git LFS (https://git-lfs.github.com/)"
  echo "  2. Run: git lfs install"
  echo "  3. Reinstall git-vault to enable LFS integration"
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
if command -v git-lfs >/dev/null 2>&1; then
  echo "Git LFS is configured with a threshold of ${LFS_THRESHOLD}MB."
  echo "Archives larger than this size will be managed by Git LFS automatically."
else
  echo "Git LFS is not available. Install Git LFS for better management of large archives."
fi
echo ""
echo "Remember to commit changes to .gitignore and the $TARGET_GIT_VAULT_DIR_REL/ directory."

exit 0
