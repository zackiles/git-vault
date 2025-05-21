#!/usr/bin/env bash
# Git-Vault Installer
# -------------------
# This script downloads and installs git-vault, a tool for securely
# storing sensitive files in Git repositories using GPG encryption.

# Enable debugging - uncomment to see detailed execution
# set -x

# Exit on error
set -e

# Trap errors to ensure we show useful information
trap 'last_command=$current_command; current_command=$BASH_COMMAND' DEBUG
trap 'echo "ERROR: Command \"${last_command}\" failed with exit code $? at line ${LINENO}"' ERR

# GitHub repository configuration
REPO_OWNER="zackiles"
REPO_NAME="git-vault"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}"
REPO_API_URL="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}"
RAW_CONTENT_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main"

# Detect if we're being piped through curl
if [ -t 1 ]; then
  # Terminal is interactive
  INTERACTIVE=true
else
  # We're being piped (e.g., through curl)
  INTERACTIVE=false
  # Ensure stderr is redirected to stdout so errors appear
  exec 2>&1
fi

# Usage:
#   ./install.sh                   # Download and run the installer
#   ./install.sh --version v0.1.0  # Install specific version
#   ./install.sh --uninstall       # Remove git-vault
#   ./install.sh --local-zip PATH  # Use a local zip file (for testing)
#
# One-line installation:
#   curl -fsSL ${RAW_CONTENT_URL}/install.sh | bash
#
# Install specific version:
#   curl -fsSL ${RAW_CONTENT_URL}/install.sh | bash -s -- --version v0.1.0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored message
print_message() {
  local color="$1"
  local message="$2"
  echo -e "${color}${message}${NC}"
}

# Print error message and exit
error() {
  print_message "${RED}" "ERROR: $1"
  exit 1
}

# Print info message
info() {
  print_message "${BLUE}" "INFO: $1"
}

# Print success message
success() {
  print_message "${GREEN}" "SUCCESS: $1"
}

# Print warning message
warning() {
  print_message "${YELLOW}" "WARNING: $1"
}

# Compare version strings
# Returns 0 if v1 > v2, 1 if v1 < v2, 2 if equal
compare_versions() {
  local v1="$1"
  local v2="$2"

  # Remove 'v' prefix if present
  v1="${v1#v}"
  v2="${v2#v}"

  # Use sort to compare the versions
  if [ "$v1" = "$v2" ]; then
    return 2
  elif [ "$(printf '%s\n' "$v1" "$v2" | sort -V | head -n1)" = "$v1" ]; then
    return 1
  else
    return 0
  fi
}

# Determine OS and architecture
detect_platform() {
  local os
  local arch

  case "$(uname -s)" in
    Linux*)  os="linux";;
    Darwin*) os="macos";;
    MINGW*|MSYS*|CYGWIN*) os="windows";;
    *)       error "Unsupported operating system: $(uname -s)";;
  esac

  # Detect architecture
  case "$(uname -m)" in
    x86_64|amd64) arch="x64";;
    arm64|aarch64)
      if [ "$os" = "macos" ]; then
        os="macos-arm"
        arch="arm64"
      else
        arch="arm64"
      fi
      ;;
    *)       error "Unsupported architecture: $(uname -m)";;
  esac

  echo "$os"
}

# Check if a command exists
command_exists() {
  command -v "$1" &> /dev/null
}

# Check required dependencies
check_dependencies() {
  # Check for unzip or similar tools
  if ! command_exists unzip; then
    warning "unzip not found, will try to use alternative methods for extraction"
  fi

  # Check for git
  if ! command_exists git; then
    error "git is required for git-vault to function"
  fi

  # Check for gpg
  if ! command_exists gpg; then
    warning "gpg not found, will be required for git-vault to function properly"
  fi
}

# Download a file
download_file() {
  local url="$1"
  local output_file="$2"

  info "Downloading from $url"
  echo "DEBUG: Starting download from $url to $output_file"

  local http_code
  if command_exists curl; then
    # Use curl with -w to get the HTTP status code and -f to fail on HTTP errors
    echo "DEBUG: Using curl to download"
    # Make curl less silent so we can see what's happening
    http_code=$(curl -v -w '%{http_code}' -fL "$url" -o "$output_file" 2>&1 || echo "000")
    echo "DEBUG: Curl download completed with status: $http_code"
    case "$http_code" in
      200)
        echo "DEBUG: Download successful"
        ;;
      404)
        error "Release asset not found at $url (HTTP 404). This could mean:
  1. The release assets are still being uploaded
  2. The release was not created properly
  3. The asset name has changed
Please check ${REPO_URL}/releases for available assets."
        ;;
      403)
        error "Access denied when downloading from $url (HTTP 403).
Please try again in a few minutes or check ${REPO_URL}/releases"
        ;;
      000)
        error "Network error while downloading from $url.
Please check your internet connection and try again."
        ;;
      *)
        error "Failed to download file (HTTP $http_code).
Please check ${REPO_URL}/releases or try again later."
        ;;
    esac
  elif command_exists wget; then
    echo "DEBUG: Using wget to download"
    if ! wget -q --server-response "$url" -O "$output_file" 2>&1 | grep -q '200 OK'; then
      error "Failed to download file from $url.
Please check ${REPO_URL}/releases for available assets."
    fi
  else
    error "Neither curl nor wget found. Please install either curl or wget and try again."
  fi

  # Check if the file was actually downloaded and has content
  if [ ! -s "$output_file" ]; then
    error "Downloaded file is empty. This could mean:
  1. The release asset is corrupted
  2. The download was interrupted
Please try again or check ${REPO_URL}/releases for issues."
  fi

  echo "DEBUG: Download file check passed: $(ls -la "$output_file")"
}

# Get the latest release version
get_latest_version() {
  local api_url="${REPO_API_URL}/releases/latest"
  local version

  if command_exists curl; then
    version=$(curl -sSL $api_url | grep '"tag_name":' | cut -d'"' -f4)
  elif command_exists wget; then
    version=$(wget -q -O - $api_url | grep '"tag_name":' | cut -d'"' -f4)
  fi

  if [ -z "$version" ]; then
    error "Failed to determine latest version"
  fi

  echo "$version"
}

# Extract zip file
extract_zip() {
  local zip_file="$1"
  local extract_dir="$2"

  info "Extracting to $extract_dir"

  # First verify the zip file exists and is a valid zip
  if [ ! -f "$zip_file" ]; then
    error "Zip file not found at $zip_file"
  fi

  # Check if it's actually a zip file
  if ! file "$zip_file" | grep -q "Zip archive data" && ! file "$zip_file" | grep -q "ZIP archive"; then
    error "Invalid zip file at $zip_file. Downloaded file is not a valid zip archive."
  fi

  if command_exists unzip; then
    if ! unzip -t "$zip_file" > /dev/null 2>&1; then
      error "Zip file is corrupted or invalid: $zip_file"
    fi
    unzip -qo "$zip_file" -d "$extract_dir" || error "Failed to extract zip file: $zip_file"
  else
    # Try with Python if available
    if command_exists python3; then
      python3 -m zipfile -e "$zip_file" "$extract_dir" || error "Failed to extract zip file using Python: $zip_file"
    elif command_exists python; then
      python -m zipfile -e "$zip_file" "$extract_dir" || error "Failed to extract zip file using Python: $zip_file"
    else
      error "No method available to extract zip files. Please install unzip or Python and try again."
    fi
  fi

  # Verify the executable was extracted
  if [ ! -f "$extract_dir/$executable" ]; then
    error "Expected executable '$executable' not found in extracted files.
This could mean:
  1. The release asset is corrupted
  2. The release asset structure has changed
Please report this issue at ${REPO_URL}/issues"
  fi
}

# Create temp directory
create_temp_dir() {
  if command_exists mktemp; then
    mktemp -d -t git-vault-XXXXXXXXXX
  else
    local temp_dir="/tmp/git-vault-$(date +%s)"
    mkdir -p "$temp_dir"
    echo "$temp_dir"
  fi
}

# Clean up temporary files
cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    info "Cleaning up temporary files"
    rm -rf "$TEMP_DIR"
  fi
}

# Check if git-vault is installed and get its version
check_installed_version() {
  if command_exists gv; then
    local current_version
    current_version=$(gv version 2>/dev/null | grep -o 'v[0-9]*\.[0-9]*\.[0-9]*' || echo "unknown")
    if [ "$current_version" != "unknown" ]; then
      echo "$current_version"
      return 0
    fi
  elif command_exists git-vault; then
    local current_version
    current_version=$(git-vault version 2>/dev/null | grep -o 'v[0-9]*\.[0-9]*\.[0-9]*' || echo "unknown")
    if [ "$current_version" != "unknown" ]; then
      echo "$current_version"
      return 0
    fi
  fi
  echo ""
  return 1
}

# Download and run the git-vault binary
download_and_run() {
  local platform="$1"
  local version="$2"
  local extra_args="$3"
  local local_zip="$4"

  # Debug output to see if we get this far
  echo "DEBUG: Entering download_and_run function"
  echo "DEBUG: Platform: $platform, Version: $version"

  # Create temp directory
  TEMP_DIR=$(create_temp_dir)
  echo "DEBUG: Created temp directory: $TEMP_DIR"
  trap cleanup EXIT

  local zip_path="${TEMP_DIR}/gv.zip"

  if [ -n "$local_zip" ]; then
    # Use local zip file
    info "Using local zip file: $local_zip"
    if [ ! -f "$local_zip" ]; then
      error "Local zip file does not exist: $local_zip"
    fi
    cp "$local_zip" "$zip_path" || error "Failed to copy local zip file to temp directory"
  else
    # Determine the zip file name based on platform
    local zip_file_name
    case "$platform" in
      linux)
        zip_file_name="gv-x86_64-unknown-linux-gnu.zip"
        ;;
      macos)
        zip_file_name="gv-x86_64-apple-darwin.zip"
        ;;
      macos-arm)
        zip_file_name="gv-aarch64-apple-darwin.zip"
        ;;
      windows)
        zip_file_name="gv-x86_64-pc-windows-msvc.exe.zip"
        ;;
      *)
        error "Unsupported platform: $platform"
        ;;
    esac

    local download_url="${REPO_URL}/releases/download/${version}/${zip_file_name}"
    echo "DEBUG: Will attempt to download from: $download_url"

    # Manually check if the release asset exists
    echo "DEBUG: Checking if release asset exists..."
    local asset_check_url="${download_url}"
    local http_code

    if command_exists curl; then
      http_code=$(curl -w '%{http_code}' -Isf "$asset_check_url" -o /dev/null || echo "000")
      echo "DEBUG: HTTP status code for asset: $http_code"
      if [ "$http_code" != "200" ]; then
        error "Release asset not found: $download_url (HTTP $http_code)
Please check ${REPO_URL}/releases for available assets."
      fi
    fi

    # Check if the release exists before attempting download
    local release_url="${REPO_API_URL}/releases/tags/${version}"
    echo "DEBUG: Checking if release exists: $release_url"
    if command_exists curl; then
      http_code=$(curl -w '%{http_code}' -Isf "$release_url" -o /dev/null || echo "000")
      echo "DEBUG: HTTP status code for release: $http_code"
      if [ "$http_code" != "200" ]; then
        error "Release ${version} not found (HTTP $http_code).
Please check ${REPO_URL}/releases for available versions."
      fi
    elif command_exists wget; then
      if ! wget -q --spider "$release_url" 2>/dev/null; then
        error "Release ${version} not found.
Please check ${REPO_URL}/releases for available versions."
      fi
    fi

    info "Downloading ${zip_file_name} from release ${version}"
    # Download the zip file
    download_file "$download_url" "$zip_path"
  fi

  # Find the executable name before extracting
  local executable
  case "$platform" in
    linux)
      executable="gv-x86_64-unknown-linux-gnu"
      ;;
    macos)
      executable="gv-x86_64-apple-darwin"
      ;;
    macos-arm)
      executable="gv-aarch64-apple-darwin"
      ;;
    windows)
      executable="gv-x86_64-pc-windows-msvc.exe"
      ;;
    *)
      error "Unsupported platform: $platform"
      ;;
  esac

  echo "DEBUG: Will look for executable: $executable after extraction"

  # Extract the zip file
  extract_zip "$zip_path" "$TEMP_DIR"

  echo "DEBUG: Extraction completed"

  # Check if the executable actually exists
  if [ ! -f "$TEMP_DIR/$executable" ]; then
    echo "DEBUG: Listing files in temp dir:"
    ls -la "$TEMP_DIR"
    error "Executable not found after extraction: $executable"
  fi

  # Make the executable executable
  chmod +x "$TEMP_DIR/$executable" || error "Failed to make $executable executable"

  # Run the installation
  info "Running git-vault installer..."

  echo "DEBUG: About to execute: $TEMP_DIR/$executable install $(pwd) $extra_args"
  # Just run the installer and pass the current directory to it
  # The installer will interactively handle global vs. local installation
  if ! "$TEMP_DIR/$executable" install "$(pwd)" $extra_args; then
    error "Installation failed. Please check the error messages above."
  fi
}

# Uninstall git-vault
uninstall_git_vault() {
  local cwd="$(pwd)"
  info "Uninstalling git-vault..."

  # Remove local installation
  if [ -d "$cwd/.vault" ]; then
    info "Removing git-vault from current repository"

    # Remove git hooks
    if [ -d "$cwd/.git/hooks" ]; then
      for hook in "pre-commit" "post-checkout" "post-merge"; do
        local hook_path="$cwd/.git/hooks/$hook"
        if [ -f "$hook_path" ] && grep -q "git-vault" "$hook_path"; then
          info "Removing git-vault hook: $hook"
          rm -f "$hook_path"
        fi
      done
    fi

    # Remove .vault directory
    rm -rf "$cwd/.vault"

    # Remove lines from .gitignore
    if [ -f "$cwd/.gitignore" ]; then
      info "Updating .gitignore"
      sed -i.bak '/^\.vault\//d' "$cwd/.gitignore"
      sed -i.bak '/git-vault/d' "$cwd/.gitignore"
      rm -f "$cwd/.gitignore.bak"
    fi

    # Remove lines from .gitattributes if it exists
    if [ -f "$cwd/.gitattributes" ]; then
      info "Updating .gitattributes"
      sed -i.bak '/# Git-Vault LFS tracking/d' "$cwd/.gitattributes"
      sed -i.bak '/\.vault\/storage/d' "$cwd/.gitattributes"
      rm -f "$cwd/.gitattributes.bak"
    fi

    success "Local git-vault installation removed"
  else
    warning "No git-vault installation found in current repository"
  fi

  # Check for global installation
  local global_gv=""
  if command_exists gv; then
    global_gv=$(which gv)
  fi

  if [ -n "$global_gv" ]; then
    local confirm
    read -p "Do you want to remove global gv installation at $global_gv? (y/n) " confirm

    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
      info "Removing global gv installation"

      # Remove executable
      rm -f "$global_gv"

      # Remove git-vault alias if it exists
      if command_exists git-vault; then
        local git_vault_path=$(which git-vault)
        rm -f "$git_vault_path"
        info "Removed git-vault alias from $git_vault_path"
      fi

      success "Global gv installation removed"
    fi
  else
    info "No global gv installation found"
  fi
}

# Parse command line arguments
parse_args() {
  # Default values
  SHOULD_UNINSTALL=false
  SPECIFIED_VERSION=""
  EXTRA_ARGS=""
  LOCAL_ZIP=""

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version|-V)
        SPECIFIED_VERSION="$2"
        shift 2
        ;;
      --uninstall|-u)
        SHOULD_UNINSTALL=true
        shift
        ;;
      --help|-h)
        print_help
        exit 0
        ;;
      --global|-g)
        # Just pass the --global flag to the binary if specified
        EXTRA_ARGS="--global"
        shift
        ;;
      --local-zip)
        LOCAL_ZIP="$2"
        shift 2
        ;;
      *)
        warning "Unknown option: $1"
        shift
        ;;
    esac
  done
}

# Print help message
print_help() {
  echo "git-vault installer"
  echo ""
  echo "Usage: ./install.sh [options]"
  echo ""
  echo "Options:"
  echo "  --version, -V VERSION  Install specific version (e.g., v0.1.0)"
  echo "  --uninstall, -u        Uninstall git-vault"
  echo "  --local-zip PATH       Use local zip file (for testing)"
  echo "  --help, -h             Show this help message"
  echo ""
  echo "Description:"
  echo "  This script downloads and installs git-vault, a tool for securely"
  echo "  storing sensitive files in Git repositories using GPG encryption."
  echo ""
  echo "Examples:"
  echo "  ./install.sh                         # Install git-vault"
  echo "  ./install.sh --version v0.1.0        # Install specific version"
  echo "  ./install.sh --uninstall             # Remove git-vault"
  echo "  ./install.sh --local-zip ./path.zip  # Use local zip file"
}

# Main function
main() {
  # DEBUG: Print arguments
  echo "DEBUG: Script arguments: $@"

  # Parse arguments
  parse_args "$@"

  # Handle uninstall if requested
  if [ "$SHOULD_UNINSTALL" = "true" ]; then
    uninstall_git_vault
    exit 0
  fi

  info "Starting gv installation"

  # Check dependencies
  check_dependencies

  # Detect platform
  PLATFORM=$(detect_platform)
  info "Detected platform: $PLATFORM"

  # Get version to install (specified or latest)
  VERSION="$SPECIFIED_VERSION"
  if [ -z "$VERSION" ] && [ -z "$LOCAL_ZIP" ]; then
    VERSION=$(get_latest_version)
    info "Latest version: $VERSION"
  elif [ -n "$SPECIFIED_VERSION" ]; then
    info "Installing specified version: $VERSION"
  fi

  echo "DEBUG: About to check for existing gv installation"
  # Check if git-vault is already installed
  CURRENT_VERSION=$(check_installed_version)
  if [ -n "$CURRENT_VERSION" ] && [ -z "$LOCAL_ZIP" ]; then
    info "Found existing gv installation: $CURRENT_VERSION"

    # Compare versions
    compare_versions "$VERSION" "$CURRENT_VERSION"
    COMP_RESULT=$?

    if [ $COMP_RESULT -eq 2 ]; then
      info "Current version is the same as target version"
      read -p "Do you want to reinstall gv $CURRENT_VERSION? (y/n) " REINSTALL
      if [ "$REINSTALL" != "y" ] && [ "$REINSTALL" != "Y" ]; then
        info "Installation cancelled"
        exit 0
      fi
    elif [ $COMP_RESULT -eq 1 ]; then
      warning "Target version ($VERSION) is older than current version ($CURRENT_VERSION)"
      read -p "Do you want to downgrade to $VERSION? (y/n) " DOWNGRADE
      if [ "$DOWNGRADE" != "y" ] && [ "$DOWNGRADE" != "Y" ]; then
        info "Installation cancelled"
        exit 0
      fi
    else
      info "A newer version ($VERSION) is available"
      read -p "Do you want to upgrade from $CURRENT_VERSION to $VERSION? (y/n) " UPGRADE
      if [ "$UPGRADE" != "y" ] && [ "$UPGRADE" != "Y" ]; then
        info "Installation cancelled"
        exit 0
      fi
    fi
  fi

  echo "DEBUG: About to download and run"
  # Download and run git-vault
  download_and_run "$PLATFORM" "$VERSION" "$EXTRA_ARGS" "$LOCAL_ZIP"

  success "gv installation completed!"
}

# Execute main function
main "$@"
