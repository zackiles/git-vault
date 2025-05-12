# Git-Vault: Optional Dependency Installation Checklist

Git-Vault requires several system dependencies to function properly. The installation script now includes automatic dependency detection and optional installation for supported platforms.

## Required Dependencies

- `gpg` - For encryption and decryption
- `tar` - For file archiving
- `mktemp` - For creating temporary files
- `sha1sum` or `shasum` - For file integrity verification
- `sed` - For text processing

## Supported Platforms

The automatic dependency installation is supported on the following platforms:

### Linux
- Debian/Ubuntu (using apt)
- Fedora (using dnf)
- Arch Linux (using pacman)

### macOS
- Using Homebrew (will prompt to install if not present)

### Windows
- Git Bash/MinGW environment (most dependencies included with Git for Windows)

## Installation Process

1. When running `install.sh`, the script automatically checks for required dependencies
2. If any dependencies are missing:
   - The script lists the missing dependencies
   - For supported platforms, it offers to install them automatically
   - For unsupported platforms, it provides instructions for manual installation

## Manual Installation

If automatic installation is not available or fails, you can install the dependencies manually:

### Debian/Ubuntu
```bash
sudo apt-get update
sudo apt-get install gnupg tar coreutils sed
```

### Fedora
```bash
sudo dnf install gnupg tar coreutils sed
```

### Arch Linux
```bash
sudo pacman -Sy gnupg tar coreutils sed
```

### macOS
```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# Install dependencies
brew install gnupg coreutils
```

### Windows
Install Git for Windows with all components from:
https://git-scm.com/download/win

## Troubleshooting

If you encounter any issues with dependency installation:

1. Ensure you have sufficient permissions (sudo access on Linux)
2. Check your internet connection
3. Try installing the dependencies manually using the commands above
4. If problems persist, please open an issue on the Git-Vault repository

---

### 1) Dependency Detection Logic
Implement the core logic to check for the required command-line tools.

#### 1.1) Identify Required Dependencies
- [x] Confirm the list of essential dependencies: `gpg`, `tar`, `sha1sum` (or `shasum`), `mktemp`.
- [x] Verify if `sed` or other core utilities used by the scripts should also be checked.

#### 1.2) Implement Detection Function
- [x] Create a shell function (e.g., `check_dependency`) that takes a command name as input.
- [x] Use `command -v <command_name> >/dev/null 2>&1` within the function to check if the command exists in the `PATH`.
- [x] The function should return `0` if the command exists, and `1` otherwise.
- [x] Handle the `sha1sum`/`shasum` alternative: check for `sha1sum` first, if not found, check for `shasum`. Store the available command (e.g., in `SHASUM_CMD` variable) for later use if needed, but primarily focus on checking if *at least one* is present for the dependency check.

#### 1.3) Check All Dependencies
- [x] Call the detection function for each required dependency at the beginning of `install.sh` (after argument parsing but before major actions).
- [x] Store the list of missing dependencies in an array or string.

### 2) Platform Identification
Determine the user's operating system to select the correct installation method.

#### 2.1) Implement OS Detection
- [x] Use `uname -s` to get the OS kernel name.
- [x] Map kernel names to platform identifiers:
    - `Linux` -> `linux`
    - `Darwin` -> `macos`
    - `CYGWIN* | MINGW* | MSYS*` -> `windows` (for Git Bash/WSL environments)
- [x] Store the detected platform identifier (e.g., in an `OS_PLATFORM` variable).
- [x] Add a check for unsupported platforms and exit gracefully if detected.

### 3) Installation Logic (Per Platform)
Define and implement the installation commands for each supported platform.

#### 3.1) Research Installation Commands
- [x] **Linux:** Identify common package managers (`apt`, `dnf`, `pacman`). Determine the standard package names for `gpg` (`gnupg` or `gnupg2`), `tar`, `coreutils` (for `sha1sum`, `mktemp`), `sed`. Assume `sudo` is likely required.
- [x] **macOS:** Assume `brew` (Homebrew) is the primary package manager. Find the corresponding package names (e.g., `gnupg`, `coreutils`).
- [x] **Windows (Git Bash/WSL):** Determine if dependencies are typically included with Git for Windows. If not, consider `choco` or `winget` package managers, or advise manual installation. Prioritize built-in tools if available.

#### 3.2) Implement Platform-Specific Install Functions
- [x] Create separate functions for each platform (e.g., `install_deps_linux`, `install_deps_macos`, `install_deps_windows`).
- [x] Each function should take the list of missing dependencies as input.
- [x] Inside each function:
    - **Linux:** Detect the package manager (`apt`/`dnf`/`pacman`) and construct the appropriate install command (e.g., `sudo apt update && sudo apt install -y gnupg tar coreutils`). Handle potential variations in package names.
    - **macOS:** Construct the `brew install gnupg coreutils` command. Check if `brew` itself needs installation/update first.
    - **Windows:** Implement logic using `choco` or `winget` if chosen, or print clear instructions for manual installation if automatic installation is deemed too complex/unreliable in this environment.

#### 3.3) Create Main Installation Function
- [x] Create a main function (e.g., `install_missing_dependencies`) that takes the list of missing dependencies.
- [x] Use a `case` statement based on the `$OS_PLATFORM` variable to call the appropriate platform-specific installation function.

### 4) User Interaction
Prompt the user before attempting any installations.

#### 4.1) Check if Dependencies Are Missing
- [x] After running the initial dependency checks (Phase 1), check if the list of missing dependencies is non-empty.
- [x] If all dependencies are present, skip the rest of this phase and Phase 3.

#### 4.2) Prompt User for Installation
- [x] If dependencies are missing, display a message listing them.
- [x] Ask the user if they want the script to attempt installation (e.g., "The following dependencies are missing: [...]. Attempt to install them? [Y/n]").
- [x] Read the user's response. Default to 'no' if the response is not 'y' or 'Y'.

#### 4.3) Execute Installation Based on Response
- [x] If the user agrees, call the main installation function (`install_missing_dependencies`) from Phase 3.
- [x] If the user declines, print a message listing the missing dependencies and exit the script gracefully (exit code 1).

### 5) Error Handling
Ensure installation failures are handled correctly.

#### 5.1) Capture Installation Command Output
- [x] Redirect `stdout` and `stderr` from package manager commands to capture success/failure and error messages.
- [x] Check the exit code of the installation command.

#### 5.2) Report Failures
- [x] If an installation command fails (non-zero exit code):
    - Print a clear error message indicating which dependency failed to install.
    - Show the captured output from the package manager command for debugging.
    - Exit the `install.sh` script with a non-zero exit code.

#### 5.3) Re-Verify After Installation Attempt
- [x] After a successful installation attempt (exit code 0 from the package manager), re-run the dependency detection logic (Phase 1) to confirm the dependencies are now available.
- [x] If any dependencies are still missing after the attempt, report an error and exit.

### 6) Configuration and Maintainability
Structure the code for easy updates.

#### 6.1) Centralize Dependency List
- [x] Define the list of required dependencies in a variable near the top of the script for easy modification.

#### 6.2) Modular Functions
- [x] Ensure detection, platform identification, and installation logic are encapsulated in well-named functions.

#### 6.3) Clear Comments
- [x] Add comments explaining the purpose of different sections, especially the platform detection and installation logic.

### 7) Testing
Add tests to verify the new functionality.

#### 7.1) Create New Test File
- [x] Create a new Bats test file (e.g., `test/install_deps.bats`).

#### 7.2) Test Dependency Detection
- [x] Write tests that mock `command -v` to simulate dependencies being present or absent. Verify the script correctly identifies missing dependencies.

#### 7.3) Test User Prompting
- [x] Write tests that simulate user input ('y', 'n', empty) for the installation prompt. Verify the script proceeds or exits accordingly.

#### 7.4) Test Installation Command Execution (Mocked)
- [x] Write tests for each platform (Linux, macOS, Windows).
- [x] Mock the platform detection (`uname`) and the relevant package manager command (`apt`, `brew`, `choco`, etc.).
- [x] Verify that the correct installation command is *attempted* based on the detected platform and missing dependencies.
- [x] Mock the installation command to return success (0) or failure (non-zero). Verify the script handles the outcome correctly (re-checking dependencies or exiting on failure).

### 8) Documentation Update
Update the README to reflect the new installation behavior.

#### 8.1) Modify Dependency Section
- [x] Update the `README.md` section listing manual dependencies.
- [x] Explain that `install.sh` will now check for these dependencies and offer to install them.
- [x] Briefly mention the supported platforms and package managers used for automatic installation.
- [x] Still recommend manual installation as a fallback or preference if the user desires.

---

## Appendix

*   **Linux Package Managers:**
    *   Debian/Ubuntu: `apt-get install -y <package>`
    *   Fedora: `dnf install -y <package>`
    *   Arch: `pacman -S --noconfirm <package>`
*   **macOS Package Manager:**
    *   Homebrew: `brew install <package>`
*   **Windows Package Managers:**
    *   Chocolatey: `choco install <package> -y`
    *   Winget: `winget install --id <PackageIdentifier> -e --accept-source-agreements --accept-package-agreements` (Requires finding package identifiers)

---

## Summary

The goal is to enhance `install.sh` to automatically detect and offer installation of missing dependencies (`gpg`, `tar`, `sha1sum`/`shasum`, `mktemp`) across Linux, macOS, and Windows (Git Bash/WSL).

All phases have been completed and tested. The implementation now properly detects missing dependencies, identifies the platform, and installs the required packages when the user agrees. Re-verification ensures all dependencies are properly installed, and comprehensive error handling guides users through any issues they might encounter. 
