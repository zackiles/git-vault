# Single Folder for Git Vault - Implementation Checklist

*2023-09-24*

## Introduction

This document outlines the implementation plan for moving all git-vault related files (except git hooks) into a centralized `.git-vault` folder to reduce clutter in the user's project. The implementation will update the folder structure, file paths, and ensure all existing functionality works with the new structure.

## Implementation Phases

### 1) Analysis of Current Structure and Dependencies

Analyze the current file organization and identify all references to paths that will need to be updated.

#### 1.1) Identify Current Paths and References
- [ ] Review where script files are installed (currently in `git-vault/`)
- [ ] Analyze where paths are stored and referenced (currently in `paths.list`)
- [ ] Understand where storage directory is created (currently `storage/`)
- [ ] List all relevant path constants in each script file

#### 1.2) Document Path Relationships
- [ ] Create a mapping of current paths to new paths
- [ ] Identify all variable names that need updating in scripts
- [ ] Confirm whether relative or absolute paths are used consistently
- [ ] Determine if path calculations need to change with new structure

### 2) Update Install Script

Modify the install.sh script to establish the new folder structure during installation.

#### 2.1) Update Directory Structure Creation
- [ ] Change the target directory from `git-vault/` to `.git-vault/`
- [ ] Add code to create `.git-vault/storage/` instead of `storage/`
- [ ] Update path constants and variables throughout install.sh
- [ ] Update any related path documentation in install.sh

#### 2.2) Update Download Location and Path References
- [ ] Modify the download_or_use_local function to use new folder structure
- [ ] Update variables for target paths of downloaded scripts
- [ ] Refactor any functions related to path determination

#### 2.3) Update .gitignore Handling
- [ ] Update .gitignore settings to handle new path structure
- [ ] Update logic in `install.sh` that checks if the storage directory itself is ignored to use the new `.git-vault/storage/` path
- [ ] Ensure the new storage location (`.git-vault/storage/`) is correctly tracked (e.g., not ignored, or explicitly negated with `!`)
- [ ] Update password file ignore patterns using the updated `TARGET_GIT_VAULT_DIR_REL` variable in `install.sh`

### 3) Update Core Script Files

Update the core operation scripts to use the new centralized folder structure.

#### 3.1) Update add.sh
- [ ] Update `VAULT_DIR` variable derivation (based on `SCRIPT_DIR`) to reflect `.git-vault/` location
- [ ] Update `STORAGE_DIR` variable derivation to point to `.git-vault/storage/` (relative to `VAULT_DIR`)
- [ ] Ensure `PATHS_FILE` and `PW_FILE` correctly resolve within `.git-vault/`
- [ ] Verify `ARCHIVE_PATH` resolves correctly within `.git-vault/storage/`
- [ ] Ensure `.gitignore` update logic uses the correct relative path based on the new structure
- [ ] Test adding files with new structure

#### 3.2) Update remove.sh
- [ ] Update `GIT_VAULT_DIR` variable to `.git-vault`
- [ ] Update `STORAGE_DIR` variable to `storage` (note: relative to `GIT_VAULT_DIR`)
- [ ] Ensure `MANIFEST`, `PWFILE`, and `ARCHIVE` path variables correctly resolve within the new structure
- [ ] Modify `.gitignore` check and removal logic to accommodate new paths
- [ ] Ensure password file renaming (`REMOVED_PWFILE`) uses the new base path
- [ ] Test removing files with new structure

#### 3.3) Update encrypt.sh and decrypt.sh
- [ ] Update `GIT_VAULT_DIR` variable to `.git-vault` in both scripts
- [ ] Update `STORAGE_DIR` variable to `storage` (note: relative to `GIT_VAULT_DIR`) in both scripts
- [ ] Ensure `MANIFEST`, `PWFILE`, and `ARCHIVE` path variables correctly resolve within the new structure in both scripts
- [ ] Test encryption and decryption with new structure

### 4) Update Git Hook Integration

Ensure that git hooks properly interact with the new folder structure.

#### 4.1) Modify Hook Installation Logic
- [ ] Update `TARGET_GIT_VAULT_DIR_REL` variable in `install.sh` to `.git-vault`
- [ ] Update `install_hook` function in `install.sh` to correctly calculate `hook_script_path` using the updated `TARGET_GIT_VAULT_DIR_REL`
- [ ] Fix relative path calculations if necessary, although using absolute paths for `hook_script_path` is preferred as currently done
- [ ] Test hook setup with new structure

#### 4.2) Ensure Hook Script References Are Updated
- [ ] Verify hook script commands written into the hook files point to the correct `.git-vault/` script paths

### 5) Update Tests

Update all tests to reflect the new folder structure while maintaining test integrity.

#### 5.1) Analyze Test Structure
- [ ] Review all test files that use path references
- [ ] Identify tests that create or verify folder structures
- [ ] Create a plan for updating test assertions

#### 5.2) Update Test Files
- [ ] Modify test_helper.bash (e.g., `install_git_vault` function) to accommodate new folder structure
- [ ] Update path assertions (`assert_file_exist`, `grep`, `run cat`, etc.) in `core.bats`, `remove.bats`, and `errors.bats` tests to use `.git-vault/` and `.git-vault/storage/` paths
- [ ] Update assertions checking hook output messages for correct paths (e.g., messages mentioning `.git-vault/storage/...` or script paths)
- [ ] Ensure test fixture paths are updated consistently if any are used
- [ ] Update any test commands that reference the scripts by the old `git-vault/` path

#### 5.3) Add New Tests for Migration Scenarios
- [ ] Add tests to verify backward compatibility where needed
- [ ] Create tests for handling existing repos during structure migration
- [ ] Test edge cases related to path changes

### 6) Update Documentation

Update all documentation to reflect the new folder structure.

#### 6.1) Update README.md
- [ ] Update installation instructions in README.md
- [ ] Modify usage examples to use new paths
- [ ] Update explanations of how the tool works with new structure
- [ ] Ensure all path references in README reflect the new structure

#### 6.2) Review and Update Other Documentation
- [ ] Check for any other documentation files with path references
- [ ] Update RELEASING.md if it contains path references
- [ ] Create migration notes for existing users

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
