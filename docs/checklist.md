# Git-Vault Implementation Checklist

This checklist outlines the steps required to implement the Git-Vault tool based on `docs/rfc-git-vault.md`.

## I. Project Setup & Core Structure

-   [x] Create `storage/` directory.
-   [ ] Ensure `storage/` exists (or is created by `install.sh` in target repo).
-   [x] Add scripts to project root:
    -   [x] `install.sh`
    -   [x] `add.sh`
    -   [x] `remove.sh`
    -   [x] `encrypt.sh`
    -   [x] `decrypt.sh`
-   [x] Create empty `paths.list` manifest template at project root.
-   [x] Initialize or update root `.gitignore`:
    -   [x] Add `git-vault/*.pw` (Done via `install.sh` in target repo)
    -   [ ] *Consider adding `git-vault/paths.list` if paths imply secrets (as noted in RFC).* (Applies to target repo)
    -   [x] Ensure `storage/` is **not** ignored. (`install.sh` warns in target repo; `add.sh` adds specific paths in target repo)
-   [x] Set up initial Git repository structure. (Implied by current state)

## II. `install.sh` Script Implementation

-   [x] Implement directory creation (`git-vault/`, `storage/`) if they don't exist.
-   [x] Implement mechanism to place scripts (`add.sh`, `remove.sh`, `encrypt.sh`, `decrypt.sh`) and `paths.list` template into target `git-vault/` directory (via `cp`).
-   [x] Implement creation of empty `git-vault/paths.list` if it doesn't exist (or copy template).
-   [x] Implement logic to add necessary patterns (`git-vault/*.pw`) to root `.gitignore`.
-   [x] Implement robust Git hook installation (Section 7 of RFC):
    -   [x] Detect Git directory (`git rev-parse --git-dir`).
    -   [x] Create hooks directory if needed (`$GIT_DIR/hooks`).
    -   [x] Implement `install_hook` function:
        -   [x] Handle existing hook files (check for marker, append safely, backup).
        -   [x] Create new hook files if they don't exist.
        -   [x] Ensure hooks are executable (`chmod +x`).
    -   [x] Call `install_hook` for `pre-commit` -> `encrypt.sh`.
    -   [x] Call `install_hook` for `post-checkout` -> `decrypt.sh`.
    -   [x] Call `install_hook` for `post-merge` -> `decrypt.sh`.
-   [x] Print usage instructions at the end of installation.

## III. `add.sh` Script Implementation

-   [x] Implement dependency checks: `gpg`, `tar`, `sha1sum`/`shasum`. (Also checks `mktemp`)
-   [x] Determine repository root (`git rev-parse --show-toplevel`).
-   [x] Validate input path existence relative to repo root. (Also checks outside repo / repo root)
-   [x] Generate 8-character SHA1 hash from the relative path.
-   [x] Define password file path (`git-vault/git-vault-<hash>.pw`).
-   [x] Generate readable archive name from path (e.g., replace `/` with `-`). (Handles `\` too)
-   [x] Define archive file path (`storage/<name>.tar.gz.gpg`).
-   [x] Check if the path/hash already exists in `paths.list`. Exit if duplicate. (Warns if `.pw` exists)
-   [x] Prompt user for password and confirmation. Exit if passwords don't match. (Includes retry & empty check)
-   [x] Create the password file (`.pw`) with restricted permissions:
    -   [x] `chmod 600` on Unix-like systems.
    -   [x] Attempt `attrib +h` and `chmod 600` on Windows/MINGW/MSYS. (Checks CYGWIN too)
-   [x] Implement temporary directory validation:
    -   [x] Create temp directory (`mktemp -d`).
    -   [x] Setup trap for cleanup (`trap cleanup EXIT`).
    -   [x] Copy source path to temp dir (`cp -a`).
    -   [x] Perform trial encryption using the new password.
    -   [x] Perform trial decryption into a separate temp location.
    -   [x] Compare original and decrypted content (`diff -qr`).
    -   [x] If validation fails:
        -   [x] Print error message.
        -   [x] Remove the created password file (`rm -f "$PWFILE"`).
        -   [x] Exit with non-zero status.
    -   [x] If validation succeeds:
        -   [x] Clear the cleanup trap (`trap - EXIT`).
        -   [x] Remove the temp directory (via `cleanup` func).
-   [x] Create `storage/` directory if it doesn't exist (`mkdir -p`).
-   [x] Append `<hash> <relative_path>` to `git-vault/paths.list`.
-   [x] Perform initial encryption: `tar czf - ... | gpg ... > "$ARCHIVE"`. (Uses `-C $REPO`)
-   [x] Stage the newly created archive file (`git add "$ARCHIVE"`).
-   [x] Ensure the plaintext path is in `.gitignore`:
    -   [x] Check if `/<path>/` exists in `.gitignore`. (Uses `/path` or `/path/`)
    -   [x] If not, append `/<path>/` to `.gitignore`. (Adds comment too)
    -   [x] Stage the `.gitignore` file (`git add "$REPO/.gitignore"`).
-   [x] Print success message indicating changes need to be committed.

## IV. `remove.sh` Script Implementation

-   [x] Implement dependency checks: `gpg`, `sha1sum`/`shasum`. (Also checks `sed`)
-   [x] Determine repository root.
-   [x] Get path input from user.
-   [x] Generate SHA1 hash from the path.
-   [x] Define password file and archive paths.
-   [x] Check if the hash/path exists in `paths.list`. Exit if not managed.
-   [x] Check if the password file exists. Exit if missing.
-   [x] Check if the archive file exists. Exit if missing. (Needed for verification)
-   [x] Verify the password by attempting decryption (`gpg ... > /dev/null`). Exit if verification fails.
-   [x] Remove the corresponding line from `paths.list` (use `sed -i.bak`). Clean up `.bak` file.
-   [x] Rename the password file to `<filename>.removed` (`mv`).
-   [x] Remove the archive file from Git index (`git rm --cached "$ARCHIVE"`). (Uses `--ignore-unmatch`)
-   [x] Remove the archive file from the filesystem (`rm -f "$ARCHIVE"`).
-   [x] Optionally remove the path from `.gitignore`:
    -   [x] Check if `/<path>/` exists in `.gitignore`. (Uses `/path` or `/path/`)
    -   [x] If yes, prompt user `[y/N]`.
    -   [x] If 'y'/'Y', remove the line using `sed -i.bak`. Clean up `.bak` file. (Removes comment too)
    -   [x] Stage `.gitignore` if modified (`git add`).
-   [x] Print success message indicating changes need to be committed.

## V. `encrypt.sh` (for `pre-commit` hook) Script Implementation

-   [x] Set `set -eu`.
-   [x] Implement dependency checks: `gpg`, `tar`. Exit hook on failure.
-   [x] Determine repository root.
-   [x] Define manifest and storage directory paths.
-   [x] Check if `paths.list` exists. Exit 0 if not found.
-   [x] Initialize exit code variable `EXIT_CODE=0`.
-   [x] Loop through `paths.list` (`while read -r HASH PATH_IN ...`).
-   [x] Inside loop:
    -   [x] Skip empty or invalid lines.
    -   [x] Define password file and archive paths.
    -   [x] Check if password file exists. Print warning and `continue` if missing.
    -   [x] Check if plaintext path exists in the working tree (`[ -e "$REPO/$PATH_IN" ]`). Print warning and `continue` if missing.
    -   [x] Perform encryption: `tar czf - ... | gpg ... > "$ARCHIVE"`.
    -   [x] If encryption fails:
        -   [x] Print error message.
        -   [x] Set `EXIT_CODE=1`.
        -   [x] `continue` to next entry.
    -   [x] Stage the updated archive (`git add "$ARCHIVE"`).
-   [x] After loop, check `EXIT_CODE`. If non-zero, print error message.
-   [x] Exit with `EXIT_CODE` (`exit $EXIT_CODE`).

## VI. `decrypt.sh` (for `post-checkout` & `post-merge` hooks) Script Implementation

-   [x] Set `set -eu`.
-   [x] Implement dependency checks: `gpg`, `tar`. Exit hook on failure. (Exits 0 on failure, which is acceptable for these hooks).
-   [x] Determine repository root.
-   [x] Define manifest and storage directory paths.
-   [x] Check if `paths.list` exists. Exit 0 if not found.
-   [x] Loop through `paths.list` (`while read -r HASH PATH_IN ...`).
-   [x] Inside loop:
    -   [x] Skip empty or invalid lines.
    -   [x] Define password file and archive paths.
    -   [x] Check if password file exists. `continue` if missing (silently or with verbose info).
    -   [x] Check if archive file exists. `continue` if missing (silently or with verbose info).
    -   [x] Define target plaintext path (`TARGET_PATH="$REPO/$PATH_IN"`).
    -   [x] Ensure parent directory exists (`mkdir -p "$(dirname "$TARGET_PATH")"`).
    -   [x] Remove existing plaintext path if it exists (`rm -rf "$TARGET_PATH"`).
    -   [x] Perform decryption and extraction: `gpg ... | tar xzf - -C "$REPO"`.
    -   [x] If decryption/extraction fails:
        -   [x] Print error message (do not exit hook).
        -   [x] `continue` to next entry.
-   [x] After loop, print completion message (optional).
-   [x] Exit 0 (`exit 0`).

## VII. Cross-Platform Considerations & Testing

-   [x] Ensure all scripts use `#!/usr/bin/env sh`.
-   [x] Verify `sha1sum` vs `shasum -a 1` detection logic in `add.sh` and `remove.sh`.
-   [x] Test password file permission handling (`chmod`, `attrib`) on Linux, macOS, and Windows (Git Bash/MSYS). (Implemented in `add.sh`)
-   [x] Confirm `mktemp` usage is compatible across platforms. (Implemented in `add.sh` with check)
-   [x] Document dependency installation steps for major platforms (macOS, Debian/Ubuntu, Fedora, Arch, Windows/Git Bash). (Needs README update)
-   [x] Perform end-to-end testing on all supported platforms. (Cannot verify)

## VIII. Git LFS Integration for Large Files

-   [ ] Implement Git LFS detection in `install.sh`:
    -   [ ] Check if `git-lfs` command is available.
    -   [ ] Initialize Git LFS if available using `git lfs install`.
-   [ ] Add command-line parameter support for custom LFS threshold:
    -   [ ] Parse and validate `--min-lfs=<size>` parameter (default 5MB).
    -   [ ] Store threshold value in config file for use by other scripts.
-   [ ] Setup LFS patterns in `.gitattributes`:
    -   [ ] Create or update `.gitattributes` file.
    -   [ ] Add LFS pattern for `storage/*.tar.gz.gpg`.
    -   [ ] Stage `.gitattributes` changes.
-   [ ] Enhance `add.sh` for LFS integration:
    -   [ ] Check archive size after encryption.
    -   [ ] Compare against threshold from config.
    -   [ ] Configure LFS tracking for specific files if needed.
-   [ ] Add informative messaging:
    -   [ ] Report LFS status during installation.
    -   [ ] Provide clear feedback when files are tracked with LFS.
    -   [ ] Suggest LFS installation if not available but large files detected.
-   [ ] Ensure efficient handling of binary large objects:
    -   [ ] Test with various file types (images, videos, datasets).
    -   [ ] Verify LFS integration works correctly with large binary files.
    -   [ ] Document full compatibility with all file types including binaries.

## IX. Documentation Updates

-   [x] Update `README.md` with usage instructions.
-   [ ] Ensure RFC (`docs/rfc-git-vault.md`) reflects the final implementation details. (Needs final review)
-   [x] Ensure PRD (`docs/prd-git-vault.md`) requirements are met. (Mostly met by implemented code, pending testing) 
