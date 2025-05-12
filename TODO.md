# TODOs

## 1 ) Single Folder for Git Vault

- **Objective**: Reduce clutter in the user's project by centralizing all things related to git-vault(except the git hooks) to a single folder.
- The single folder on the user's project stores: all `.sh` scripts that are installed, `paths.list`, the main `README.md` of git-vault, and a subfolder for storage.
- Name the folder `.git-vault` and the storage subfolder `.git-vault/storage`.
- Update all and tests/docs to reflect the new design.

## 2 ) Integrate 1Password for Passwords

- **Objective**: Provide a way other than file-based passwords by allowing a seamless 1Password CLI integration.
- `install.sh` asks if they want to use 1Password  or regular file. (if the CLI is detected) otherwise it defaults to regular files.
- All other logic in scripts stays the same except they know if they're using file or 1Password and encrypt/decrypt using a password or key stored on 1Password and managed through the 1Password CLI.
- Multiple passwords can be created for multiple files in the same project.
- The pattern for how to store the password or key IN 1Password should be idiomatic, intuitive, and seamless so that the user doesn't need to do anything and the password entries don't clutter or collide with their workspace.
- `remove.sh` should remove the password from 1Password in a way similar to how file-based does, where it "marks" it removed instead of fully deleting it in case a user makes a mistake (we don't want them losing an unrecoverable decryption key)
- Update all and tests/docs to reflect the new design. Ensure we mock 1Password's CLI interactions as best we can and doing so ONLY after doing deep research on their documentation and understanding of how it works cross-platform.
