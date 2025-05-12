# Git-Vault Test Plan

This document outlines critical test cases for validating the Git-Vault functionality based on the PRD and RFC.

## Critical Test Cases

### 1. Core End-to-End Flow (Install, Add, Commit, Checkout/Merge)

*   **Goal:** Verify the primary user journey from installation to daily use works as expected within an isolated test environment.
*   **Importance:** High (Covers core functionality and Acceptance Criteria #1 & #2)
*   **Steps:**
    1.  **Setup:** Create a new temporary directory (`test/tmp/git-vault-test.XXXXXX`), initialize a Git repository (`git init`), configure git user, create a basic `.gitignore`, and make an initial commit.
    2.  **Install:** Simulate installation *into the temporary repository* by running the project's `install.sh` script with the `--target-dir` flag pointing to the temporary repo root.
    3.  **Verification (Install):**
        *   Check that `git-vault/` and `storage/` directories exist *inside the temporary repo*.
        *   Check that `git-vault/paths.list` exists *inside the temporary repo*.
        *   Verify the temporary repo's git config `core.hooksPath` is set (e.g., to `.githooks`).
        *   Check that hook files (`.githooks/pre-commit`, `.githooks/post-checkout`, `.githooks/post-merge`) exist *inside the temporary repo*, are executable, and contain the git-vault marker and script execution line pointing to `../git-vault/encrypt.sh` or `decrypt.sh`.
        *   Check that the temporary repo's `.gitignore` contains the line `git-vault/*.pw`.
    4.  **Add Path:**
        *   Create a sample file or directory inside the temporary repo (e.g., `mkdir sensitive_data && echo "secret" > sensitive_data/key.txt`).
        *   Run `git-vault/add.sh sensitive_data` *using the script installed in the temporary repo*.
        *   Enter a matching password when prompted twice.
    5.  **Verification (Add):**
        *   Check that `git-vault/git-vault-<hash>.pw` exists *in the temp repo*.
        *   Check that `git-vault/paths.list` *in the temp repo* contains `<hash> sensitive_data`.
        *   Check that `storage/sensitive_data.tar.gz.gpg` exists *in the temp repo*.
        *   Check that the temporary repo's `.gitignore` contains the line `/sensitive_data/`.
        *   Check `git status` *in the temp repo* shows the new archive and potentially `.gitignore` as ready to be added.
    6.  **First Commit:**
        *   Run `git add .` *in the temp repo*.
        *   Run `git commit -m "Initial vault setup"` *in the temp repo*.
        *   Verify commit succeeds without pre-commit hook errors.
    7.  **Modify & Commit:**
        *   Modify the content of `sensitive_data/key.txt` *in the temp repo*.
        *   Run `git commit -am "Update secret data"` *in the temp repo*.
    8.  **Verification (Commit):**
        *   Check console output for "HOOK: Running git-vault encrypt..." message from `pre-commit`.
        *   Verify commit succeeds.
        *   Check `git log -p -- storage/` *in the temp repo* shows the encrypted archive blob changing.
    9.  **Checkout:**
        *   Run `git checkout HEAD~1` *in the temp repo*.
        *   Verify `post-checkout` hook runs.
        *   Verify `sensitive_data/key.txt` contains the content from the *first* commit.
        *   Run `git checkout main` *in the temp repo*.
        *   Verify `post-checkout` hook runs again.
        *   Verify `sensitive_data/key.txt` contains the *updated* content.

### 2. Multi-Path Handling

*   **Goal:** Ensure hooks correctly handle encryption and decryption for multiple vaulted paths within the temporary test repository.
*   **Importance:** High (Core design requirement)
*   **Steps:**
    1.  **Setup:** Use the temporary repository state from Test Case 1 after step 8.
    2.  **Add Second Path:**
        *   Create another file/directory in the temp repo (e.g., `touch config.yml`).
        *   Run `git-vault/add.sh config.yml` *in the temp repo*, provide a password.
    3.  **Verification (Add Second):** Verify the corresponding `.pw` file, `paths.list` entry, archive file, and `.gitignore` entry are created *in the temp repo*.
    4.  **Modify Both & Commit:**
        *   Modify `sensitive_data/key.txt` *in the temp repo*.
        *   Modify `config.yml` *in the temp repo*.
        *   Run `git commit -am "Update both secrets"` *in the temp repo*.
    5.  **Verification (Commit Both):**
        *   Check console output for `pre-commit` hook messages indicating encryption for *both* paths.
        *   Verify commit succeeds.
    6.  **Checkout:** Run `git checkout HEAD~1 && git checkout main` *in the temp repo*.
    7.  **Verification (Checkout Both):** Check console output for `post-checkout` messages indicating decryption attempts for *both* paths. Verify both `sensitive_data/key.txt` and `config.yml` are restored to their correct state *in the temp repo* for the checked-out commit.

### 3. Remove Path Functionality

*   **Goal:** Verify `remove.sh` correctly unmanages a path and cleans up associated files *within the temporary test repository*.
*   **Importance:** Medium (Essential cleanup functionality, Acceptance Criteria #3)
*   **Steps:**
    1.  **Setup:** Use the temporary repository state from Test Case 2 after step 5.
    2.  **Remove First Path:**
        *   Run `git-vault/remove.sh sensitive_data` *in the temp repo*.
        *   Enter the correct password when prompted (or ensure the `.pw` file is correct for validation).
    3.  **Verification (Remove):**
        *   Verify password verification message.
        *   Verify `sensitive_data` entry is removed from `git-vault/paths.list` *in the temp repo*.
        *   Verify `git-vault/git-vault-<hash1>.pw` is renamed to `git-vault-<hash1>.removed` *in the temp repo*.
        *   Verify `storage/sensitive_data.tar.gz.gpg` is removed from the temp repo's filesystem.
        *   Verify `git status` *in the temp repo* shows the archive as deleted (unstaged).
        *   Verify the prompt to remove `/sensitive_data/` from `.gitignore` appears. Respond 'y'.
        *   Verify `/sensitive_data/` line is removed from the temp repo's `.gitignore`.
        *   Verify `git status` *in the temp repo* shows `paths.list` and `.gitignore` as modified.
    4.  **Commit Removal:** Run `git commit -am "Unvault sensitive_data"` *in the temp repo*. Verify commit succeeds.
    5.  **Modify Remaining & Commit:**
        *   Modify `config.yml` *in the temp repo*.
        *   Run `git commit -am "Update remaining secret"` *in the temp repo*.
    6.  **Verification (Commit Remaining):** Verify `pre-commit` hook only attempts to encrypt `config.yml`.

### 4. Error Handling Scenarios

*   **Goal:** Ensure the tool provides clear feedback and exits appropriately on common errors within the test environment.
*   **Importance:** Medium (User experience and robustness)
*   **Steps:**
    1.  **Dependency Check (within test):**
        *   In the test setup or within the `@test` block, temporarily modify the `$PATH` *for the test execution* to exclude the directory containing `gpg` (or `tar`).
        *   Run `git-vault/add.sh some_file` (or trigger hooks).
        *   Verify script prints a specific error message about the missing dependency and exits with a non-zero status code. Ensure `$PATH` is restored during teardown.
    2.  **Password Mismatch (`add.sh`):**
        *   Run `git-vault/add.sh new_file` *in the temp repo*.
        *   Simulate entering different passwords at the prompts.
        *   Verify error message "Passwords do not match." and non-zero exit code.
        *   Verify no `git-vault/git-vault-<hash_new>.pw` file was created *in the temp repo*.
    3.  **Incorrect Password (`remove.sh`):**
        *   Run `git-vault/remove.sh config.yml` *in the temp repo* (assuming it's vaulted).
        *   Simulate an incorrect password check (e.g., modify the `.pw` file temporarily).
        *   Verify error message "Password verification failed..." and non-zero exit code.
        *   Verify `paths.list`, `.pw` file, and archive for `config.yml` remain unchanged *in the temp repo*.
    4.  **Missing `.pw` File (Hooks):**
        *   Manually `rm git-vault/git-vault-<hash_config>.pw` *in the temp repo*.
        *   Modify `config.yml` or another file *in the temp repo*.
        *   Run `git commit -am "Test missing pw"` *in the temp repo*.
        *   Verify `pre-commit` hook prints a warning "Password file ... missing, cannot encrypt." and potentially aborts the commit or succeeds (based on script logic).
        *   Restore the `.pw` file. Commit any changes.
        *   Manually `rm git-vault/git-vault-<hash_config>.pw` *in the temp repo* again.
        *   Run `git checkout HEAD~1` *in the temp repo*.
        *   Verify `post-checkout` hook prints an info/warning message about the missing password file but completes.

## Testing Strategy & Architecture

The testing strategy for Git-Vault relies heavily on **integration testing within isolated, temporary Git repository environments**. This ensures that the interactions between the scripts, Git commands, and the filesystem are tested thoroughly without risking modifications to the main project repository.

*   **Framework:** **`bats-core`** (Bash Automated Testing System) is used. It provides a structure for test cases (`.bats` files), setup/teardown functions, and helper libraries.
*   **Environment Isolation:**
    *   **Temporary Directories:** All tests execute within temporary directories created under `test/tmp/`. These directories are automatically cleaned up after each test case.
    *   **Isolated Git Repos:** Each test case initializes a new Git repository within its temporary directory (`git init`).
    *   **Installation Simulation:** The `install.sh` script is **never** run directly against the main project. Instead, the `install_git_vault` test helper function copies the necessary project scripts (`install.sh`, `add.sh`, etc.) into a temporary location within the test repo and then runs the copied `install.sh` using the `--target-dir` flag to point *only* to the temporary repository.
    *   **Isolated Hooks:** Tests configure the temporary Git repository to use a custom hooks path (`core.hooksPath = .githooks`) within the temporary directory. This prevents any interaction with the main project's `.git/hooks` directory.
*   **Helper Libraries:** Bats helper libraries (`bats-support`, `bats-assert`, `bats-file`) are included directly within the `test/test_helper/` directory as Git submodules or direct clones. Tests load these helpers using relative paths within the project structure (`load "$TEST_DIR/test_helper/bats-support/load.bash"`).
*   **Test Structure:**
    *   `setup` / `teardown` functions in `test/test_helper.bash` handle the creation and cleanup of the temporary Git repository for each test case.
    *   The `install_git_vault` function handles the safe, isolated installation simulation within the temporary repo.
    *   Each `@test "description..." { ... }` block focuses on a specific scenario within the isolated environment.
*   **Assertions:** Standard `bats-assert` and shell commands are used within the temporary repository context (e.g., checking file existence, content, git status within `$TEST_REPO`).
*   **Mocking:** Dependency checks can be tested by temporarily modifying `$PATH` within the test's execution scope or using `bats-support` stubs.
*   **CI/CD:** The `bats test` command should be run in CI pipelines to execute the suite within these safe, isolated environments.

This isolated approach ensures tests are reliable, reproducible, and pose no risk to the main project codebase during execution. 