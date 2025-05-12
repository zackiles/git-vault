#!/usr/bin/env sh
# Git hook script: pre-commit - Encrypts managed paths before commit.

set -eu # Exit on error, treat unset variables as error.
# pipefail is intentionally omitted here as the loop might process an empty manifest.

# --- Dependency Checks ---
command -v gpg >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault encrypt): gpg command not found! Aborting commit."; exit 1; }
command -v tar >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault encrypt): tar command not found! Aborting commit."; exit 1; }
command -v git >/dev/null 2>&1 || { echo >&2 "HOOK ERROR (git-vault encrypt): git command not found! Aborting commit."; exit 1; }
# --- End Dependency Checks ---

# --- Environment Setup ---
# Hooks run from the .git directory or repo root depending on Git version.
# Robustly find the repo root.
REPO=$(git rev-parse --show-toplevel) || { echo "HOOK ERROR (git-vault encrypt): Could not determine repository root."; exit 1; }
cd "$REPO" || { echo "HOOK ERROR (git-vault encrypt): Could not change to repository root '$REPO'."; exit 1; }

GIT_VAULT_DIR=".git-vault"
MANIFEST="$GIT_VAULT_DIR/paths.list"
STORAGE_DIR="$GIT_VAULT_DIR/storage"

# --- Check if Manifest Exists ---
if [ ! -f "$MANIFEST" ]; then
  # echo "HOOK INFO (git-vault encrypt): Manifest '$MANIFEST' not found, nothing to encrypt." >&2
  exit 0 # No manifest, valid state, allow commit.
fi

# --- Process Manifest Entries ---
echo "HOOK: Running git-vault pre-commit encryption..."
EXIT_CODE=0 # Overall exit code for the hook
HAS_ENCRYPTED_ANYTHING=0 # Track if we actually performed any encryption

# Use IFS='' and -r to handle paths with spaces or special characters correctly
while IFS=' ' read -r HASH PATH_IN REST || [ -n "$HASH" ]; do # Process even if last line has no newline
  # Skip comment lines (starting with #) and empty lines
  case "$HASH" in
    '#'*|'') continue ;;
  esac

  # Skip lines not matching the expected format (hash path) - simple check
  if [ -z "$HASH" ] || [ -z "$PATH_IN" ] || [ "${#HASH}" -ne 8 ]; then
      echo "HOOK INFO (git-vault encrypt): Skipping malformed line in $MANIFEST: $HASH $PATH_IN $REST" >&2
      continue
  fi

  PWFILE="$GIT_VAULT_DIR/git-vault-$HASH.pw"
  # Use tr for consistent slash-to-dash conversion (matching add.sh)
  ARCHIVE_NAME=$(echo "$PATH_IN" | tr '/' '-')
  ARCHIVE="$STORAGE_DIR/$ARCHIVE_NAME.tar.gz.gpg"

  # --- Pre-encryption Checks ---
  # 1. Check if password file exists
  if [ ! -f "$PWFILE" ]; then
    echo "HOOK WARN (git-vault encrypt): Password file '$PWFILE' for '$PATH_IN' (hash $HASH) missing. Cannot encrypt this path." >&2
    # This is potentially recoverable if the user adds the pw file, but for a hook, it's safer to warn and maybe fail later.
    # Consider setting EXIT_CODE=1 here if missing pw should block commit.
    continue # Skip this entry
  fi

  # 2. Check if the plaintext path exists in the working tree
  if [ ! -e "$PATH_IN" ]; then
    # This might be okay if the user intentionally removed the path but forgot to run remove.sh
    # Or it could be an intermediate state during a complex merge/rebase.
    # Let's only warn, as the archive should still be in Git.
    # If the archive is *also* missing, decryption hooks might handle it.
    echo "HOOK INFO (git-vault encrypt): Plaintext path '$PATH_IN' (hash $HASH) not found in working tree. Skipping encryption for this path." >&2
    continue # Skip encryption for this path
  fi

  # 3. Check if the path is actually staged for commit
  # Use git diff --cached --quiet to check if PATH_IN (or anything inside it if dir) is staged
  if git diff --cached --quiet -- "$PATH_IN"; then
    # Path is not staged, no need to re-encrypt
    # echo "HOOK INFO (git-vault encrypt): Path '$PATH_IN' is not staged for commit. Skipping encryption." >&2
    continue
  fi

  # --- Perform Encryption ---
  echo "HOOK: Encrypting '$PATH_IN' -> '$ARCHIVE' (hash: $HASH)"
  # Use -C to ensure paths inside tarball are relative to repo root
  # Use --yes with gpg in batch mode to avoid prompts
  if ! tar czf - -C "$REPO" "$PATH_IN" | gpg --batch --yes --passphrase-file "$PWFILE" -c -o "$ARCHIVE"; then
      echo "HOOK ERROR (git-vault encrypt): Encryption failed for '$PATH_IN' (hash: $HASH)." >&2
      echo "       Check the password in '$PWFILE' and ensure '$PATH_IN' is accessible." >&2
      EXIT_CODE=1 # Mark failure, commit should be aborted
      continue # Try next entry if any
  fi

  # --- Stage the Updated Archive ---
  # Add the updated archive to the Git staging area
  git add "$ARCHIVE"
  HAS_ENCRYPTED_ANYTHING=1 # Mark that we did something

done < "$MANIFEST"

# --- Final Hook Exit Status ---
if [ $EXIT_CODE -ne 0 ]; then
  echo "HOOK ERROR (git-vault encrypt): One or more encryptions failed. Aborting commit." >&2
elif [ $HAS_ENCRYPTED_ANYTHING -eq 1 ]; then
  echo "HOOK: git-vault pre-commit encryption finished successfully."
# else
  # echo "HOOK INFO (git-vault encrypt): No paths required encryption."
fi

exit $EXIT_CODE # Exit with 0 if all successes, 1 if any failure
