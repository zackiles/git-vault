# Git-Vault: Optional Dependency Installation Checklist

**Date:** {current_datetime}

**Summary:** Modify the `install.sh` script to detect missing dependencies (`gpg`, `tar`, `sha1sum`/`shasum`, `mktemp`) required by git-vault. If dependencies are missing, prompt the user to automatically install them based on their operating system (Linux, macOS, Windows via Git Bash/WSL). Ensure the installation process is robust, handles errors gracefully, and is maintainable.

---

### 1) Dependency Detection Logic
Implement the core logic to check for the required command-line tools.

#### 1.1) Identify Required Dependencies
- [ ] Confirm the list of essential dependencies: `gpg`, `tar`, `sha1sum` (or `shasum`), `mktemp`.
- [ ] Verify if `sed` or other core utilities used by the scripts should also be checked.

#### 1.2) Implement Detection Function
- [ ] Create a shell function (e.g., `check_dependency`) that takes a command name as input.
- [ ] Use `command -v <command_name> >/dev/null 2>&1` within the function to check if the command exists in the `PATH`.
- [ ] The function should return `0` if the command exists, and `1` otherwise.
- [ ] Handle the `sha1sum`/`shasum` alternative: check for `sha1sum` first, if not found, check for `shasum`. Store the available command (e.g., in `SHASUM_CMD` variable) for later use if needed, but primarily focus on checking if *at least one* is present for the dependency check.

#### 1.3) Check All Dependencies
- [ ] Call the detection function for each required dependency at the beginning of `install.sh` (after argument parsing but before major actions).
- [ ] Store the list of missing dependencies in an array or string.

### 2) Platform Identification
Determine the user's operating system to select the correct installation method.

#### 2.1) Implement OS Detection
- [ ] Use `uname -s` to get the OS kernel name.
- [ ] Map kernel names to platform identifiers:
    - `Linux` -> `linux`
    - `Darwin` -> `macos`
    - `CYGWIN* | MINGW* | MSYS*` -> `windows` (for Git Bash/WSL environments)
- [ ] Store the detected platform identifier (e.g., in an `OS_PLATFORM` variable).
- [ ] Add a check for unsupported platforms and exit gracefully if detected.

### 3) Installation Logic (Per Platform)
Define and implement the installation commands for each supported platform.

#### 3.1) Research Installation Commands
- [ ] **Linux:** Identify common package managers (`apt`, `dnf`, `pacman`). Determine the standard package names for `gpg` (`gnupg` or `gnupg2`), `tar`, `coreutils` (for `sha1sum`, `mktemp`), `sed`. Assume `sudo` is likely required.
- [ ] **macOS:** Assume `brew` (Homebrew) is the primary package manager. Find the corresponding package names (e.g., `gnupg`, `coreutils`).
- [ ] **Windows (Git Bash/WSL):** Determine if dependencies are typically included with Git for Windows. If not, consider `choco` or `winget` package managers, or advise manual installation. Prioritize built-in tools if available.

#### 3.2) Implement Platform-Specific Install Functions
- [ ] Create separate functions for each platform (e.g., `install_deps_linux`, `install_deps_macos`, `install_deps_windows`).
- [ ] Each function should take the list of missing dependencies as input.
- [ ] Inside each function:
    - **Linux:** Detect the package manager (`apt`/`dnf`/`pacman`) and construct the appropriate install command (e.g., `sudo apt update && sudo apt install -y gnupg tar coreutils`). Handle potential variations in package names.
    - **macOS:** Construct the `brew install gnupg coreutils` command. Check if `brew` itself needs installation/update first.
    - **Windows:** Implement logic using `choco` or `winget` if chosen, or print clear instructions for manual installation if automatic installation is deemed too complex/unreliable in this environment.

#### 3.3) Create Main Installation Function
- [ ] Create a main function (e.g., `install_missing_dependencies`) that takes the list of missing dependencies.
- [ ] Use a `case` statement based on the `$OS_PLATFORM` variable to call the appropriate platform-specific installation function.

### 4) User Interaction
Prompt the user before attempting any installations.

#### 4.1) Check if Dependencies Are Missing
- [ ] After running the initial dependency checks (Phase 1), check if the list of missing dependencies is non-empty.
- [ ] If all dependencies are present, skip the rest of this phase and Phase 3.

#### 4.2) Prompt User for Installation
- [ ] If dependencies are missing, display a message listing them.
- [ ] Ask the user if they want the script to attempt installation (e.g., "The following dependencies are missing: [...]. Attempt to install them? [Y/n]").
- [ ] Read the user's response. Default to 'no' if the response is not 'y' or 'Y'.

#### 4.3) Execute Installation Based on Response
- [ ] If the user agrees, call the main installation function (`install_missing_dependencies`) from Phase 3.
- [ ] If the user declines, print a message listing the missing dependencies and exit the script gracefully (exit code 1).

### 5) Error Handling
Ensure installation failures are handled correctly.

#### 5.1) Capture Installation Command Output
- [ ] Redirect `stdout` and `stderr` from package manager commands to capture success/failure and error messages.
- [ ] Check the exit code of the installation command.

#### 5.2) Report Failures
- [ ] If an installation command fails (non-zero exit code):
    - Print a clear error message indicating which dependency failed to install.
    - Show the captured output from the package manager command for debugging.
    - Exit the `install.sh` script with a non-zero exit code.

#### 5.3) Re-Verify After Installation Attempt
- [ ] After a successful installation attempt (exit code 0 from the package manager), re-run the dependency detection logic (Phase 1) to confirm the dependencies are now available.
- [ ] If any dependencies are still missing after the attempt, report an error and exit.

### 6) Configuration and Maintainability
Structure the code for easy updates.

#### 6.1) Centralize Dependency List
- [ ] Define the list of required dependencies in a variable near the top of the script for easy modification.

#### 6.2) Modular Functions
- [ ] Ensure detection, platform identification, and installation logic are encapsulated in well-named functions.

#### 6.3) Clear Comments
- [ ] Add comments explaining the purpose of different sections, especially the platform detection and installation logic.

### 7) Testing
Add tests to verify the new functionality.

#### 7.1) Create New Test File
- [ ] Create a new Bats test file (e.g., `test/install_deps.bats`).

#### 7.2) Test Dependency Detection
- [ ] Write tests that mock `command -v` to simulate dependencies being present or absent. Verify the script correctly identifies missing dependencies.

#### 7.3) Test User Prompting
- [ ] Write tests that simulate user input ('y', 'n', empty) for the installation prompt. Verify the script proceeds or exits accordingly.

#### 7.4) Test Installation Command Execution (Mocked)
- [ ] Write tests for each platform (Linux, macOS, Windows).
- [ ] Mock the platform detection (`uname`) and the relevant package manager command (`apt`, `brew`, `choco`, etc.).
- [ ] Verify that the correct installation command is *attempted* based on the detected platform and missing dependencies.
- [ ] Mock the installation command to return success (0) or failure (non-zero). Verify the script handles the outcome correctly (re-checking dependencies or exiting on failure).

### 8) Documentation Update
Update the README to reflect the new installation behavior.

#### 8.1) Modify Dependency Section
- [ ] Update the `README.md` section listing manual dependencies.
- [ ] Explain that `install.sh` will now check for these dependencies and offer to install them.
- [ ] Briefly mention the supported platforms and package managers used for automatic installation.
- [ ] Still recommend manual installation as a fallback or preference if the user desires.

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

Follow the phases in order. Mark steps complete using the checkboxes. After completing each phase, **run the relevant tests** (or all tests once testing phase is reached) to validate the implementation before proceeding to the next phase. You can choose to write tests for the new features either after each phase or at the end (Phase 7), whichever seems more practical. Ensure error handling is robust and user prompts are clear. 
