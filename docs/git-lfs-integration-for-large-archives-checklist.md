# Implementation Checklist: Git LFS Integration for Large Archives

**Date:** <!-- Will be filled in by user -->

## Summary

Integrate Git LFS to automatically manage large encrypted archives in git-vault, preventing repository bloat and supporting efficient versioning of binary large objects. The implementation will update `install.sh` and `add.sh` to detect and configure LFS, add error handling and messaging, and update documentation and tests to ensure seamless, cross-platform support.

---

## Phases and Steps

### 1) Requirements Analysis and Design
Review requirements, user stories, and current code to define the scope and design for Git LFS integration.

#### 1.1) Review Documentation and RFCs
- [ ] Read `README.md`, `docs/rfc-git-vault.md`, and `docs/prd-git-vault.md` for LFS requirements
- [ ] Review `TODO.md` for explicit objectives and acceptance criteria
- [ ] Identify all scripts and files affected by LFS integration

#### 1.2) Analyze Current Code
- [ ] Review `install.sh` for installation and setup logic
- [ ] Review `add.sh` for archive creation and staging logic
- [ ] Review `.gitattributes` handling in the repo
- [ ] Review error handling and messaging patterns in scripts

#### 1.3) Define LFS Integration Design
- [ ] Specify how to detect and configure Git LFS in `install.sh`
- [ ] Specify how to check archive size and configure LFS in `add.sh`
- [ ] Define error handling for missing LFS or setup failures
- [ ] Plan debug/status messaging for LFS actions
- [ ] Plan documentation and test updates

---

### 2) Update install.sh for LFS Setup
Implement LFS detection and configuration in the installation script.

#### 2.1) Detect Git LFS
- [ ] Add logic to check for `git-lfs` availability
- [ ] Add logic to initialize LFS if not already set up

#### 2.2) Configure LFS Tracking
- [ ] Add or update `.gitattributes` to track `storage/*.tar.gz.gpg`
- [ ] Add support for `--min-lfs=<size>` flag (default 5MB)
- [ ] Store LFS threshold in a config file for use by other scripts

#### 2.3) Error Handling and Messaging
- [ ] Add error handling for missing LFS or setup failures
- [ ] Add debug/status messages for LFS setup steps

#### 2.4) Stage and Commit Changes
- [ ] Stage `.gitattributes` and config changes for commit

---

### 3) Update add.sh for Per-Archive LFS Tracking
Implement logic to check archive size and configure LFS for large files.

#### 3.1) Check Archive Size After Encryption
- [ ] After archive creation, check its size against the LFS threshold

#### 3.2) Configure LFS for Large Archives
- [ ] If archive exceeds threshold and LFS is available, add LFS tracking for that file
- [ ] Update `.gitattributes` if needed
- [ ] Add debug/status messages when LFS is used

#### 3.3) Error Handling
- [ ] Handle cases where LFS is not available or setup fails
- [ ] Ensure fallback to normal git tracking if LFS is unavailable

#### 3.4) Stage and Commit Changes
- [ ] Stage updated `.gitattributes` and archive for commit

---

### 4) Documentation and User Guidance
Update documentation to reflect LFS integration and usage.

#### 4.1) Update User-Facing Docs
- [ ] Update `README.md` to describe LFS integration, requirements, and usage
- [ ] Add section on binary large object support and LFS threshold configuration
- [ ] Document error messages and troubleshooting for LFS

#### 4.2) Update Developer Docs
- [ ] Update `docs/rfc-git-vault.md` and `docs/prd-git-vault.md` with LFS design and rationale

---

### 5) Testing and Validation
Add and update tests to verify LFS integration across platforms.

#### 5.1) Add/Update Bats Tests
- [ ] Add tests in `test/core.bats` for LFS setup during install
- [ ] Add tests in `test/core.bats` for LFS tracking of large archives in `add.sh`
- [ ] Add tests for error handling when LFS is missing or setup fails
- [ ] Add tests for correct `.gitattributes` updates

#### 5.2) Cross-Platform Validation
- [ ] Test on Linux, macOS, and Windows (Git Bash/WSL)
- [ ] Validate handling of binary large objects (images, videos, datasets)

#### 5.3) Manual Verification
- [ ] Manually verify LFS integration in a sample repo
- [ ] Confirm seamless user experience and correct messaging

---

### 6) Final Review and Release
Review, document, and release the changes.

#### 6.1) Code Review
- [ ] Review all code and documentation changes
- [ ] Ensure all acceptance criteria from `TODO.md` are met

#### 6.2) Update Release Notes
- [ ] Update `RELEASING.md` with LFS integration details

#### 6.3) Merge and Tag Release
- [ ] Merge changes to main branch
- [ ] Tag and release new version

---

## Appendix

### Pseudocode: LFS Setup in install.sh
```sh
if command -v git-lfs >/dev/null 2>&1; then
  git lfs install
  touch .gitattributes
  if ! grep -q 'storage/*.tar.gz.gpg' .gitattributes; then
    echo 'storage/*.tar.gz.gpg filter=lfs diff=lfs merge=lfs -text' >> .gitattributes
    git add .gitattributes
  fi
fi
```

### Pseudocode: LFS Tracking in add.sh
```sh
ARCHIVE_SIZE=$(du -m "$ARCHIVE_FILE" | cut -f1)
MIN_LFS=$(cat .git-vault/lfs-config)
if [ "$ARCHIVE_SIZE" -ge "$MIN_LFS" ] && command -v git-lfs >/dev/null 2>&1; then
  # Add LFS tracking for this archive
  if ! grep -q "$ARCHIVE_FILE" .gitattributes; then
    echo "$ARCHIVE_FILE filter=lfs diff=lfs merge=lfs -text" >> .gitattributes
    git add .gitattributes
  fi
fi
```

### References
- `README.md`, `docs/rfc-git-vault.md`, `docs/prd-git-vault.md`
- `install.sh`, `add.sh`, `.gitattributes`
- `test/core.bats`, `test/README.md`

---

## Summary and Instructions

This checklist guides you through integrating Git LFS for large encrypted archives in git-vault. Complete each phase in order, marking steps as complete as you go. After each phase, run the test suite to validate your changes before proceeding. You may choose to write tests for new features either after each phase or at the end, depending on what makes the most sense for your workflow. Ensure all acceptance criteria are met and documentation is updated before releasing. 
