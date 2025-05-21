# Package Manager Integration for Git Vault

This document describes how Git Vault is distributed through package managers like Homebrew and Chocolatey.

## Overview

Git Vault is available through:

1. **Homebrew** - For macOS and Linux users (both x86_64 and ARM64)
2. **Chocolatey** - For Windows users (x86_64)

These package managers are automatically updated when new releases are published via GitHub Actions workflows.

## Installation Instructions

### Homebrew (macOS and Linux)

```bash
# Install via Homebrew
brew tap zackiles/homebrew-git-vault
brew install git-vault
```

### Chocolatey (Windows)

```powershell
# Install via Chocolatey
choco install git-vault
```

## How It Works

### Automated Release Process

When a new version is tagged and released:

1. The main release workflow (`release.yml`) builds binaries for all supported platforms:
   - Linux (x86_64, ARM64)
   - macOS (x86_64, ARM64)
   - Windows (x86_64)

2. The Homebrew workflow (`update-homebrew-tap.yml`) is triggered by the release event:
   - Creates tar.gz archives suitable for Homebrew
   - Computes SHA256 hashes
   - Updates the formula in the tap repository with platform-specific binaries
   - Pushes the changes using the default GITHUB_TOKEN
   - No additional tokens needed as the tap is in the same GitHub account

3. The Chocolatey workflow (`update-chocolatey.yml`) is triggered by the release event:
   - Packages Windows binaries according to Chocolatey standards
   - Publishes the package to Chocolatey.org

## Required Secrets

The following secret needs to be configured in the GitHub repository:

1. `CHOCO_API_KEY` - An API key for Chocolatey.org to publish packages

> **Note:** If the Chocolatey API key is not available, only that workflow will be skipped without affecting the main release process or Homebrew updates. You can see a warning message in the GitHub Actions logs.

## Troubleshooting

### Homebrew Formula Issues

If the Homebrew formula fails to update:

1. Check logs in the `update-homebrew-tap` workflow
2. Verify that the release workflow completed successfully
3. Ensure the tap repository exists at `zackiles/homebrew-git-vault`
4. Check that the release assets were uploaded correctly

### Chocolatey Package Issues

If the Chocolatey package fails to publish:

1. Check logs in the `update-chocolatey` workflow
2. Verify that the `CHOCO_API_KEY` is valid
3. Try submitting the package manually through the Chocolatey website
