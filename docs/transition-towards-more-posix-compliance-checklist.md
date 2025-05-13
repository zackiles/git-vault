# Transition Towards More POSIX Compliance Checklist
*Created: May 20, 2024*

## Summary of Intended Change

The goal of this implementation is to standardize all shell scripts and test suites in git-vault to use POSIX `sh` exclusively, eliminating dependencies on `bash`-specific features. This will improve portability, maintainability, and consistency across the project. Currently, most scripts (`utils.sh`, `install.sh`, `encrypt.sh`, `decrypt.sh`, `remove.sh`) already use POSIX-compliant shell, while `add.sh` explicitly uses `bash` and contains several bash-specific features. The test suite also contains many bash-specific constructs.

## Implementation Checklist

### 1) Setup Test Environment for POSIX Testing
Set up a proper testing environment that can validate POSIX compliance across different platforms and shells.

#### 1.1) Create Testing Infrastructure
- [ ] Set up a testing framework that can run scripts with different shell implementations (dash, busybox sh, etc.)
- [ ] Create or update CI configuration to test with various POSIX-compliant shells
- [ ] Create test utility to validate scripts with `shellcheck` using `--shell=sh` flag

#### 1.2) Create Validation Helper
- [ ] Create a script that can analyze source files for bash-specific syntax
- [ ] Add validation for shebangs (`#!/usr/bin/env sh` vs `#!/bin/bash`)
- [ ] Implement checking for common bashisms (`[[`, `local`, `$()`, etc.)

### 2) Adapt Test Framework
Update the test infrastructure to support POSIX sh testing before modifying the actual scripts.

#### 2.1) Update Test Runner (test/run-tests.sh)
- [x] Change shebang from `#!/usr/bin/env bash` to `#!/usr/bin/env sh`
- [x] Replace any bash-specific features in test runner

#### 2.2) Update Test Helper functions
- [x] Identify bash-specific constructs in test_helper.bash
- [x] Replace `[[` with `[` for conditions
- [x] Replace bashism regex matching (`=~`) with POSIX alternatives (`case` or `expr`)
- [x] Ensure all test helper functions work with POSIX sh

#### 2.3) Update Mock Functions
- [x] Convert any bash-specific mock command generation to use POSIX sh
- [x] Update the `create_mock_command` function in tests to use `/bin/sh` consistently
- [x] Modify function mocking to use `PATH` manipulation instead of `export -f`

### 3) Update Core Script - add.sh
Convert the add.sh script from bash to POSIX sh, focusing on maintaining functionality while improving portability.

#### 3.1) Update Shebang and Basic Structure
- [x] Change shebang from `#!/bin/bash` to `#!/usr/bin/env sh`
- [x] Replace `set -euo pipefail` with POSIX-compatible error handling
- [x] Update any bash-specific comments or documentation

#### 3.2) Fix Password Input Handling
- [ ] Replace `read -r -s PASSWORD` with POSIX-compatible silent input using `stty -echo` and `stty echo`
- [ ] Test password input handling across different platforms
- [ ] Ensure error handling around `stty` commands is robust

#### 3.3) Fix Path Handling
- [ ] Replace `realpath` with POSIX-compatible absolute path calculation
- [ ] Replace `cp -a` with portable alternatives (`cp -R -p` or `tar` for directory copying)
- [ ] Test path handling with spaces and special characters

#### 3.4) Fix File Size Detection
- [ ] Replace GNU/BSD-specific `du` options with portable alternatives
- [ ] Replace `stat` usage with POSIX-compatible alternatives (like `wc -c`)
- [ ] Test file size detection across different platforms

### 4) Update install.sh Script
Fix the remaining bash-specific features in install.sh to ensure full POSIX compliance.

#### 4.1) Fix Regex and Double Bracket Usage
- [x] Replace `[[ $REPLY =~ ^[Yy]$ ]]` with `case "$REPLY" in [Yy]*) ... esac`
- [x] Replace `[[ "$LFS_THRESHOLD" =~ ^[0-9]+$ ]]` with POSIX number validation
- [x] Convert any remaining `[[` expressions to `[` with appropriate quoting

#### 4.2) Fix Read With Prompt
- [x] Replace `read -p` with `printf` followed by `read`
- [x] Test interactive prompts across different platforms

### 5) Update encrypt.sh and decrypt.sh Scripts
Fix the paths.list parsing in encrypt.sh and decrypt.sh to correctly handle paths with spaces.

#### 5.1) Fix Paths List Parsing
- [x] Update the loop that reads paths.list to properly handle spaces in paths
- [x] Test with complex paths containing spaces and special characters
- [x] Ensure backward compatibility with existing paths.list files

### 6) Update remove.sh Script
Fix the in-place sed usage in remove.sh script.

#### 6.1) Fix In-place sed Editing
- [x] Replace `sed -i.bak` with output redirection and `mv`
- [x] Test file modifications across different platforms
- [x] Ensure temporary files are properly cleaned up

### 7) Comprehensive Testing
Test all changes thoroughly to ensure functionality is preserved while improving portability.

#### 7.1) Run Tests Across Different Shells
- [ ] Test with dash (Debian's /bin/sh)
- [ ] Test with busybox sh
- [ ] Test on macOS using the system /bin/sh
- [ ] Test on Windows using Git Bash

#### 7.2) Test Real-world Scenarios
- [ ] Test with paths containing spaces and special characters
- [ ] Test with large files to ensure LFS integration still works
- [ ] Test with nested directories

### 8) Documentation and Release
Update documentation to reflect the improved portability and complete the implementation.

#### 8.1) Update README and Documentation
- [ ] Update README.md to mention POSIX sh compatibility
- [ ] Update any documentation that references bash requirements
- [ ] Document the improved portability as a feature

#### 8.2) Release Planning
- [ ] Update RELEASING.md if needed
- [ ] Plan version bump according to semantic versioning principles

## Appendix: Code Samples

### Example: Silent Password Input in POSIX sh
```sh
echo "Enter encryption password for '$RELATIVE_PATH_TO_PROTECT':"
stty -echo
read -r PASSWORD
stty echo
echo  # Add newline after input
echo "Confirm password:"
stty -echo
read -r PASSWORD_CONFIRM
stty echo
echo  # Add newline after input
```

### Example: POSIX-compatible Absolute Path Calculation
```sh
if [ -d "$PATH_TO_PROTECT" ]; then
  REAL_PATH="$(cd "$PATH_TO_PROTECT" && pwd -P)"
else
  REAL_PATH="$(cd "$(dirname "$PATH_TO_PROTECT")" && pwd -P)/$(basename "$PATH_TO_PROTECT")"
fi
```

### Example: POSIX-compatible File Size Detection
```sh
ARCHIVE_SIZE_KB=$(du -k "$ARCHIVE_FILE" | cut -f1)
ARCHIVE_SIZE=$((ARCHIVE_SIZE_KB / 1024))  # Integer division for MB
```

### Example: POSIX-compatible paths.list Parsing
```sh
while IFS= read -r line || [ -n "$line" ]; do  # Process even if last line has no newline
  case "$line" in
    '#'*|'') continue ;;  # Skip comments and empty lines
  esac

  # Extract HASH (first 8 chars) and PATH_IN (rest of the line)
  HASH="${line%% *}"      # Part before first space
  PATH_IN="${line#* }"    # Part after first space

  # Validate format (basic check)
  if [ "${#HASH}" -ne 8 ] || [ "$HASH" = "$PATH_IN" ]; then
    echo "HOOK INFO: Skipping malformed line in $MANIFEST: $line" >&2
    continue
  fi
  
  # Rest of processing...
done < "$MANIFEST"
```

### Example: POSIX-compatible In-place File Editing
```sh
# Instead of: sed -i.bak "/^$HASH /d" "$MANIFEST"
sed "/^$HASH /d" "$MANIFEST" > "$MANIFEST.tmp" && mv "$MANIFEST.tmp" "$MANIFEST"
```

## Summary

This implementation plan will standardize all shell scripts in git-vault to use POSIX sh exclusively, eliminating dependencies on bash-specific features. This will significantly improve portability across different Unix-like systems, including those where bash is not the default shell or might not be installed.

The plan addresses all identified bashisms in the codebase, including silent password reading, path handling, file size detection, regular expression matching, and in-place file editing. It starts by adapting the test framework before modifying the actual scripts, ensuring that tests can validate the changes properly.

Please follow each phase in order and mark steps complete before moving on to the next phase. After completing each phase, you MUST run the tests to validate that you completed the phase successfully before moving on to the next phase. You can choose to write tests for the new POSIX-compatible features either at the end once all phases are complete, or after each phase. Choose the approach that makes the most sense given the nature of the changes being made to ensure robust testing without excessive duplication of effort. 
