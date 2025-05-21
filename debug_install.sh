#!/usr/bin/env bash
# Git-Vault Debug Installer
# This script helps diagnose issues with the git-vault installer

# Enable bash debug mode to see each command as it's executed
set -x

# Redirect stderr to stdout to ensure we see all output
exec 2>&1

# Set up error trapping
set -e
trap 'echo "ERROR: Last command failed with status $? at line $LINENO"' ERR

echo "DIAGNOSTIC: Starting diagnostics..."
echo "DIAGNOSTIC: System information:"
uname -a
echo "DIAGNOSTIC: Architecture: $(uname -m)"
echo "DIAGNOSTIC: OS: $(uname -s)"

# Detect platform
detect_platform() {
  case "$(uname -s)" in
    Darwin*)
      if [ "$(uname -m)" = "arm64" ]; then
        echo "macos-arm"
      else
        echo "macos"
      fi
      ;;
    Linux*) echo "linux" ;;
    *) echo "unknown" ;;
  esac
}

PLATFORM=$(detect_platform)
echo "DIAGNOSTIC: Platform detected: $PLATFORM"

# Determine expected file name
case "$PLATFORM" in
  macos) ZIP_FILE="gv-x86_64-apple-darwin.zip" ;;
  macos-arm) ZIP_FILE="gv-aarch64-apple-darwin.zip" ;;
  linux) ZIP_FILE="gv-x86_64-unknown-linux-gnu.zip" ;;
  *) ZIP_FILE="unknown" ;;
esac

GITHUB_REPO="https://github.com/zackiles/git-vault"
VERSION="v0.0.4"
DOWNLOAD_URL="${GITHUB_REPO}/releases/download/${VERSION}/${ZIP_FILE}"

echo "DIAGNOSTIC: Testing network connectivity..."
echo "DIAGNOSTIC: Resolving github.com..."
ping -c 1 github.com || echo "WARNING: Cannot ping github.com"

echo "DIAGNOSTIC: Checking if curl exists..."
if ! command -v curl > /dev/null; then
  echo "ERROR: curl not found! Please install curl."
  exit 1
fi

echo "DIAGNOSTIC: Checking GitHub releases page..."
curl -IL "${GITHUB_REPO}/releases" || echo "WARNING: Could not access releases page"

echo "DIAGNOSTIC: Checking release asset metadata..."
ASSET_CODE=$(curl -IL -o /dev/null -w "%{http_code}" "${DOWNLOAD_URL}" || echo "ERROR")
echo "DIAGNOSTIC: HTTP status code for ${DOWNLOAD_URL}: ${ASSET_CODE}"

if [ "$ASSET_CODE" = "200" ]; then
  echo "DIAGNOSTIC: Asset exists! Now trying to download it..."

  # Create temp directory
  TEMP_DIR=$(mktemp -d)
  echo "DIAGNOSTIC: Created temp directory: $TEMP_DIR"

  echo "DIAGNOSTIC: Downloading asset to $TEMP_DIR/$ZIP_FILE..."
  curl -vL "${DOWNLOAD_URL}" -o "$TEMP_DIR/$ZIP_FILE"

  echo "DIAGNOSTIC: Download complete. Checking file..."
  ls -la "$TEMP_DIR/$ZIP_FILE" || echo "ERROR: File not downloaded correctly"

  echo "DIAGNOSTIC: Checking if unzip is available..."
  if command -v unzip > /dev/null; then
    echo "DIAGNOSTIC: Unzipping file..."
    unzip -l "$TEMP_DIR/$ZIP_FILE" || echo "ERROR: Failed to list zip contents"

    echo "DIAGNOSTIC: Extracting zip file..."
    unzip -o "$TEMP_DIR/$ZIP_FILE" -d "$TEMP_DIR" || echo "ERROR: Failed to extract zip"

    echo "DIAGNOSTIC: Listing extracted files..."
    ls -la "$TEMP_DIR"
  else
    echo "ERROR: unzip command not available"
  fi

  # Cleanup
  echo "DIAGNOSTIC: Cleaning up temp directory..."
  rm -rf "$TEMP_DIR"
else
  echo "ERROR: Asset not found at ${DOWNLOAD_URL} (HTTP code: ${ASSET_CODE})"
  echo "DIAGNOSTIC: Checking GitHub API for release info..."
  curl -sL "https://api.github.com/repos/zackiles/git-vault/releases/tags/${VERSION}" | grep -E "name|browser_download_url" || echo "ERROR: Could not get release info"

  echo "DIAGNOSTIC: Listing available releases..."
  curl -sL "https://api.github.com/repos/zackiles/git-vault/releases" | grep "tag_name" || echo "ERROR: Could not list releases"
fi

echo "DIAGNOSTIC: Diagnostic run complete."
