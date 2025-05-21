# RFC: Git-Vault (DEPRECATED)

## Overview  
Many projects need to include sensitive folders in the repo for local use but must keep them hidden on public remotes. Git-Vault provides a wrapper around Git hooks and simple shell scripts to transparently encrypt selected folders into versioned archives and decrypt them on checkout/merge across macOS, Linux and Git-Bash on Windows.

## Components  
- **`git-vault/`** directory containing:  
  - `install.sh`  
  - `add.sh`  
  - `remove.sh`  
  - `encrypt.sh`  
  - `decrypt.sh`  
  - `paths.list` (Manifest file: `<hash> <relative_path>`)
- **Git hooks**: `pre-commit`, `post-checkout`, `post-merge`  
- **Password files**: per-resource files named `git-vault-<hash>.pw` inside `git-vault/` (ignored by Git)  
- **Encrypted archives**: stored under `storage/` as `<name>.tar.gz.gpg` (tracked by Git)
- **Git LFS configuration**: automatically set up for large archives (>5MB by default), ensuring binary large objects are efficiently handled

## Detailed Implementation

### 1. Directory Layout

This diagram shows the typical structure within a *user's target repository* after installing and using Git-Vault:

```txt

<project-root>/         # The user's repository
├── git-vault/           # Created by install.sh
│   ├── install.sh       # Copied by install.sh (optional, may not be needed post-install)
│   ├── add.sh           # Copied by install.sh
│   ├── remove.sh        # Copied by install.sh
│   ├── encrypt.sh       # Copied by install.sh
│   ├── decrypt.sh       # Copied by install.sh
│   ├── paths.list       # Created/managed here
│   └── git-vault-*.pw   # Created/managed here (ignored)
├── storage/
│   └── <name>.tar.gz.gpg # Archives (tracked)
└── .gitignore

```

The *source repository* (e.g., zackiles/git-vault) contains the scripts (`install.sh`, `add.sh`, etc.) and `paths.list` template at its root level.

### 2. `install.sh`
This script is run within the target repository (e.g., via `curl | bash` or by cloning the source repo and running `./install.sh`). It performs the following actions *in the target repository*:

1.  Create `git-vault/` and `storage/` directories if they don't exist.
2.  Copy the necessary scripts (`add.sh`, `remove.sh`, `encrypt.sh`, `decrypt.sh`) and the `paths.list` template from the source (e.g., fetched via curl or relative paths if run from a clone) into the target `git-vault/` directory.
3.  Create an empty `git-vault/paths.list` if it doesn't exist (or copy the template).
4.  Add `git-vault/*.pw` and potentially `git-vault/paths.list` (if secrets are derived from paths) to the root `.gitignore` if not already present. Ensure `storage/` is *not* ignored.
5.  Install Git hooks (`pre-commit`, `post-checkout`, `post-merge`) that execute the scripts located inside the `git-vault/` directory (using relative paths like `../git-vault/encrypt.sh` from within `.git/hooks/`).
6.  Check for Git LFS availability and set up LFS tracking for `storage/*.tar.gz.gpg` files if Git LFS is available.
7.  Accept an optional `--min-lfs=<size>` parameter to customize the threshold (in MB) for LFS tracking.
8.  Print usage instructions referring to the scripts inside `git-vault/` (e.g., `git-vault/add.sh <path>`).

### 3. `add.sh`

```sh
#!/usr/bin/env sh
set -euo pipefail
# Usage: add.sh <relative-path>

# --- Dependency Checks ---
command -v gpg >/dev/null 2>&1 || { echo >&2 "gpg is required but not installed. Aborting."; exit 1; }
command -v tar >/dev/null 2>&1 || { echo >&2 "tar is required but not installed. Aborting."; exit 1; }
SHASUM_CMD="sha1sum"
command -v sha1sum >/dev/null 2>&1 || SHASUM_CMD="shasum -a 1"
command -v "$SHASUM_CMD" >/dev/null 2>&1 || { echo >&2 "sha1sum (or shasum) is required. Aborting."; exit 1; }
# --- End Dependency Checks ---

REPO=$(git rev-parse --show-toplevel) # Use git to find root reliably
GIT_VAULT_DIR="$REPO/git-vault"
MANIFEST="$GIT_VAULT_DIR/paths.list"
PATH_IN=$1

# Validate path exists relative to repo root
[ -e "$REPO/$PATH_IN" ] || { echo "Path '$PATH_IN' does not exist relative to repo root '$REPO'."; exit 1; }

HASH=$(printf "%s" "$PATH_IN" | $SHASUM_CMD | cut -c1-8)
PWFILE="$GIT_VAULT_DIR/git-vault-$HASH.pw"
ARCHIVE_NAME=$(echo "$PATH_IN" | sed 's|/|-|g') # Keep readable archive names
ARCHIVE="$REPO/storage/$ARCHIVE_NAME.tar.gz.gpg"

# Check if already managed (via manifest)
grep -q "^$HASH " "$MANIFEST" && { echo "'$PATH_IN' (hash $HASH) is already managed."; exit 1; }

# Password handling
printf "Enter password for '%s': " "$PATH_IN" && read -r -s P; echo
printf "Confirm password: " && read -r -s Q; echo
[ "$P" = "$Q" ] || { echo "Passwords do not match."; exit 1; }

# Create PW file *first*, with restricted permissions
echo "$P" > "$PWFILE"
if [[ "$(uname)" == "Win"* || "$(uname)" == "MINGW"* || "$(uname)" == "MSYS"* ]]; then
  # Improve security on Windows Git Bash/MSYS if possible
  attrib +h "$PWFILE" >/dev/null 2>&1 || echo "Note: Could not set hidden attribute on '$PWFILE'."
  # Note: chmod might have limited effect on Windows FS, but set anyway
  chmod 600 "$PWFILE" >/dev/null 2>&1 || true
else
  chmod 600 "$PWFILE"
fi

# Test encryption/decryption in a temporary directory
TMP=$(mktemp -d)
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

if ! ( set -e; \
       cp -Rp "$REPO/$PATH_IN" "$TMP/src"; \
       echo "$P" | gpg --batch --passphrase-fd 0 --cipher-algo AES256 -o "$TMP/archive.gpg" -c "$TMP/src"; \
       mkdir "$TMP/out"; \
       echo "$P" | gpg --batch --passphrase-fd 0 -d "$TMP/archive.gpg" | tar xz -C "$TMP/out"; \
       diff -qr "$TMP/src" "$TMP/out/src" ); then
  echo "Encryption/decryption validation failed for '$PATH_IN'." >&2
  # --- Rollback: Remove the created password file ---
  rm -f "$PWFILE"
  echo "Removed potentially bad password file: $PWFILE" >&2
  exit 1
fi
trap - EXIT # Clear trap on success
rm -rf "$TMP" # Clean up temp dir

# Finalize: Create storage dir, add to manifest, create initial archive, add to gitignore
mkdir -p "$REPO/storage"
echo "$HASH $PATH_IN" >> "$MANIFEST"
# Perform initial encryption
tar czf - -C "$REPO" "$PATH_IN" | gpg --batch --passphrase-file "$PWFILE" --cipher-algo AES256 > "$ARCHIVE"

# Add archive to git (user should commit)
# Check if Git LFS is configured and if the archive is large enough to use LFS
if [ -f "$REPO/.vault/lfs-config" ]; then
  MIN_LFS=$(cat "$REPO/.vault/lfs-config")
  ARCHIVE_SIZE=$(du -m "$ARCHIVE" | cut -f1)
  
  if [ "$ARCHIVE_SIZE" -ge "$MIN_LFS" ] && command -v git-lfs >/dev/null 2>&1; then
    echo "Large archive detected ($ARCHIVE_SIZE MB). Using Git LFS for tracking."
    
    # Ensure .gitattributes exists
    touch "$REPO/.gitattributes"
    
    # Add LFS tracking for this specific file if not already tracked
    if ! grep -q "^$ARCHIVE" "$REPO/.gitattributes"; then
      echo "$ARCHIVE filter=lfs diff=lfs merge=lfs -text" >> "$REPO/.gitattributes"
      git add "$REPO/.gitattributes"
    fi
  fi
fi

git add "$ARCHIVE"

# Ensure plaintext path is ignored
if ! grep -qx "/$PATH_IN/" "$REPO/.gitignore"; then
  echo "Adding '/$PATH_IN/' to .gitignore"
  echo "/$PATH_IN/" >> "$REPO/.gitignore"
  git add "$REPO/.gitignore" # Stage the .gitignore change too
fi

echo "'$PATH_IN' is now managed by git-vault. Commit the changes."
```

### 4. `remove.sh`

```sh
#!/usr/bin/env sh
set -euo pipefail
# Usage: remove.sh <relative-path>

# --- Dependency Checks ---
command -v gpg >/dev/null 2>&1 || { echo >&2 "gpg is required but not installed. Aborting."; exit 1; }
SHASUM_CMD="sha1sum"
command -v sha1sum >/dev/null 2>&1 || SHASUM_CMD="shasum -a 1"
command -v "$SHASUM_CMD" >/dev/null 2>&1 || { echo >&2 "sha1sum (or shasum) is required. Aborting."; exit 1; }
# --- End Dependency Checks ---

REPO=$(git rev-parse --show-toplevel)
GIT_VAULT_DIR="$REPO/git-vault"
MANIFEST="$GIT_VAULT_DIR/paths.list"
PATH_IN=$1

HASH=$(printf "%s" "$PATH_IN" | $SHASUM_CMD | cut -c1-8)
PWFILE="$GIT_VAULT_DIR/git-vault-$HASH.pw"
ARCHIVE_NAME=$(echo "$PATH_IN" | sed 's|/|-|g')
ARCHIVE="$REPO/storage/$ARCHIVE_NAME.tar.gz.gpg"

# Check if managed
if ! grep -q "^$HASH " "$MANIFEST"; then
    echo "'$PATH_IN' (hash $HASH) is not managed by git-vault."
    exit 1
fi
[ -f "$PWFILE" ] || { echo "Password file '$PWFILE' missing, cannot verify."; exit 1; }
[ -f "$ARCHIVE" ] || { echo "Archive file '$ARCHIVE' missing, cannot verify."; exit 1; }

# Verify password by attempting decryption (discard output)
if ! echo "$(cat "$PWFILE")" | gpg --batch --passphrase-fd 0 -d "$ARCHIVE" > /dev/null 2>&1; then
  echo "Password verification failed for '$PATH_IN'. Check '$PWFILE'." >&2
  exit 1
fi

echo "Password verified for '$PATH_IN'."

# Remove from manifest
sed -i.bak "/^$HASH /d" "$MANIFEST"
rm -f "$MANIFEST.bak" # Clean up backup file

# Rename password file
mv "$PWFILE" "${PWFILE%.pw}.removed"
echo "Renamed password file to '${PWFILE%.pw}.removed'."

# Remove archive from Git and filesystem
git rm --cached "$ARCHIVE" > /dev/null # Untrack if tracked
rm -f "$ARCHIVE"
echo "Removed archive file '$ARCHIVE'."

# Offer to remove from .gitignore (optional)
if grep -qx "/$PATH_IN/" "$REPO/.gitignore"; then
  printf "Remove '/%s/' from .gitignore? [y/N]: " "$PATH_IN" && read -r response
  if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
    sed -i.bak "\|^/$PATH_IN/|d" "$REPO/.gitignore"
    rm -f "$REPO/.gitignore.bak"
    echo "Removed '/$PATH_IN/' from .gitignore. Stage and commit the change."
    git add "$REPO/.gitignore"
  else
    echo "Keeping '/$PATH_IN/' in .gitignore."
  fi
fi

echo "'$PATH_IN' unmanaged. Remember to commit changes to .gitignore and the manifest."
```

### 5. `encrypt.sh` (Git Hook: `pre-commit`)

```sh
#!/usr/bin/env sh
set -eu # pipefail can cause issues if list is empty

# --- Dependency Checks ---
command -v gpg >/dev/null 2>&1 || { echo >&2 "HOOK ERROR: gpg not found!"; exit 1; }
command -v tar >/dev/null 2>&1 || { echo >&2 "HOOK ERROR: tar not found!"; exit 1; }
# --- End Dependency Checks ---

REPO=$(git rev-parse --show-toplevel)
GIT_VAULT_DIR="$REPO/git-vault"
MANIFEST="$GIT_VAULT_DIR/paths.list"
STORAGE_DIR="$REPO/storage"

if [ ! -f "$MANIFEST" ]; then
  echo "HOOK INFO: Manifest '$MANIFEST' not found, nothing to encrypt."
  exit 0 # No manifest, nothing to do
fi

echo "HOOK: Running git-vault encrypt..."
EXIT_CODE=0
while read -r HASH PATH_IN; do
  # Skip empty lines or lines without space
  [ -z "$HASH" ] || [ -z "$PATH_IN" ] && continue

  PWFILE="$GIT_VAULT_DIR/git-vault-$HASH.pw"
  ARCHIVE_NAME=$(echo "$PATH_IN" | sed 's|/|-|g')
  ARCHIVE="$STORAGE_DIR/$ARCHIVE_NAME.tar.gz.gpg"

  # Check if password file exists and path exists in working tree
  if [ ! -f "$PWFILE" ]; then
    echo "HOOK WARN: Password file '$PWFILE' for '$PATH_IN' missing, cannot encrypt." >&2
    continue # Skip this entry, maybe removed?
  fi
  if [ ! -e "$REPO/$PATH_IN" ]; then
    echo "HOOK WARN: Path '$REPO/$PATH_IN' for hash '$HASH' not found, cannot encrypt." >&2
    continue # Skip this entry, maybe removed?
  fi

  # Re-encrypt the current content from the working tree
  echo "HOOK: Encrypting '$PATH_IN' -> '$ARCHIVE'"
  if ! tar czf - -C "$REPO" "$PATH_IN" | gpg --batch --passphrase-file "$PWFILE" --cipher-algo AES256 > "$ARCHIVE"; then
      echo "HOOK ERROR: Encryption failed for '$PATH_IN' (hash: $HASH)." >&2
      EXIT_CODE=1 # Mark failure, but continue checking others
      continue
  fi

  # Add the updated archive to the staging area
  git add "$ARCHIVE"

done < "$MANIFEST" # Read hash and path from manifest

if [ $EXIT_CODE -ne 0 ]; then
  echo "HOOK ERROR: One or more git-vault encryptions failed. Aborting commit." >&2
fi
exit $EXIT_CODE # Exit with 0 if all succeeded, 1 otherwise
```

### 6. `decrypt.sh` (Git Hooks: `post-checkout` & `post-merge`)

```sh
#!/usr/bin/env sh
set -eu # pipefail can cause issues if list is empty

# --- Dependency Checks ---
command -v gpg >/dev/null 2>&1 || { echo >&2 "HOOK ERROR: gpg not found!"; exit 1; }
command -v tar >/dev/null 2>&1 || { echo >&2 "HOOK ERROR: tar not found!"; exit 1; }
# --- End Dependency Checks ---

REPO=$(git rev-parse --show-toplevel)
GIT_VAULT_DIR="$REPO/git-vault"
MANIFEST="$GIT_VAULT_DIR/paths.list"
STORAGE_DIR="$REPO/storage"

if [ ! -f "$MANIFEST" ]; then
  # echo "HOOK INFO: Manifest '$MANIFEST' not found, nothing to decrypt." # Usually too verbose for these hooks
  exit 0 # No manifest, nothing to do
fi

echo "HOOK: Running git-vault decrypt..."
while read -r HASH PATH_IN; do
  # Skip empty lines or lines without space
  [ -z "$HASH" ] || [ -z "$PATH_IN" ] && continue

  PWFILE="$GIT_VAULT_DIR/git-vault-$HASH.pw"
  ARCHIVE_NAME=$(echo "$PATH_IN" | sed 's|/|-|g')
  ARCHIVE="$STORAGE_DIR/$ARCHIVE_NAME.tar.gz.gpg"

  # Check if password file and archive exist
  if [ ! -f "$PWFILE" ]; then
    # echo "HOOK INFO: Password file for '$PATH_IN' (hash $HASH) missing, skipping decryption." >&2 # Optional: too verbose?
    continue
  fi
  if [ ! -f "$ARCHIVE" ]; then
    # echo "HOOK INFO: Archive file for '$PATH_IN' (hash $HASH) missing, skipping decryption." >&2 # Optional: too verbose?
    # This can happen legitimately if the vault was just added but not committed/pushed yet.
    continue
  fi

  # Ensure target directory exists (handle potential file/dir conflicts carefully)
  TARGET_PATH="$REPO/$PATH_IN"
  TARGET_DIR=$(dirname "$TARGET_PATH")
  mkdir -p "$TARGET_DIR" # Ensure parent exists

  # Remove existing plaintext *if it exists* before extracting
  # Important to avoid merging old/new content if extraction fails midway
  if [ -e "$TARGET_PATH" ]; then
      rm -rf "$TARGET_PATH"
  fi

  echo "HOOK: Decrypting '$ARCHIVE' -> '$PATH_IN'"
  # Decrypt and extract, ensuring extraction happens relative to REPO root
  if ! gpg --batch --passphrase-file "$PWFILE" -d "$ARCHIVE" | tar xzf - -C "$REPO"; then
    echo "HOOK ERROR: Decryption failed for '$PATH_IN' (hash: $HASH). Plaintext version might be missing or incomplete." >&2
    # Don't abort the hook, as other decryptions might succeed.
    # Consider restoring from index? Too complex for simple script.
    # Just leave the path potentially empty/partially extracted.
  fi

done < "$MANIFEST" # Read hash and path from manifest

echo "HOOK: git-vault decrypt finished."
exit 0 # Hooks should generally exit 0 unless catastrophic failure
```

### 7. Git Hook Installation

Logic within `install.sh` to add or update hooks safely:

```sh
#!/usr/bin/env sh
# (Inside install.sh)
# ... other install steps ...

REPO_ROOT=$(git rev-parse --show-toplevel)
GIT_DIR=$(git rev-parse --git-dir) # Usually .git, but could be elsewhere
HOOKS_DIR="$GIT_DIR/hooks"
GIT_VAULT_DIR_REL="git-vault" # Relative path to vault scripts from repo root

mkdir -p "$HOOKS_DIR"

echo "Installing/updating Git hooks..."

install_hook() {
  local hook_name="$1" # e.g., pre-commit
  local script_name="$2" # e.g., encrypt.sh
  local hook_path="$HOOKS_DIR/$hook_name"
  local hook_script_line="$GIT_VAULT_DIR_REL/$script_name \"\$@\""
  local marker="# git-vault hook"

  echo " - Processing $hook_name hook..."

  if [ -f "$hook_path" ]; then
    # Hook exists, check if our line is already there
    if grep -Fxq "$marker" "$hook_path" && grep -Fxq "$hook_script_line" "$hook_path"; then
      echo "   git-vault command already present in $hook_name."
      chmod +x "$hook_path" # Ensure it's executable
      return 0
    elif grep -Fxq "$marker" "$hook_path"; then
       echo "   WARN: Found git-vault marker but script line differs or is missing."
       echo "   Please check hook '$hook_path' manually."
       # Decide whether to append or exit here? For safety, maybe just warn.
       return 1 # Indicate potential issue
    else
      # Hook exists but doesn't seem to have our marker
      echo "   Existing $hook_name hook found. Appending git-vault command."
      # Backup existing hook
      cp "$hook_path" "$hook_path.bak.$(date +%s)"
      printf "\n%s\n%s\n" "$marker" "$hook_script_line" >> "$hook_path"
      chmod +x "$hook_path"
      echo "   Appended to $hook_name. Backup created at $hook_path.bak.*"
    fi
  else
    # Hook doesn't exist, create it
    echo "   Creating $hook_name hook."
    printf "#!/usr/bin/env sh\n\n%s\n%s\n" "$marker" "$hook_script_line" > "$hook_path"
    chmod +x "$hook_path"
    echo "   Created $hook_path."
  fi
}

install_hook "pre-commit" "encrypt.sh"
install_hook "post-checkout" "decrypt.sh"
install_hook "post-merge" "decrypt.sh"

echo "Hook installation complete."

# ... rest of install.sh ...
```

### 8. Git LFS Integration

To properly manage large encrypted archives, including binary large objects like images, videos, and datasets, Git-Vault integrates with Git LFS when available:

```sh
#!/usr/bin/env sh
# (Inside install.sh)
# ... other install steps ...

# Check for Git LFS and set up if available
MIN_LFS=${MIN_LFS:-5} # Default 5MB threshold, can be overridden with --min-lfs parameter

# Parse command line arguments for --min-lfs
for arg in "$@"; do
  case $arg in
    --min-lfs=*)
      MIN_LFS="${arg#*=}"
      # Validate that it's a number
      if ! [[ "$MIN_LFS" =~ ^[0-9]+$ ]]; then
        echo "Error: --min-lfs value must be a positive integer. Using default of 5MB."
        MIN_LFS=5
      fi
      shift
      ;;
  esac
done

# Store the LFS threshold for later use by add.sh
echo "$MIN_LFS" > "$REPO_ROOT/git-vault/lfs-config"

# Check if Git LFS is available
if command -v git-lfs >/dev/null 2>&1; then
  echo "Git LFS detected. Setting up LFS for large encrypted archives (>${MIN_LFS}MB)..."
  
  # Initialize Git LFS if not already done
  if ! git lfs ls-files >/dev/null 2>&1; then
    git lfs install
  fi
  
  # Create or update .gitattributes
  touch "$REPO_ROOT/.gitattributes"
  
  # Add pattern for tracking the storage directory (but only large files will be tracked)
  if ! grep -q "storage/\*.tar.gz.gpg" "$REPO_ROOT/.gitattributes"; then
    echo "# Git LFS tracking for large git-vault archives (added by git-vault)" >> "$REPO_ROOT/.gitattributes"
    echo "storage/*.tar.gz.gpg filter=lfs diff=lfs merge=lfs -text" >> "$REPO_ROOT/.gitattributes"
    git add "$REPO_ROOT/.gitattributes"
    echo "Added Git LFS tracking pattern to .gitattributes"
  fi
  
  echo "Git LFS setup complete. Archives larger than ${MIN_LFS}MB will be tracked via LFS."
  echo "This ensures efficient handling of binary large objects like images, videos, and datasets."
else
  echo "Git LFS not found. Large encrypted archives will be tracked normally."
  echo "Install Git LFS for better performance with large files and binary large objects."
fi
```

### 9. Cross-Platform Guarantees

*   Shebang `#!/usr/bin/env sh` targets POSIX compatibility.
*   Dependency checks (`gpg`, `tar`, `sha1sum`/`shasum`) added.
*   `sha1sum` / `shasum -a 1` handled via `SHASUM_CMD` variable.
*   `mktemp` standard on Linux/macOS; provided by Git Bash.
*   `gpg` assumed available via package managers (`brew`, `apt`, `pacman`, etc.) or included with Git for Windows.
*   Windows (`uname` check): Attempts `attrib +h` for `.pw` files, falls back gracefully. `chmod 600` used but may have limited effect on Windows filesystems.

```sh
# Install dependencies:
# macOS: brew install gpg
# Debian/Ubuntu: sudo apt update && sudo apt install gnupg tar coreutils
# Fedora: sudo dnf install gnupg tar coreutils
# Arch: sudo pacman -S gnupg tar coreutils
# Windows (Git Bash): Usually includes necessary tools. If missing: pacman -S gnupg coreutils
```
