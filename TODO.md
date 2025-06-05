# TODOs

## Current TODOs

Before marking a TODO done, run all tests. If they pass, mark it and the implementation plans as done. TODOs require an implementation plat and checklist in `docs/{todo name}-checklist.md`.

### 1 ) Support Symmetric Keys

Investigate supporting Symmetric Keys for Git-Vault. Borrow inspiration from the open source project [git-crypt]([git-crypt](https://github.com/AGWA/git-crypt)) by reviewing its documentation and code. git-crypt currently supports Symmetric Keys. Generate a TODO that documents the objective and what is needed to get feature parity with git-crypt in its usage of Symmetric Keys for encrypting and decrypting files. This TODO is to create another TODO.

### 2 ) Field Encryption For JSON and YAML

If the `add` command detects a JSON or YAML file it will prompt a user to ask if they want to encrypt just the values of all fields in the file when storing it in the vault, or do a full file encryption.

### 3 ) Field Encryption For JSON and YAML

If the `add` command detects a JSON or YAML file it will prompt a user to ask if they want to encrypt just the values of all fields in the file when storing it in the vault, or do a full file encryption.

### 4 ) CI/CD Workflow Integration

- **Objective**: Provide automated CI/CD workflow templates for unsealing vaulted items in GitHub Actions.
- Create workflow templates that users can install to automatically unseal vaulted items in CI
- Support two authentication methods:
  - File-based password/key stored as GitHub Secret
  - 1Password integration using `1password/load-secrets-action@v2` for seamless secret management
- Workflow should:
  - Install `gv` in the runner
  - Configure authentication (file-based or 1Password)
  - Unseal specified vaulted items
  - Clean up secrets after use
- Provide clear documentation and examples for both authentication methods
- Include security best practices and warnings about secret management
- Add tests that verify the workflow templates work in CI environment
- Consider adding a command like `gv workflow install` that helps users set up the CI integration

### 5. Add/Remove globs

Add and remove command should accept glob patterns. config.json should handle mappings from archive back to paths.

### 6. Passing Passwords as Flags / ENV

To assist in CI usage (NOTE: See TODO `#4 CI/CD Workflow Integration`) we should allow decryption of repo assets using only a flag and environment variable instead of a pwd file.

### 7. Recovery Modes

It's not clear exactly what happens to the state (in vault.json, password files, 1password password records) if a user destroys or loses any of them. Investigate the simplest way this could be provided to our users and introduce a new CLI command that handles and implements that experience for them. Keep it simple and leverage the existing modules to help implement most of this feature in the command file itself rather than create new libraries or utils.

### 8 ) Field-level Encryption (Like Mozilla SOPS)

A full RFC describing the implementation can be found in `docs/rfc-field-level-encryption.md`. The objective would be to implement this in `src/feild-encryption/` as a series of modules that the add/encrypt and decrypt commands could use to optionally offer to a user field-level encryption when only a single-file that is a supported format for field-level encryption is provided to the encrypt/add command (which the CLI will detect). This RFC does NOT concern itself with integration into this codebase, and only describes the general code needed. You will have to determine the full implementation and integration into this codebase, such as managing state for this in vault.json and storing keys in the repo for symmetric. Also ensure extending it later for potential Future Considerations mentioned in the RFC.

## Completed TODOs

Once TODOs are fully implemented, tested, and documented, move them here for future reference. TODOs in this section no longer need to be implemented and are kept for historical reasons.

### Rename Install to Init

- **Objective**: For the user and within this codebase, completely change terminology from 'install' to 'init'.
- The install command is now 'init'
- Code comments and methods use 'init' instead of 'install'
- Documentation has been updated to reflect this
- The only time 'install' is used is when it comes to specific "install" commands of third parties or terminal commands for things that AREN'T git-vault.

### Multiple Ways To Read/Write A Password

- **Objective**: Support password flags for CLI automation and CI/CD usage, plus password recovery functionality.
- Added `--password` / `-p` flag to decrypt command that overrides file and 1password-based passwords
- Added `--write` / `-w` flag that when used with `--password` writes the password to storage after successful decryption
- Added `--password` flag support to add and encrypt commands to skip interactive password prompts
- Includes confirmation prompts for overwriting existing passwords in both file and 1Password storage modes
- Full test coverage and documentation updates included

### Single Folder for Git Vault

- **Objective**: Reduce clutter in the user's project by centralizing all things related to git-vault(except the git hooks) to a single folder.
- The single folder on the user's project stores: all `.sh` scripts that are installed, `paths.list`, the main `README.md` of git-vault, and a subfolder for storage.
- Name the folder `.vault` and the storage subfolder `.vault/storage`.
- Update all and tests/docs to reflect the new design.
