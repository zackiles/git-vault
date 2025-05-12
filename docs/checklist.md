# Git-Vault Implementation Checklist

This checklist outlines the steps required to implement the Git-Vault tool based on `docs/rfc-git-vault.md`.

## I. Project Setup & Core Structure

-   [x] Create `.git-vault/storage/` directory.
-   [ ] Ensure `.git-vault/storage/` exists (or is created by `install.sh` in target repo).
-   [x] Add scripts to project root:
    -   [x] `install.sh`
    -   [x] `add.sh`
    -   [x] `remove.sh`
    -   [x] `encrypt.sh`
    -   [x] `decrypt.sh`
-   [x] Create empty `paths.list` manifest template at project root.
-   [x] Initialize or update root `.gitignore`:
    -   [x] Add `.git-vault/*.pw` (Done via `install.sh` in target repo)
    -   [ ] *Consider adding `.git-vault/paths.list` if paths imply secrets (as noted in RFC).* (Applies to target repo)
    -   [x] Ensure `.git-vault/storage/` is **not** ignored. (`install.sh` warns in target repo; `add.sh` adds specific paths in target repo)
-   [x] Set up initial Git repository structure. (Implied by current state)

## II. `install.sh` Script Implementation

-   [x] Implement directory creation (`.git-vault/`, `.git-vault/storage/`) if they don't exist.
-   [x] Implement mechanism to place scripts (`add.sh`, `remove.sh`, `encrypt.sh`, `decrypt.sh`) and `paths.list` template into target `.git-vault/` directory (via `cp`).
-   [x] Implement creation of empty `.git-vault/paths.list` if it doesn't exist (or copy template).
-   [x] Implement logic to add necessary patterns (`.git-vault/*.pw`) to root `.gitignore`.
-   [x] Implement Git hook installation:
    -   [x] Detect custom hooks path.
    -   [x] Install/configure `pre-commit` hook to call `encrypt.sh`.
    -   [x] Install/configure `post-checkout` hook to call `decrypt.sh`.
    -   [x] Install/configure `post-merge` hook to call `decrypt.sh`.
    -   [x] Make hooks executable (`chmod +x`).
-   [x] Implement dependency checks (required binaries: `gpg`, `tar`, `sha1sum`/`shasum`).
-   [ ] *Consider adding automated backup of existing hooks before modifying.* (User may customize existing hook)

## III. `add.sh` Script Implementation

-   [x] Implement file existence check.
-   [x] Implement directory detection (with trailing slash in manifest for directories).
-   [x] Implement path normalization (convert absolute to relative from repo root).
-   [x] Implement path hashing (for password/archive file names).
-   [x] Implement duplicate check (same path or hash collision).
-   [x] Implement password collection (with confirmation).
-   [x] Implement archive creation:
    -   [x] Create temporary workspace.
    -   [x] Use `tar` to archive files/directories.
    -   [x] Use `gpg` to encrypt with provided password.
    -   [x] Place encrypted archive in `.git-vault/storage/` with appropriate name.
-   [x] Implement password file storage in `.git-vault/git-vault-<hash>.pw`.
-   [x] Implement manifest update to add entry in `.git-vault/paths.list`.
-   [x] Implement `.gitignore` update:
    -   [x] Add specific path pattern for the added file/directory.
    -   [x] Add generic pattern for password files (`.git-vault/*.pw`) if not present.
-   [x] Implement Git staging of relevant files (archive, manifest, `.gitignore`).
-   [x] Implement validation of encryption/decryption before completing.

## IV. `encrypt.sh` Script Implementation

-   [x] Implement reading of manifest (`.git-vault/paths.list`).
-   [x] Implement per-path encryption process:
    -   [x] Skip if password file missing.
    -   [x] Read password from `.git-vault/git-vault-<hash>.pw`.
    -   [x] Create archive of target files/directories.
    -   [x] Encrypt archive with password.
    -   [x] Overwrite existing archive in `.git-vault/storage/` if it exists.
-   [x] Implement Git staging of updated encrypted archives.
-   [x] Ensure script executes cleanly when run from Git hook in various environments.

## V. `decrypt.sh` Script Implementation

-   [x] Implement reading of manifest (`.git-vault/paths.list`).
-   [x] Implement per-path decryption process:
    -   [x] Skip if password file or archive missing.
    -   [x] Read password from `.git-vault/git-vault-<hash>.pw`.
    -   [x] Decrypt archive with password.
    -   [x] Extract files/directories to target locations, creating parent directories as needed.
-   [x] Ensure script executes cleanly when run from Git hook in various environments.

## VI. `remove.sh` Script Implementation

-   [x] Implement path verification (check if in manifest).
-   [x] Implement password verification before removal.
-   [x] Implement password file handling (rename, don't delete entirely).
-   [x] Implement removal from manifest (`.git-vault/paths.list`).
-   [x] Implement archive removal from `.git-vault/storage/`.
-   [x] Implement `.gitignore` cleaning:
    -   [x] Remove specific path entry.
    -   [x] Consider removing `.git-vault/*.pw` pattern if manifest empty.
-   [x] Implement Git staging of updated files (manifest, `.gitignore`).
-   [x] Ensure clear user feedback on success/failure.

## VII. Testing

-   [x] Test `install.sh` script with various scenarios.
-   [x] Test `add.sh` script with files and directories.
-   [x] Test handling of nested directories and complex paths.
-   [x] Test full end-to-end workflow with `encrypt.sh` and `decrypt.sh`.
-   [x] Test Git hook integration during commit, checkout, merge.
-   [x] Test `remove.sh` script with various scenarios.
-   [x] Test error conditions and edge cases.
-   [x] Test interoperability between different platforms (Linux, macOS, Windows/Git Bash).

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
