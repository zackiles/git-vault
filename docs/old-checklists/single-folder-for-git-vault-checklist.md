# Single Folder for Git Vault - Implementation Checklist

*2025-05-10*

## Introduction

This document outlines the implementation plan for moving all git-vault related files (except git hooks) into a centralized `.git-vault` folder to reduce clutter in the user's project. The implementation will update the folder structure, file paths, and ensure all existing functionality works with the new structure.

## Implementation Phases

### 1) Analysis of Current Structure and Dependencies

Analyze the current file organization and identify all references to paths that will need to be updated.

#### 1.1) Identify Current Paths and References
- [x] Review where script files are installed (currently in `git-vault/`)
- [x] Analyze where paths are stored and referenced (currently in `paths.list`)
- [x] Understand where storage directory is created (currently `storage/`)
- [x] List all relevant path constants in each script file

#### 1.2) Document Path Relationships
- [x] Create a mapping of current paths to new paths
- [x] Identify all variable names that need updating in scripts
- [x] Confirm whether relative or absolute paths are used consistently
- [x] Determine if path calculations need to change with new structure

### 2) Update Install Script

Modify the install.sh script to establish the new folder structure during installation.

#### 2.1) Update Directory Structure Creation
- [x] Change the target directory from `git-vault/` to `.git-vault/`
- [x] Add code to create `.git-vault/storage/` instead of `storage/`
- [x] Update path constants and variables throughout install.sh
- [x] Update any related path documentation in install.sh

#### 2.2) Update Download Location and Path References
- [x] Modify the download_or_use_local function to use new folder structure
- [x] Update variables for target paths of downloaded scripts
- [x] Refactor any functions related to path determination

#### 2.3) Update .gitignore Handling
- [x] Update .gitignore settings to handle new path structure
- [x] Update logic in `install.sh` that checks if the storage directory itself is ignored to use the new `.git-vault/storage/` path
- [x] Ensure the new storage location (`.git-vault/storage/`) is correctly tracked (e.g., not ignored, or explicitly negated with `!`)
- [x] Update password file ignore patterns using the updated `TARGET_GIT_VAULT_DIR_REL` variable in `install.sh`

### 3) Update Core Script Files

Update the core operation scripts to use the new centralized folder structure.

#### 3.1) Update add.sh
- [x] Update `VAULT_DIR` variable derivation (based on `SCRIPT_DIR`) to reflect `.git-vault/` location
- [x] Update `STORAGE_DIR` variable derivation to point to `.git-vault/storage/` (relative to `VAULT_DIR`)
- [x] Ensure `PATHS_FILE` and `PW_FILE` correctly resolve within `.git-vault/`
- [x] Verify `ARCHIVE_PATH` resolves correctly within `.git-vault/storage/`
- [x] Ensure `.gitignore` update logic uses the correct relative path based on the new structure
- [x] Test adding files with new structure

#### 3.2) Update remove.sh
- [x] Update `GIT_VAULT_DIR` variable to `.git-vault`
- [x] Update `STORAGE_DIR` variable to `storage` (note: relative to `GIT_VAULT_DIR`)
- [x] Ensure `MANIFEST`, `PWFILE`, and `ARCHIVE` path variables correctly resolve within the new structure
- [x] Modify `.gitignore` check and removal logic to accommodate new paths
- [x] Ensure password file renaming (`REMOVED_PWFILE`) uses the new base path
- [x] Test removing files with new structure

#### 3.3) Update encrypt.sh and decrypt.sh
- [x] Update `GIT_VAULT_DIR` variable to `.git-vault` in both scripts
- [x] Update `STORAGE_DIR` variable to `storage` (note: relative to `GIT_VAULT_DIR`) in both scripts
- [x] Ensure `MANIFEST`, `PWFILE`, and `ARCHIVE` path variables correctly resolve within the new structure in both scripts
- [x] Test encryption and decryption with new structure

### 4) Update Git Hook Integration

Ensure that git hooks properly interact with the new folder structure.

#### 4.1) Modify Hook Installation Logic
- [x] Update `TARGET_GIT_VAULT_DIR_REL` variable in `install.sh` to `.git-vault`
- [x] Update `install_hook` function in `install.sh` to correctly calculate `hook_script_path` using the updated `TARGET_GIT_VAULT_DIR_REL`
- [x] Fix relative path calculations if necessary, although using absolute paths for `hook_script_path` is preferred as currently done
- [x] Test hook setup with new structure

#### 4.2) Ensure Hook Script References Are Updated
- [x] Verify hook script commands written into the hook files point to the correct `.git-vault/` script paths

### 5) Update Tests

Update all tests to reflect the new folder structure while maintaining test integrity.

#### 5.1) Analyze Test Structure
- [x] Review all test files that use path references
- [x] Identify tests that create or verify folder structures
- [x] Create a plan for updating test assertions

#### 5.2) Update Test Files
- [x] Modify test_helper.bash (e.g., `install_git_vault` function) to accommodate new folder structure
- [x] Update path assertions (`assert_file_exist`, `grep`, `run cat`, etc.) in `core.bats`, `remove.bats`, and `errors.bats` tests to use `.git-vault/` and `.git-vault/storage/` paths
- [x] Update assertions checking hook output messages for correct paths (e.g., messages mentioning `.git-vault/storage/...` or script paths)
- [x] Ensure test fixture paths are updated consistently if any are used
- [x] Update any test commands that reference the scripts by the old `git-vault/` path

#### 5.3) Add New Tests for Migration Scenarios
- [x] Add tests to verify backward compatibility where needed
- [x] Create tests for handling existing repos during structure migration
- [x] Test edge cases related to path changes

### 6) Update Documentation

Update all documentation to reflect the new folder structure.

#### 6.1) Update README.md
- [x] Update installation instructions in README.md
- [x] Modify usage examples to use new paths
- [x] Update explanations of how the tool works with new structure
- [x] Ensure all path references in README reflect the new structure

#### 6.2) Review and Update Other Documentation
- [x] Check for any other documentation files with path references
- [x] Update RELEASING.md if it contains path references
- [x] Create migration notes for existing users

## Appendix

### A. Path Reference Map
```
Current Structure                 New Structure
------------------                -------------
git-vault/                        .git-vault/
git-vault/add.sh                  .git-vault/add.sh
git-vault/remove.sh               .git-vault/remove.sh
git-vault/encrypt.sh              .git-vault/encrypt.sh
git-vault/decrypt.sh              .git-vault/decrypt.sh
git-vault/paths.list              .git-vault/paths.list
git-vault/*.pw                    .git-vault/*.pw
storage/                          .git-vault/storage/
```

### B. Key Code Sections to Update

#### B.1 Script Path Constants
```bash
# Current (example from remove.sh/encrypt.sh/decrypt.sh)
GIT_VAULT_DIR="git-vault"
STORAGE_DIR="storage" # Relative to repo root

# Current (example from add.sh)
VAULT_DIR="$SCRIPT_DIR" # $SCRIPT_DIR is git-vault
STORAGE_DIR="$(dirname "$VAULT_DIR")/storage" # Relative to script's parent dir

# New (consistent approach recommended)
GIT_VAULT_DIR=".git-vault" # Relative to repo root
STORAGE_DIR=".git-vault/storage" # Relative to repo root
# Individual scripts will need adjustments to derive these relative to repo root
```

#### B.2 Installation Directory Creation
```bash
# Current
mkdir -p "$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR" "$TARGET_REPO_ROOT/$STORAGE_DIR" "$HOOKS_DIR"

# New
mkdir -p "$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR" "$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR/storage" "$HOOKS_DIR"
```

#### B.3 .gitignore Pattern Updates
```bash
# Current
# Based on TARGET_GIT_VAULT_DIR_REL="git-vault"
PW_IGNORE_PATTERN="git-vault/*.pw" 

# New
# Based on TARGET_GIT_VAULT_DIR_REL=".git-vault"
PW_IGNORE_PATTERN=".git-vault/*.pw"
```

#### B.4 Hook Script Path Calculation (in install.sh)
```bash
# Current
TARGET_GIT_VAULT_DIR_REL="git-vault"
hook_script_path="$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR_REL/$script_name" # Resolves to <repo>/.git-vault/script.sh

# New
TARGET_GIT_VAULT_DIR_REL=".git-vault" # <-- Update this variable
hook_script_path="$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR_REL/$script_name" # Resolves to <repo>/.git-vault/script.sh
```

## Summary

The objective of this implementation is to reduce clutter in the user's project by centralizing all git-vault related files (except git hooks) into a single `.git-vault` folder with a nested `storage` subfolder. This change affects path references throughout the codebase, requiring updates to scripts, tests, and documentation.

Work through each phase in order, marking steps complete after completion. Run tests after completing each phase to validate your implementation before proceeding to the next phase. When implementing each phase, take care to maintain backward compatibility where possible and ensure all functionality continues to work with the new folder structure.

You may choose to write tests for the new features in one of two ways:
1. At the end once all phases are complete, or 
2. After each phase.

Choose whichever approach makes more sense given the complexity of changes in each phase. After completing each phase, run the tests to validate you've completed the phase correctly before moving on to the next phase. 
