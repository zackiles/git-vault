# Git-Vault

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Release](https://github.com/zackiles/git-vault/actions/workflows/release.yml/badge.svg)](https://github.com/zackiles/git-vault/actions/workflows/release.yml)

Drop-dead-simple tool for storing sensitive files or folders in git. Git hooks and GPG transparently encrypt and decrypt resources within your repository, keeping them encrypted remotely but available locally. Works on all **platforms**, **dummy-proof**, and **secure**! Optionally supports and configures Git LFS, 1Password, and more automatically.

## Why Git-Vault?

There's never been a quick, simple, consistent, and git-native way to secure files or folders securely within a repo.

**Private registry for resources?**<br>
Cons: _Effort, cost, and either everyone gets access or they don't (e.g NPM org)._

**Bespoke pipelines to fetch resources?**<br>
Cons: _Effort, cost, consistency, and way too big of a hammer for most situations._

**Everything else?**<br>
Cons: _No native git hooks, cross-platform, 3rd party dependencies, complicated, sketchy code...The closest project to this one is [git-crypt]([git-crypt](https://github.com/AGWA/git-crypt)) which is great, but takes a bit too much manual work, doesn't support 1Password, and the project is no-longer actively maintained._

> [!TIP]
> Checkout some examples of [When To Use It](#when-to-use-it).

## Installation

Install Git-Vault as needed per-project by running the following command from the root of your Git repository:

```bash
curl -sSL https://github.com/zackiles/git-vault/releases/latest/download/install.sh | bash
```

For Git repositories with large files, you can specify a custom threshold for Git LFS integration:

```bash
curl -sSL https://github.com/zackiles/git-vault/releases/latest/download/install.sh | bash -s -- --min-lfs=10
```

This script performs the following setup:

*   Checks for and offers to install any missing dependencies (`gpg`, `tar`, `sha1sum`/`shasum`, `mktemp`, `sed`)
*   Copies the necessary scripts (`add.sh`, `remove.sh`, `encrypt.sh`, `decrypt.sh`) into a `.git-vault/` directory within your project.
*   Creates a `.git-vault/storage/` directory where encrypted files will eventually be stored.
*   Creates an empty `.git-vault/paths.list` file to track vaulted items, if it doesn't already exist.
*   Installs Git hooks (`pre-commit`, `post-checkout`, `post-merge`) into your repository's hooks directory (e.g., `.git/hooks/` or a custom path) to automate encryption and decryption.
*   Updates your root `.gitignore` file to ensure password files (`.git-vault/*.pw`) are not committed.
*   Configures Git LFS for large archives if Git LFS is available (see [Git LFS Integration](#git-lfs-integration) below).
*   Allows choosing between traditional file-based password storage or integration with [1Password CLI](#1password-integration) for password management.

> [!NOTE]
> Git-Vault has automatic dependency detection and installation. If any required dependencies are missing, the script will offer to install them automatically for you based on your operating system. Supported platforms include Linux (Debian/Ubuntu, Fedora, Arch), macOS, and Windows (Git Bash/MinGW).

## Usage

**Choose Password Storage (During Installation):**

When you run `install.sh`, you will be prompted if you want to use 1Password CLI (`op`) for managing the encryption passwords, provided `op` is detected on your system. 

*   **File-based (Default):** If you choose No, or if `op` is not detected, git-vault works as before, storing passwords in individual `.git-vault/*.pw` files (which are gitignored).
*   **1Password Integration:** If you choose Yes, passwords for vaulted items will be stored securely in your 1Password vault instead of local files. See [1Password Integration](#1password-integration) below.

**Add a file/directory to the vault:**
  ```bash
  .git-vault/add.sh <path/to/your/secret>
  ```
  Follow the prompts to set a password. This will create an encrypted archive in `.git-vault/storage/`, add the path to `.git-vault/paths.list`, create a `.pw` file in `.git-vault/`, and update `.gitignore`.

**Remove a file/directory from the vault:**
  ```bash
  .git-vault/remove.sh <path/to/your/secret>
  ```
  This verifies the password, removes the archive and manifest entry, renames the `.pw` file, and optionally cleans up `.gitignore`.

**Commit Changes:** Remember to commit changes made by `add.sh` or `remove.sh` (like the encrypted archive in `.git-vault/storage/`, `.git-vault/paths.list`, and `.gitignore`).

## How It Works

*   **Encryption (`pre-commit` hook):** Before you commit, `.git-vault/encrypt.sh` automatically re-encrypts any tracked plaintext files listed in `paths.list` into their corresponding archives in `.git-vault/storage/`. Only the encrypted archive is staged.
*   **Decryption (`post-checkout`, `post-merge` hooks):** After checking out a branch or merging, `.git-vault/decrypt.sh` automatically decrypts the archives found in `.git-vault/storage/` back to their original plaintext locations, using the corresponding `.pw` files.
*   **Password Handling:** Passwords are read either from the `.git-vault/*.pw` files or fetched from 1Password via the `op` CLI, depending on the mode selected during installation.

## Git LFS Integration

Git-Vault now integrates with Git LFS to efficiently manage large encrypted archives. When files larger than the threshold (default: 5MB) are added to git-vault, they are automatically tracked with Git LFS if available.

**Benefits:**

- Prevents repository bloat caused by large binary files
- More efficient handling of version history for large files
- Better performance for cloning and fetching repositories with large assets

**Requirements:**

- Git LFS must be installed on your system. [Install Git LFS](https://git-lfs.github.com/)
- Your Git hosting provider must support Git LFS (GitHub, GitLab, Bitbucket, etc.)

**Configuration:**

- The default threshold for LFS tracking is 5MB
- You can customize this threshold during installation with `--min-lfs=<size>` where `<size>` is in megabytes
- The threshold is stored in `.git-vault/lfs-config` for reference by other scripts

**Behavior:**
- If Git LFS is not available, git-vault will still function but will store large files directly in Git
- When LFS is available, git-vault will automatically set up `.gitattributes` and configure LFS tracking
- Archives exceeding the size threshold will be tracked with LFS, while smaller ones will use regular Git tracking

## 1Password Integration

Git-Vault can optionally use the 1Password CLI (`op`) to manage encryption passwords instead of storing them in local `.pw` files.

**Requirements:**

*   [1Password CLI (`op`)](https://1password.com/downloads/command-line/) must be installed and configured on your system.
*   You must be signed in to your 1Password account via the CLI (`op signin`).

**How it Works:**

1.  **Installation:** During `install.sh`, if `op` is detected, you'll be asked if you want to use it. If you choose Yes:
    *   You can specify a 1Password vault name (defaults to "Git-Vault").
    *   Configuration is stored in `.git-vault/storage-mode` and `.git-vault/1password-vault`.
2.  **Adding Files (`add.sh`):** When you add a file/directory:
    *   Instead of saving to a `.pw` file, `add.sh` creates a new Secure Note item in your designated 1Password vault.
    *   The item title follows the pattern `git-vault-<project>-<hash>`.
    *   The item contains fields for the `password`, the original `path`, and a `status` (initially "active").
    *   An empty marker file (`.git-vault/git-vault-<hash>.pw.1p`) is created locally to indicate this path uses 1Password.
3.  **Encryption/Decryption (Hooks):**
    *   The hooks check for the `.pw.1p` marker file.
    *   If present, the hooks use `op item get` to securely retrieve the password from the corresponding 1Password item and use it for `gpg` operations.
    *   If the marker is not present, the hooks fall back to using the local `.pw` file.
4.  **Removing Files (`remove.sh`):**
    *   Verifies the password by retrieving it from 1Password.
    *   Updates the `status` field in the corresponding 1Password item to "removed" (the item is not deleted).
    *   Removes the local `.pw.1p` marker file.

**Usage Notes:**

*   Ensure `op` is installed and you are signed in before running git operations (commit, checkout, merge) if you are using 1Password mode.
*   The integration relies on specific item naming and field conventions within 1Password.

## When To Use It

- Sharing sensitive build artifacts with maintainers or CI/CD pipelines
- AI-native codebases where sensitive information is used to provide context to agents working on the codebase
- Data and research-heavy repositories where tools and data are mixed and have varying access rights between contributors
- Inner-source projects, such as those found in finance, where contributors can often have certain things fire-walled from one another depending on their department
- Repositories with large binary files that need encryption (images, videos, datasets) where Git LFS integration provides efficient storage
- Because you're lazy and only want to type a single command and be done with it

## Development and Testing

This repository contains the **source code** for Git-Vault. The scripts reside at the root level here. When *installed* in your own repository using the command above, the scripts are placed inside the `.git-vault/` subdirectory of *your* project.

The project includes a comprehensive test suite using `bats-core`. Tests verify functionality for:

* Core operations (add, remove, encryption, decryption)
* Error handling and edge cases
* Git hook integration
* Git LFS integration for large archives
* Automatic dependency detection and installation

> [!TIP]
> For details on running or modifying tests, see the [test/README.md](test/README.md) file.

### Environment Setup

To contribute to Git-Vault development, you need to set up your local environment. This ensures you can run the tests and work with the scripts.

**Compatibility:** Git-Vault aims for compatibility across Linux, macOS, and Windows (using Git Bash or WSL).

**Dependencies to Install Manually:**

You must have the following command-line tools installed and available in your system's `PATH`:

1.  **Git:** Essential for version control.
    *   **Linux (Debian/Ubuntu):** `sudo apt update && sudo apt install git`
    *   **Linux (Fedora):** `sudo dnf install git`
    *   **macOS:** `brew install git` or install with Xcode Command Line Tools.
    *   **Windows:** Install [Git for Windows](https://git-scm.com/download/win), which includes Git Bash.

2.  **GnuPG (gpg):** Used for encryption and decryption.
    *   **Linux (Debian/Ubuntu):** `sudo apt update && sudo apt install gnupg`
    *   **Linux (Fedora):** `sudo dnf install gnupg2`
    *   **macOS:** `brew install gnupg`
    *   **Windows (Git Bash):** Included with Git for Windows standard installer, or download from [GnuPG website](https://gnupg.org/download/).

3.  **tar:** For creating and extracting archives.
    *   Usually pre-installed on Linux and macOS.
    *   Included with Git for Windows (Git Bash).

4.  **Core Utilities (sha1sum, mktemp):** Standard Unix utilities.
    *   **Linux:** Typically pre-installed via the `coreutils` package.
    *   **macOS:** `sha1sum` might need installation (`brew install coreutils`), or use `shasum -a 1` which is usually built-in. `mktemp` is usually built-in.
    *   **Windows (Git Bash):** Included with Git for Windows (`sha1sum.exe`, `mktemp.exe`).

5.  **sed:** Stream editor for text manipulation.
    *   Usually pre-installed on Linux and macOS.
    *   Included with Git for Windows (Git Bash).

6.  **Git LFS:** (Optional) For large file support.
    *   **Linux (Debian/Ubuntu):** `sudo apt update && sudo apt install git-lfs`
    *   **Linux (Fedora):** `sudo dnf install git-lfs`
    *   **macOS:** `brew install git-lfs`
    *   **Windows:** Included with recent versions of Git for Windows, or follow [Git LFS installation instructions](https://git-lfs.github.com/).

7.  **Bats-core:** The test framework.
    *   **Linux (Debian/Ubuntu):** `sudo apt update && sudo apt install bats`
    *   **Linux (Fedora):** `sudo dnf install bats`
    *   **macOS:** `brew install bats-core`
    *   **Windows (Git Bash/WSL):** Clone the repo and install manually: `git clone https://github.com/bats-core/bats-core.git && cd bats-core && ./install.sh $HOME` (This installs to `$HOME/bin`, ensure this is in your PATH).

**Vendored Dependencies (Included):**

The following Bats helper libraries are included directly in the repository under `test/test_helper/`. You do **not** need to install these separately:

*   `bats-assert`
*   `bats-file`
*   `bats-support`

**Setup Steps:**

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/zackiles/git-vault.git
    cd git-vault
    ```
2.  **Install the manual dependencies** listed above for your operating system.
3.  **Verify installation:**
    *   Try running a basic command for each dependency (e.g., `git --version`, `gpg --version`, `bats --version`).
    *   Run the test suite from the project root to confirm everything is working:
        ```bash
        bats test
        ```

You should now have a complete development environment ready to work on Git-Vault.

## License

MIT License - see the [LICENSE](LICENSE) file for details.
