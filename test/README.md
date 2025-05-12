# Git-Vault Test Suite

This directory contains the automated tests for the Git-Vault tool, written using [`bats-core`](https://github.com/bats-core/bats-core).

## IMPORTANT: Safe Testing Practices

**WARNING**: These tests MUST NEVER modify the actual project structure. All test operations should be performed ONLY in temporary directories.

- ✅ All file creation, modification, and deletion should occur only in the test/tmp/ directory
- ✅ Tests must use isolated git repositories created specifically for testing
- ✅ The install.sh script must be copied to a temporary location before execution
- ❌ Never run tests with paths that point to the actual project files
- ❌ Never modify .git/hooks in the main repository

## Prerequisites

1.  **`bats-core`:** You need to install `bats`. The easiest way is often via a package manager:
    *   **macOS:** `brew install bats-core`
    *   **Debian/Ubuntu:** `sudo apt update && sudo apt install bats`
    *   **Fedora:** `sudo dnf install bats`
    *   **Arch Linux:** `sudo pacman -S bats`
    *   **From source:** Follow the instructions in the `bats-core` repository.

2.  **Bats Helper Libraries:** The tests also use standard bats helper libraries (`bats-support`, `bats-assert`, `bats-file`). These are installed in the test/test_helper directory.

3.  **Git-Vault Dependencies:** Ensure the core dependencies required by Git-Vault itself are installed and available in your `PATH`:
    *   `git`
    *   `gpg` (GnuPG)
    *   `tar`
    *   `sha1sum` (usually part of `coreutils`) or `shasum` (often available on macOS)
    *   `mktemp` (usually part of `coreutils`)
    *   `sed`

## Running Tests

Navigate to the *root* of the `git-vault` project directory (the parent directory of this `test/` directory) in your terminal.

To run all tests:

```bash
bats test
```

To run a specific test file:

```bash
bats test/core.bats
# or
bats test/remove.bats
# or
bats test/errors.bats
```

Tests create temporary repositories inside the `test/tmp/` directory, which is automatically cleaned up by the `teardown` functions in the tests.

## Structure

*   **`test/*.bats`:** Test files containing individual test cases (`@test "description" { ... }`).
*   **`test/test_helper.bash`:** Contains common setup, teardown, and helper functions used by the `.bats` files.
*   **`test/test_helper/`:** Contains helper libraries for bats testing.
*   **`test/tmp/`:** A directory used for creating temporary files and repositories during test execution (this directory should be in `.gitignore`).

## Test Implementation Details

1. **Temporary Repos**: Each test creates a self-contained git repository in test/tmp/ with its own .githooks directory.
2. **Script Isolation**: The install_git_vault function copies project scripts to a temporary location before running them, preventing accidental modification of the main repository.
3. **Custom Hooks Path**: The tests use a custom hooks path (.githooks instead of .git/hooks) to avoid any risk of modifying the real Git hooks.
4. **Git Command Usage**: For files that are in .gitignore, tests use `git add --force` to ensure they're properly staged.
5. **Error Resilience**: Tests are designed to be resilient to minor changes in error message wording, checking for key terms rather than exact string matches.

## Test Suite Structure

The test suite is divided into three main test files:

1. **core.bats**: Tests the core functionality including installation, adding files/directories, encryption via pre-commit hooks, and decryption via post-checkout hooks.

2. **remove.bats**: Tests the removal functionality, including password verification, file cleanup, and .gitignore management.

3. **errors.bats**: Tests error handling scenarios including missing dependencies, incorrect passwords, and missing files.

Each test runs in isolation with its own temporary repository, ensuring that tests don't interfere with each other. 