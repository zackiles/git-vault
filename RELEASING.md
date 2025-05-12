# Git-Vault Release Process

This document outlines the process for creating and publishing releases of Git-Vault.

## Release Workflow

Git-Vault uses GitHub Actions to automate the release process. The workflow is triggered when a tag matching the pattern `vx.x.x` (e.g., `v1.0.0`) is pushed to the main branch.

### What the Release Workflow Does

1. **Test Phase**:
   - Runs the full test suite using bats
   - Ensures all functionality works correctly before creating a release
   - Fails the release process if any tests fail

2. **Release Phase** (if tests pass):
   - Creates a GitHub Release for the tag
   - Includes the following files in the release:
     - `add.sh`
     - `remove.sh`
     - `encrypt.sh` 
     - `decrypt.sh`
     - `install.sh`
     - `README.md`
     - `LICENSE`
   - Uses the commit message of the tagged commit as the release changelog

## How to Create a Release

1. **Make sure your code is ready**:
   - All tests should pass locally
   - All changes should be committed to the main branch
   - The main branch should be up to date with origin

2. **Create and push a version tag**:
   ```bash
   # Ensure you're on the main branch
   git checkout main
   
   # Create a version tag (replace X.Y.Z with the actual version)
   git tag -a vX.Y.Z -m "Release vX.Y.Z: <changelog details>"
   
   # Push the tag to trigger the release workflow
   git push origin vX.Y.Z
   ```

3. **Verify the release**:
   - Go to GitHub Actions tab to monitor the workflow
   - Once completed, check the Releases page to verify the release was created correctly
   - Test the installation script to ensure it works properly with the new release

## Versioning Guidelines

Git-Vault follows semantic versioning (SemVer):

- **MAJOR version (X)**: Incompatible API changes
- **MINOR version (Y)**: Add functionality in a backward-compatible manner
- **PATCH version (Z)**: Backward-compatible bug fixes

## Release Dependencies

The release workflow requires several dependencies to run the tests:

- **Git**: Used for repository operations and properly configured in the GitHub Action
- **GPG (GnuPG)**: Required for encryption/decryption operations
- **tar**: Used for creating and extracting archives
- **coreutils**: Provides `sha1sum` and `mktemp` utilities
- **sed**: Used for text manipulation in scripts
- **bats-core**: Testing framework used to run the test suite
- **bats helper libraries**: Already included in the repository under `test/test_helper/`

All these dependencies are automatically installed in the GitHub Actions runner as part of the workflow. 