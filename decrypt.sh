#!/usr/bin/env sh
# Git hook script: post-checkout / post-merge - Decrypts managed paths after checkout/merge.

set -eu # Exit on error, treat unset variables as error.
# pipefail is intentionally omitted here as the loop might process an empty manifest.

# --- Dependency Checks ---
command -v gpg >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault decrypt): gpg command not found! Decryption skipped."; exit 0; } # Don't block hook chain
command -v tar >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault decrypt): tar command not found! Decryption skipped."; exit 0; } # Don't block hook chain
command -v git >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault decrypt): git command not found! Decryption skipped."; exit 0; } # Don't block hook chain
command -v mkdir >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault decrypt): mkdir command not found! Decryption skipped."; exit 0; }
command -v rm >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault decrypt): rm command not found! Decryption skipped."; exit 0; }
# --- End Dependency Checks ---

# --- Environment Setup ---
# Hooks run from the .git directory or repo root depending on Git version.
# Robustly find the repo root.
REPO=$(git rev-parse --show-toplevel) || { echo "HOOK ERROR (git-vault decrypt): Could not determine repository root."; exit 0; } # Don't block hook chain
cd "$REPO" || { echo "HOOK ERROR (git-vault decrypt): Could not change to repository root '$REPO'."; exit 0; }

GIT_VAULT_DIR="git-vault"
MANIFEST="$GIT_VAULT_DIR/paths.list"
STORAGE_DIR="storage"

# --- Check if Manifest Exists ---
if [ ! -f "$MANIFEST" ]; then
  # This is normal if the tool hasn't been used yet.
  # echo "HOOK INFO (git-vault decrypt): Manifest '$MANIFEST' not found, nothing to decrypt." >&2
  exit 0 # No manifest, valid state, continue hook chain.
fi

# --- Process Manifest Entries ---
echo "HOOK: Running git-vault post-checkout/post-merge decryption..."
HAS_DECRYPTED_ANYTHING=0 # Track if we actually performed any decryption

# Use IFS='' and -r to handle paths with spaces or special characters correctly
while IFS=' ' read -r HASH PATH_IN REST || [ -n "$HASH" ]; do # Process even if last line has no newline
  # Skip comment lines (starting with #) and empty lines
  case "$HASH" in
    '#'*|'') continue ;;
  esac

  # Skip lines not matching the expected format (hash path) - simple check
  if [ -z "$HASH" ] || [ -z "$PATH_IN" ] || [ "${#HASH}" -ne 8 ]; then
      echo "HOOK INFO (git-vault decrypt): Skipping malformed line in $MANIFEST: $HASH $PATH_IN $REST" >&2
      continue
  fi

  PWFILE="$GIT_VAULT_DIR/git-vault-$HASH.pw"
  # Use tr for consistent slash-to-dash conversion (matching add.sh)
  ARCHIVE_NAME=$(echo "$PATH_IN" | tr '/' '-')
  ARCHIVE="$STORAGE_DIR/$ARCHIVE_NAME.tar.gz.gpg"
  TARGET_PATH="$REPO/$PATH_IN"

  # --- Pre-decryption Checks ---
  # 1. Check if password file exists
  if [ ! -f "$PWFILE" ]; then
    echo "HOOK INFO (git-vault decrypt): Password file '$PWFILE' for '$PATH_IN' (hash $HASH) missing. Skipping decryption for this path." >&2
    # This is expected if the user hasn't set up the password on this machine.
    continue # Skip this entry
  fi

  # 2. Check if the archive file exists
  if [ ! -f "$ARCHIVE" ]; then
    echo "HOOK INFO (git-vault decrypt): Archive file '$ARCHIVE' for '$PATH_IN' (hash $HASH) missing. Skipping decryption for this path." >&2
    # This can happen legitimately if the vault was just added but not committed/pulled yet,
    # or if there was a merge conflict involving the archive.
    continue # Skip this entry
  fi

  # --- Ensure Target Directory Exists and Prepare for Extraction ---
  TARGET_DIR=$(dirname "$TARGET_PATH")
  # Create parent directories if they don't exist
  if ! mkdir -p "$TARGET_DIR"; then
      echo "HOOK ERROR (git-vault decrypt): Failed to create parent directory '$TARGET_DIR' for '$PATH_IN'. Skipping decryption." >&2
      continue
  fi

  # Remove existing plaintext path *if it exists* before extracting.
  # This is crucial to avoid merging old/new content if extraction fails midway
  # or if the type changed (e.g., file to directory).
  if [ -e "$TARGET_PATH" ]; then
      echo "HOOK INFO (git-vault decrypt): Removing existing '$TARGET_PATH' before decryption."
      if ! rm -rf "$TARGET_PATH"; then
          echo "HOOK ERROR (git-vault decrypt): Failed to remove existing '$TARGET_PATH'. Skipping decryption." >&2
          continue
      fi
  fi

  # --- Perform Decryption and Extraction ---
  echo "HOOK: Decrypting '$ARCHIVE' -> '$PATH_IN' (hash: $HASH)"
  # Decrypt and extract. Use --yes for batch mode.
  # Extract relative to the REPO root (-C "$REPO").
  if ! gpg --batch --yes --passphrase-file "$PWFILE" -d "$ARCHIVE" | tar xzf - -C "$REPO"; then
    echo "HOOK ERROR (git-vault decrypt): Decryption or extraction failed for '$PATH_IN' (hash: $HASH)." >&2
    echo "       Check the password in '$PWFILE', the archive integrity ('$ARCHIVE'), and permissions." >&2
    # Don't abort the entire hook chain, as other decryptions might succeed.
    # The target path might be missing or incomplete after a failure.
  else
      HAS_DECRYPTED_ANYTHING=1 # Mark that we successfully decrypted something
  fi

done < "$MANIFEST"

# --- Final Hook Completion Message ---
if [ $HAS_DECRYPTED_ANYTHING -eq 1 ]; then
    echo "HOOK: git-vault post-checkout/post-merge decryption finished."
# else
    # echo "HOOK INFO (git-vault decrypt): No paths required decryption."
fi

exit 0 # Hooks should generally exit 0 unless there's a catastrophic failure that needs to block Git.
