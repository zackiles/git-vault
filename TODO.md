# TODOs

## Current TODOs

Before marking a TODO done, run all tests. If they pass, mark it and the implementation plans as done. TODOs require an implementation plat and checklist in `docs/{todo name}-checklist.md`.

### 1 ) Integrate 1Password for Passwords

- **Objective**: Provide a way other than file-based passwords by allowing a seamless 1Password CLI integration.
- `install.sh` asks if they want to use 1Password  or regular file. (if the CLI is detected) otherwise it defaults to regular files.
- All other logic in scripts stays the same except they know if they're using file or 1Password and encrypt/decrypt using a password or key stored on 1Password and managed through the 1Password CLI.
- Multiple passwords can be created for multiple files in the same project.
- The pattern for how to store the password or key IN 1Password should be idiomatic, intuitive, and seamless so that the user doesn't need to do anything and the password entries don't clutter or collide with their workspace.
- `remove.sh` should remove the password from 1Password in a way similar to how file-based does, where it "marks" it removed instead of fully deleting it in case a user makes a mistake (we don't want them losing an unrecoverable decryption key)
- Update all and tests/docs to reflect the new design. Ensure we mock 1Password's CLI interactions as best we can and doing so ONLY after doing deep research on their documentation and understanding of how it works cross-platform.

### 2 ) Support Symmetric Keys

Investigate supporting Symmetric Keys for Git-Vault. Borrow inspiration from the open source project [git-crypt]([git-crypt](https://github.com/AGWA/git-crypt)) by reviewing its documentation and code. git-crypt currently supports Symmetric Keys. Generate a TODO that documents the objective and what is needed to get feature parity with git-crypt in its usage of Symmetric Keys for encrypting and decrypting files. This TODO is to create another TODO.

### 3 ) Field Encryption For JSON and YAML
If the `add` command detects a JSON or YAML file it will prompt a user to ask if they want to encrypt just the values of all fields in the file when storing it in the vault, or do a full file encryption.

### 4 ) Put`.pw` files in the `.git-vault` folder

This will tidy up the end-users project by not cluttering the root of their repository with .pw files

### 5 ) Rename Install to Init

For the user and within this codebase, completely change terminology from 'init' to 'install'. Examples: the 'install.sh' script becomes 'init.sh', the code comments and methods become 'init' instead of 'install', the documentation is updated to reflect this. There should never be the term 'init' as it relates to git-vault anywhere in the codebase. The only time this isn't true is when it comes to specific "install" commands of third parties or terminal commands for things that AREN'T git-vault.

## Completed TODOs

Once TODOs are fully implemented, tested, and documented, move them here for future reference. TODOs in this section no longer need to be implemented and are kept for historical reasons.

### Git LFS Integration for Large Archives

- **Objective**: Automatically configure Git LFS for large encrypted archives to prevent repository bloat while maintaining versioning capabilities.
- `install.sh` detects if Git LFS is available and sets up LFS tracking for the `storage/*.tar.gz.gpg` pattern.
- Default threshold of 5MB for LFS tracking can be customized with `--min-lfs=<size>` flag during installation.
- `add.sh` checks archive size after encryption and dynamically configures LFS tracking for individual files that exceed the threshold.
- Make this seamless and transparent to the user - no manual LFS setup required.
- Ensure proper error handling if Git LFS is not available or if LFS setup fails.
- Add appropriate debug and status messaging when archives are detected as large and tracked via LFS.
- Explicitly support and efficiently handle binary large objects (images, videos, datasets, etc.) through Git LFS integration.
- Provide clear documentation that git-vault is fully compatible with binary large objects and any type of file without restrictions.
- Update documentation and tests to verify LFS integration works correctly across platforms.

### Fix The Broken Test in errors.bats

After a recent change a test started failing that says: (`[Error] add.sh fails if gpg dependency is missing` in `test/errors.bats`) Fix it. Here is some information from the previous developer who last tried to fix it:

1.  **Purpose of the Test:**
    *   This test aimed to verify that the `.git-vault/add.sh` script correctly detects if the required `gpg` (GnuPG) command-line tool is missing from the system's `PATH`.
    *   It should gracefully fail and inform the user about the missing dependency, preventing unexpected errors later during encryption.
    *   The test originally worked by temporarily modifying the `PATH` environment variable within the test's execution context. It pointed `PATH` to a temporary directory containing a fake `gpg` script designed to exit with an error, simulating the absence of the real `gpg`.

2.  **Relation to Recent Changes and Why It Failed:**
    *   The test started failing (specifically, timing out) after the "Single Folder for Git Vault" refactoring, which moved scripts from `git-vault/` to `.git-vault/` and storage to `.git-vault/storage/`.
    *   While the refactoring primarily changed file paths, the test's method of manipulating the `PATH` environment variable within the Bats testing framework seems to have become unstable.
    *   It's likely that the interaction between the Bats execution environment, the `run` command (which uses subshells), the `PATH` modification, and potentially the script's internal logic created a hang or an exceptionally long execution time, leading to consistent timeouts (>120 seconds). The exact cause of the hang wasn't pinpointed during the previous debug session.

3.  **Reason for Skipping:**
    *   Due to the persistent timeouts that could not be quickly resolved, and to allow the rest of the test suite to pass validation, this specific test was marked as `skip`.

4.  **Next Steps to Investigate and Fix:**
    *   **Isolate:** Run the test individually using `bats test/errors.bats -f "gpg dependency"` to remove the `test/run-tests.sh` wrapper and simplify the execution environment.
    *   **Debug:** Add verbose tracing (`set -x`) inside the test function in `test/errors.bats` and potentially within the `setup_path_override` function in `test/test_helper.bash` to see exactly where execution hangs.
    *   **Review `add.sh`:** Double-check the dependency check logic within `.git-vault/add.sh`. Ensure it's robust and doesn't have unexpected behavior when `gpg` isn't found.
    *   **Alternative Simulation:** Explore alternative ways to simulate a missing `gpg` command without altering the `PATH` directly within the test, as this seems fragile. This is challenging in Bash but might involve temporarily renaming the real `gpg` if run in a very controlled environment (use caution) or modifying the script's check if possible (less ideal).
    *   **Evaluate Necessity:** Consider if this specific test case (explicitly checking for a missing dependency via PATH manipulation) provides enough value to justify the debugging effort, given that other tests implicitly rely on `gpg` being present and functional.

### Single Folder for Git Vault

- **Objective**: Reduce clutter in the user's project by centralizing all things related to git-vault(except the git hooks) to a single folder.
- The single folder on the user's project stores: all `.sh` scripts that are installed, `paths.list`, the main `README.md` of git-vault, and a subfolder for storage.
- Name the folder `.git-vault` and the storage subfolder `.git-vault/storage`.
- Update all and tests/docs to reflect the new design.

### 2 ) Optionally Install Dependencies for Users

- **Objective**: Make the `install.sh` script intelligently handle installing the dependencies on the users specific platform (windows, macos, linux) if they aren't available, and if the user chooses to.
- The following is noted in the user-facing README.md "You need gpg, tar, sha1sum (or shasum), and mktemp installed and available in your PATH.". We'll check for those and any others that are needed when the script first starts and ask the user if they'd like us to install them ourselves.
- Use most typical and best practice ways to install them on the given system
- Only prompt and install for the 1 or more that are needed specifically
- If one or more fails, exit while providing the reason it failed and returning the actual error message from the system
- Architect in such a way that its easy for maintainers of this project to modify which dependencies will be auto-installed and their specific install method
- Update all and tests/docs to reflect the new design.
