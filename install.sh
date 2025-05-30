#!/usr/bin/env bash
# Git-Vault Installer
# One-line installation:
#   curl -fsSL ${RAW_CONTENT_URL}/install.sh | bash
#
# Install specific version:
#   curl -fsSL ${RAW_CONTENT_URL}/install.sh | bash -s -- --version v0.1.0
#
print_help() {
  echo "Git Vault - Installer"
  echo ""
  echo "Usage: ./install.sh [options]"
  echo ""
  echo "Options:"
  echo "  --version, -V VERSION  Install specific version (e.g., v0.1.0)"
  echo "  --uninstall, -u        Uninstall gv using the 'gv uninstall' command"
  echo "  --local-zip PATH       Use local zip file (for testing)"
  echo "  --help, -h             Show this help message"
  echo "  --verbose, -v          Enable verbose debugging output"
  echo "  --debug, -d            Enable debug mode (very verbose)"
  echo ""
  echo "Description:"
  echo "  This script downloads and installs gv, a tool for securely"
  echo "  storing sensitive files in Git repositories using GPG encryption."
  echo ""
  echo "Examples:"
  echo "  ./install.sh                         # Install gv"
  echo "  ./install.sh --version v0.1.0        # Install specific version"
  echo "  ./install.sh --uninstall             # Uninstall gv using built-in command"
  echo "  ./install.sh --local-zip ./path.zip  # Use local zip file"
  echo "  ./install.sh --verbose               # Install with verbose output"
  echo "  ./install.sh --debug                 # Install with debug output"
}

set -e

trap 'last_command=$current_command; current_command=$BASH_COMMAND' DEBUG
trap 'echo "ERROR: Command \"${last_command}\" failed with exit code $? at line ${LINENO}" >&2' ERR

REPO_OWNER="zackiles"
REPO_NAME="git-vault"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}"
REPO_API_URL="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}"
RAW_CONTENT_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main"

# Detect if we're being piped through curl and redirect errors to stdout if so
if [ -t 1 ]; then
  INTERACTIVE=true
else
  INTERACTIVE=false
  exec 2>&1
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_message() {
  local color="$1"
  local message="$2"
  local fd="${3:-1}"  # Default to stdout (fd 1)
  echo -e "${color}${message}${NC}" >&"$fd"
}

error() {
  print_message "${RED}" "ERROR: $1" 2  # Send to stderr (fd 2)
  exit 1
}

info() {
  print_message "${BLUE}" "INFO: $1"
}

success() {
  print_message "${GREEN}" "SUCCESS: $1"
}

warning() {
  print_message "${YELLOW}" "WARNING: $1"
}

debug() {
  if [ "$DEBUG" = "true" ]; then
    print_message "${BLUE}" "DEBUG: $1"
  fi
}

compare_versions() {
  local v1="${1#v}"
  local v2="${2#v}"

  local IFS='.'
  local i v1_parts=($v1) v2_parts=($v2)

  for ((i=0; i<${#v1_parts[@]} && i<${#v2_parts[@]}; i++)); do
    if [[ ${v1_parts[i]} -gt ${v2_parts[i]} ]]; then
      return 0
    elif [[ ${v1_parts[i]} -lt ${v2_parts[i]} ]]; then
      return 1
    fi
  done

  if [[ ${#v1_parts[@]} -gt ${#v2_parts[@]} ]]; then
    return 0
  elif [[ ${#v1_parts[@]} -lt ${#v2_parts[@]} ]]; then
    return 1
  fi

  return 2
}

detect_platform() {
  local os
  local arch
  local uname_s=$(uname -s)
  local uname_m=$(uname -m)

  case "$uname_s" in
    Linux*)  os="linux";;
    Darwin*) os="macos";;
    MINGW*|MSYS*|CYGWIN*) os="windows";;
    *)       error "Unsupported operating system: $uname_s

Supported operating systems:
- Linux (any distribution)
- macOS (Darwin)
- Windows (MINGW/MSYS/Cygwin)

If you believe this is an error, please report it at: ${REPO_URL}/issues";;
  esac

  case "$uname_m" in
    x86_64|amd64) arch="x64";;
    arm64|aarch64)
      if [ "$os" = "macos" ]; then
        os="macos-arm"
        arch="arm64"
      elif [ "$os" = "linux" ]; then
        os="linux-arm"
        arch="arm64"
      else
        arch="arm64"
      fi
      ;;
    *)       error "Unsupported architecture: $uname_m on $uname_s

Supported architectures:
- x86_64/amd64 (Intel/AMD 64-bit)
- arm64/aarch64 (ARM 64-bit)

If you believe this is an error, please report it at: ${REPO_URL}/issues";;
  esac

  echo "$os"
}

command_exists() {
  command -v "$1" &> /dev/null
}

check_dependencies() {
  local missing_deps=()

  if ! command_exists unzip; then
    warning "unzip not found, will try to use alternative methods for extraction"
  fi

  if ! command_exists git; then
    missing_deps+=("git")
  fi

  if ! command_exists gpg; then
    warning "gpg not found, will be required for git-vault to function properly"
  fi

  # Check for download tools
  if ! command_exists curl && ! command_exists wget; then
    missing_deps+=("curl or wget")
  fi

  if [ ${#missing_deps[@]} -gt 0 ]; then
    error "Missing required dependencies: ${missing_deps[*]}

Please install the missing dependencies and try again:
- On Ubuntu/Debian: sudo apt-get update && sudo apt-get install git curl
- On CentOS/RHEL: sudo yum install git curl
- On Alpine: apk add git curl
- On macOS: Install git and curl via Homebrew or Xcode Command Line Tools"
  fi
}

download_file() {
  local url="$1"
  local output_file="$2"
  local expected_checksum="${3:-}"

  info "Downloading from $url"

  if command_exists curl; then
    if ! curl -L -o "$output_file" --progress-bar "$url"; then
      error "Failed to download file from $url"
    fi
  elif command_exists wget; then
    if ! wget -O "$output_file" "$url"; then
      error "Failed to download file from $url"
    fi
  else
    error "Neither curl nor wget found for downloading"
  fi

  if [ -n "$expected_checksum" ]; then
    local actual_checksum=""

    if command_exists sha256sum; then
      actual_checksum=$(sha256sum "$output_file" | cut -d' ' -f1)
    elif command_exists shasum; then
      actual_checksum=$(shasum -a 256 "$output_file" | cut -d' ' -f1)
    elif command_exists certutil; then
      actual_checksum=$(certutil -hashfile "$output_file" SHA256 | grep -v "^SHA256" | grep -v "^CertUtil" | tr -d " \t\r\n")
    else
      warning "Checksum verification not available on this system"
      return 0
    fi

    if [ -n "$actual_checksum" ] && [ "$actual_checksum" != "$expected_checksum" ]; then
      error "Checksum verification failed for downloaded file"
    fi
  fi
}

get_latest_version() {
  local api_url="${REPO_API_URL}/releases/latest"
  local version
  local http_code

  info "Fetching latest version from GitHub API..."

  if command_exists curl; then
    # Try to get HTTP response code first
    http_code=$(curl -w '%{http_code}' -sSL "$api_url" -o /dev/null 2>/dev/null || echo "000")

    if [ "$http_code" != "200" ]; then
      error "Failed to fetch latest version from GitHub API (HTTP $http_code)

Possible causes:
- Network connectivity issues
- GitHub API rate limiting (try again in a few minutes)
- GitHub API is temporarily unavailable

API URL: $api_url

You can specify a version manually using: --version v0.1.0
Or check available versions at: ${REPO_URL}/releases"
    fi

    version=$(curl -sSL "$api_url" 2>/dev/null | grep '"tag_name":' | cut -d'"' -f4)
  elif command_exists wget; then
    version=$(wget -q -O - "$api_url" 2>/dev/null | grep '"tag_name":' | cut -d'"' -f4)

    if [ $? -ne 0 ]; then
      error "Failed to fetch latest version from GitHub API using wget

Possible causes:
- Network connectivity issues
- GitHub API rate limiting (try again in a few minutes)
- GitHub API is temporarily unavailable

API URL: $api_url

You can specify a version manually using: --version v0.1.0
Or check available versions at: ${REPO_URL}/releases"
    fi
  fi

  if [ -z "$version" ]; then
    error "Failed to parse version from GitHub API response

This could indicate:
- Unexpected API response format
- Network/parsing issues

API URL: $api_url

You can specify a version manually using: --version v0.1.0
Or check available versions at: ${REPO_URL}/releases"
  fi

  echo "$version"
}

extract_zip() {
  local zip_file="$1"
  local extract_dir="$2"

  info "Extracting to $extract_dir"

  if [ ! -f "$zip_file" ]; then
    error "Zip file not found at $zip_file"
  fi

  if ! file "$zip_file" | grep -q "Zip archive data" && ! file "$zip_file" | grep -q "ZIP archive"; then
    error "Invalid zip file at $zip_file. Downloaded file is not a valid zip archive."
  fi

  if command_exists unzip; then
    if ! unzip -t "$zip_file" > /dev/null 2>&1; then
      error "Zip file is corrupted or invalid: $zip_file"
    fi
    unzip -qo "$zip_file" -d "$extract_dir" || error "Failed to extract zip file: $zip_file"
  else
    if command_exists python3; then
      python3 -m zipfile -e "$zip_file" "$extract_dir" || error "Failed to extract zip file using Python: $zip_file"
    elif command_exists python; then
      python -m zipfile -e "$zip_file" "$extract_dir" || error "Failed to extract zip file using Python: $zip_file"
    else
      error "No method available to extract zip files. Please install unzip or Python and try again."
    fi
  fi
}

create_temp_dir() {
  if command_exists mktemp; then
    mktemp -d -t git-vault-XXXXXXXXXX
  else
    local temp_base=""

    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*)
        if [ -n "$TEMP" ]; then
          temp_base="$TEMP"
        elif [ -n "$TMP" ]; then
          temp_base="$TMP"
        else
          temp_base="$HOME/AppData/Local/Temp"
        fi
        ;;
      *)
        if [ -d "/tmp" ]; then
          temp_base="/tmp"
        else
          temp_base="$HOME/.temp"
          mkdir -p "$temp_base"
        fi
        ;;
    esac

    local temp_dir="${temp_base}/git-vault-$(date +%s)"
    mkdir -p "$temp_dir"
    echo "$temp_dir"
  fi
}

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    info "Cleaning up temporary files"
    rm -rf "$TEMP_DIR"
  fi
}

check_installed_version() {
  if command_exists gv; then
    local current_version
    current_version=$(gv version 2>/dev/null | grep -o 'v[0-9]*\.[0-9]*\.[0-9]*' || echo "unknown")
    if [ "$current_version" != "unknown" ]; then
      echo "$current_version"
      return 0
    fi
  fi
  echo ""
  return 1
}

get_bin_path() {
  local homeDir="$HOME"
  if [ -z "$homeDir" ]; then
    error "Could not determine user home directory"
  fi

  case "$(uname -s)" in
    Linux*)
      echo "$homeDir/.local/bin"
      ;;
    Darwin*)
      if [ -d "$homeDir/bin" ]; then
        echo "$homeDir/bin"
      else
        echo "$homeDir/.local/bin"
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "$homeDir/AppData/Local/Microsoft/WindowsApps"
      ;;
    *)
      error "Unsupported operating system: $(uname -s)"
      ;;
  esac
}

install_global_binary() {
  local src_file="$1"
  local bin_dir="$2"
  local binary_name="gv"
  local is_windows=false
  local path_sep=":"

  if [[ "$(uname -s)" == MINGW* ]] || [[ "$(uname -s)" == MSYS* ]] || [[ "$(uname -s)" == CYGWIN* ]]; then
    binary_name="gv.exe"
    is_windows=true
    path_sep=";"
  fi

  mkdir -p "$bin_dir" || error "Failed to create directory: $bin_dir"

  local target_path="$bin_dir/$binary_name"

  cp "$src_file" "$target_path" || error "Failed to copy executable to $target_path"

  if [ "$is_windows" = false ]; then
    chmod +x "$target_path" || error "Failed to make $target_path executable"
  fi

  if ! echo "$PATH" | tr "$path_sep" '\n' | grep -q "^$bin_dir$"; then
    info "Note: $bin_dir is not in your PATH"
    if [ "$is_windows" = true ]; then
      info "You may need to add it manually to use gv globally."
    else
      local shell_file=""
      if [ -f "$HOME/.zshrc" ]; then
        shell_file="$HOME/.zshrc"
      elif [ -f "$HOME/.bashrc" ]; then
        shell_file="$HOME/.bashrc"
      elif [ -f "$HOME/.bash_profile" ]; then
        shell_file="$HOME/.bash_profile"
      elif [ -f "$HOME/.profile" ]; then
        shell_file="$HOME/.profile"
      fi

      if [ -n "$shell_file" ]; then
        info "Consider adding the following line to $shell_file:"
        echo "export PATH=\"\$PATH$path_sep$bin_dir\""
      else
        info "Add $bin_dir to your PATH to use gv globally."
      fi
    fi
  fi

  return 0
}

download_and_install() {
  local platform="$1"
  local version="$2"
  local local_zip="$3"
  local path_sep=":"

  if [[ "$(uname -s)" == MINGW* ]] || [[ "$(uname -s)" == MSYS* ]] || [[ "$(uname -s)" == CYGWIN* ]]; then
    path_sep=";"
  fi

  TEMP_DIR=$(create_temp_dir)
  trap cleanup EXIT

  local zip_path="${TEMP_DIR}/gv.zip"

  if [ -n "$local_zip" ]; then
    info "Using local zip file: $local_zip"
    if [ ! -f "$local_zip" ]; then
      error "Local zip file does not exist: $local_zip"
    fi
    cp "$local_zip" "$zip_path" || error "Failed to copy local zip file to temp directory"
  else
    local zip_file_name
    case "$platform" in
      linux)
        zip_file_name="gv-x86_64-unknown-linux-gnu.zip"
        ;;
      linux-arm)
        zip_file_name="gv-aarch64-unknown-linux-gnu.zip"
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
    local asset_check_url="${download_url}"
    local http_code

    if command_exists curl; then
      http_code=$(curl -w '%{http_code}' -Isf "$asset_check_url" -o /dev/null || echo "000")

      if [ "$http_code" != "200" ]; then
        error "Release asset not found: $download_url (HTTP $http_code)
Please check ${REPO_URL}/releases for available assets."
      fi
    fi

    download_file "$download_url" "$zip_path"
  fi

  local executable
  case "$platform" in
    linux)
      executable="gv-x86_64-unknown-linux-gnu"
      ;;
    linux-arm)
      executable="gv-aarch64-unknown-linux-gnu"
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

  extract_zip "$zip_path" "$TEMP_DIR"

  if [ ! -f "$TEMP_DIR/$executable" ]; then
    ls -la "$TEMP_DIR"
    error "Executable not found after extraction: $executable"
  fi

  local bin_dir=$(get_bin_path)
  info "Installing gv to $bin_dir..."

  install_global_binary "$TEMP_DIR/$executable" "$bin_dir"

  success "gv installation completed to $bin_dir!"
  if ! echo "$PATH" | tr "$path_sep" '\n' | grep -q "^$bin_dir$"; then
    info "NOTE: You may need to restart your terminal or add $bin_dir to your PATH"
  fi
  info "Run 'gv init' to initialize git-vault in your Git repositories"
}

uninstall_git_vault() {
  info "Attempting to uninstall git-vault..."

  if command_exists gv; then
    info "Calling the gv binary to handle uninstallation"
    if gv uninstall; then
      success "Uninstallation completed by the gv binary"
    else
      error "Uninstallation via gv binary failed, please try again"
    fi
  else
    error "The gv binary was not found in your PATH. Make sure git-vault is installed before trying to uninstall it."
  fi
}

parse_args() {
  SHOULD_UNINSTALL=false
  SPECIFIED_VERSION=""
  LOCAL_ZIP=""
  VERBOSE=false
  DEBUG=false

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
      --local-zip)
        LOCAL_ZIP="$2"
        shift 2
        ;;
      --verbose|-v)
        VERBOSE=true
        shift
        ;;
      --debug|-d)
        DEBUG=true
        shift
        ;;
      *)
        warning "Unknown option: $1"
        shift
        ;;
    esac
  done
}

main() {
  parse_args "$@"

  if [ "$VERBOSE" = "true" ] || [ "$DEBUG" = "true" ]; then
    set -x
  fi

  if [ "$DEBUG" = "true" ]; then
    debug "Script started with arguments: $*"
    debug "Platform detected: $(uname -s) $(uname -m)"
    debug "Interactive mode: $INTERACTIVE"
    debug "Available commands: curl=$(command_exists curl), wget=$(command_exists wget), git=$(command_exists git), gpg=$(command_exists gpg)"
  fi

  if [ "$SHOULD_UNINSTALL" = "true" ]; then
    debug "Uninstall mode selected"
    uninstall_git_vault
    exit 0
  fi

  info "Starting gv installation"
  debug "About to check dependencies"

  check_dependencies
  debug "Dependencies check completed"

  PLATFORM=$(detect_platform)
  info "Detected platform: $PLATFORM"
  debug "Platform detection completed: $PLATFORM"

  VERSION="$SPECIFIED_VERSION"
  if [ -z "$VERSION" ] && [ -z "$LOCAL_ZIP" ]; then
    debug "No version specified, fetching latest from GitHub"
    VERSION=$(get_latest_version)
    info "Latest version: $VERSION"
  elif [ -n "$SPECIFIED_VERSION" ]; then
    info "Installing specified version: $VERSION"
  fi
  debug "Version determined: $VERSION"

  CURRENT_VERSION=$(check_installed_version)
  debug "Current installed version check completed: ${CURRENT_VERSION:-none}"

  if [ -n "$CURRENT_VERSION" ] && [ -z "$LOCAL_ZIP" ]; then
    info "Found existing gv installation: $CURRENT_VERSION"

    compare_versions "$VERSION" "$CURRENT_VERSION"
    COMP_RESULT=$?
    debug "Version comparison result: $COMP_RESULT"

    if [ $COMP_RESULT -eq 2 ]; then
      info "Current version is the same as target version"
      if [ "$INTERACTIVE" = "true" ]; then
        read -p "Do you want to reinstall gv $CURRENT_VERSION? (y/n) " REINSTALL
        if [ "$REINSTALL" != "y" ] && [ "$REINSTALL" != "Y" ]; then
          info "Installation cancelled"
          exit 0
        fi
      else
        info "Non-interactive mode: skipping reinstall of same version ($CURRENT_VERSION)"
        exit 0
      fi
    elif [ $COMP_RESULT -eq 1 ]; then
      warning "Target version ($VERSION) is older than current version ($CURRENT_VERSION)"
      if [ "$INTERACTIVE" = "true" ]; then
        read -p "Do you want to downgrade to $VERSION? (y/n) " DOWNGRADE
        if [ "$DOWNGRADE" != "y" ] && [ "$DOWNGRADE" != "Y" ]; then
          info "Installation cancelled"
          exit 0
        fi
      else
        info "Non-interactive mode: skipping downgrade from $CURRENT_VERSION to $VERSION"
        exit 0
      fi
    else
      info "A newer version ($VERSION) is available"
      if [ "$INTERACTIVE" = "true" ]; then
        read -p "Do you want to upgrade from $CURRENT_VERSION to $VERSION? (y/n) " UPGRADE
        if [ "$UPGRADE" != "y" ] && [ "$UPGRADE" != "Y" ]; then
          info "Installation cancelled"
          exit 0
        fi
      else
        info "Non-interactive mode: automatically upgrading from $CURRENT_VERSION to $VERSION"
      fi
    fi
  fi

  debug "About to start download and install process"
  download_and_install "$PLATFORM" "$VERSION" "$LOCAL_ZIP"

  success "gv installation completed!"
  info "You can now use 'gv init' to initialize git-vault in your Git repositories"
}

main "$@"
