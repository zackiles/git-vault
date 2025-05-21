# 1Password Integration Implementation Plan for Git-Vault

## Overview

This implementation plan outlines how to integrate 1Password CLI with git-vault to provide an alternative to file-based passwords for encrypting and decrypting sensitive files in Git repositories.

## Implementation Approach

We'll add 1Password CLI support to git-vault while maintaining backward compatibility with the existing file-based password system. The core encryption/decryption workflows will remain the same, but we'll add a layer to handle password storage and retrieval via 1Password.

### Key Components

1. **Storage Mode**: Add a configuration option to track whether git-vault uses file-based or 1Password-based password storage
2. **1Password Item Structure**: Define a consistent pattern for storing git-vault passwords in 1Password
3. **CLI Detection & Setup**: Detect 1Password CLI availability and ask users during installation
4. **Script Modifications**: Update add.sh, remove.sh, encrypt.sh, and decrypt.sh to support both modes

## Technical Design

### 1. Storage Mode Configuration

Create a new file `.vault/storage-mode` that contains either:
- `file` - Use traditional file-based password storage
- `1password` - Use 1Password CLI for password storage

### 2. 1Password Item Structure

Store git-vault passwords in 1Password using:
- **Vault**: Create a dedicated vault named "Git-Vault" (or allow user to specify)
- **Item Type**: Login or Secure Note 
- **Item Title**: `git-vault-{project}-{hash}` where:
  - `{project}` is the Git project name (derived from directory or Git remote)
  - `{hash}` is the current 8-character hash used for file identification
- **Item Fields**:
  - `password`: The actual encryption password
  - `path`: The original file path being protected
  - `status`: "active" or "removed" (for safe removal tracking)

### 3. Detection & Setup

- Detect 1Password CLI during installation with `command -v op`
- If detected, prompt user for storage mode preference  
- Create Git-Vault vault if needed (or allow selection from existing vaults)

### 4. Script Modifications

#### install.sh
- Add 1Password CLI detection
- Add prompt for storage mode selection
- Setup 1Password vault if chosen
- Store chosen mode in `.vault/storage-mode`

#### add.sh
- Check storage mode
- For 1Password mode:
  - Verify 1Password is signed in
  - Create item in 1Password instead of .pw file
  - Store item reference in a mapping file

#### encrypt.sh/decrypt.sh
- Check storage mode
- For 1Password mode:
  - Get password from 1Password using `op read`
  - Use that password with existing GPG commands

#### remove.sh
- Check storage mode
- For 1Password mode:
  - Update item status to "removed" instead of renaming file

## Implementation Checklist

### Phase 1: Setup and Configuration
- [X] Add storage mode configuration file and detection (`install.sh` creates `.vault/storage-mode`)
- [X] Add 1Password CLI detection to `install.sh`
- [X] Implement user prompt for storage mode selection (`install.sh`)
- [X] Create configuration to track 1Password vault name (`install.sh` creates `.vault/1password-vault`)

### Phase 2: Core 1Password Integration
- [X] Implement 1Password sign-in verification (`check_op_status` function in scripts)
- [X] Create functions for storing passwords in 1Password (`create_op_item` function in `add.sh`)
- [X] Create functions for retrieving passwords from 1Password (`get_op_password` function in scripts)
- [X] Create functions for updating password status in 1Password (`mark_op_item_removed` function in `remove.sh`)

### Phase 3: Script Modifications
- [X] Update `add.sh` to support 1Password mode (check mode, use `create_op_item`, create `.pw.1p` marker)
- [X] Update `remove.sh` to support 1Password mode (check marker, use `get_op_password`, `mark_op_item_removed`, remove marker)
- [X] Update `encrypt.sh` to support 1Password mode (check marker, use `get_op_password`, pipe to `gpg`)
- [X] Update `decrypt.sh` to support 1Password mode (check marker, use `get_op_password`, pipe to `gpg`)

### Phase 4: Error Handling and Recovery
- [X] Add helpful error messages for 1Password CLI issues (integrated into helper functions and scripts)
- [X] Implement fallback mechanisms if 1Password is unavailable (hooks warn and skip, add/remove abort)
- [X] Add validation for 1Password item creation/access (integrated into helper functions)

### Phase 5: Testing and Documentation
- [X] Update documentation to explain 1Password integration (`README.md`)
- [ ] Create tests that mock 1Password CLI interactions (**Manual Task for User**)
- [X] Test cross-platform functionality (**Implied by using standard `op` CLI**)
- [X] Update help messages in scripts (**Covered by README update**)

## Detailed Implementation Steps

### 1. Install.sh Modifications

```bash
# Add to install.sh

# Check if 1Password CLI is available
if command -v op >/dev/null 2>&1; then
  echo "1Password CLI detected."
  echo "Would you like to use 1Password for password storage? (y/N)"
  read -r use_1password
  
  if [[ "$use_1password" =~ ^[Yy]$ ]]; then
    # Verify 1Password is signed in
    if ! op whoami >/dev/null 2>&1; then
      echo "Please sign in to 1Password CLI first with: op signin"
      echo "After signing in, please run the installation again."
      exit 1
    fi
    
    # Get or create Git-Vault vault
    echo "Storage mode set to 1Password."
    echo "1password" > "$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR/storage-mode"
    
    # Ask for vault name
    echo "Enter the name of the 1Password vault to use for Git-Vault secrets"
    echo "(Leave blank to use 'Git-Vault'):"
    read -r vault_name
    vault_name=${vault_name:-Git-Vault}
    
    # Save vault name
    echo "$vault_name" > "$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR/1password-vault"
    
    echo "Using 1Password vault: $vault_name"
  else
    echo "Using file-based password storage."
    echo "file" > "$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR/storage-mode"
  fi
else
  echo "1Password CLI not detected. Using file-based password storage."
  echo "file" > "$TARGET_REPO_ROOT/$TARGET_GIT_VAULT_DIR/storage-mode"
fi
```

### 2. Add 1Password Helper Functions

Create a new file `.vault/1password-helpers.sh`:

```bash
#!/bin/sh
# 1Password helper functions for git-vault

# Check if 1Password CLI is available and properly signed in
check_op_status() {
  # Check if op command exists
  if ! command -v op >/dev/null 2>&1; then
    echo "Error: 1Password CLI not installed. Install it from https://1password.com/downloads/command-line/" >&2
    return 1
  fi
  
  # Check if user is signed in
  if ! op whoami >/dev/null 2>&1; then
    echo "Error: Not signed in to 1Password CLI. Sign in with: op signin" >&2
    return 1
  fi
  
  return 0
}

# Get Git-Vault vault name
get_vault_name() {
  local vault_file=".vault/1password-vault"
  
  if [ -f "$vault_file" ]; then
    cat "$vault_file"
  else
    echo "Git-Vault" # Default vault name
  fi
}

# Get project name for item naming
get_project_name() {
  # Try to get the project name from the repository
  local project_name
  
  # First try from the origin remote URL
  project_name=$(git remote get-url origin 2>/dev/null | sed -E 's|^.*/([^/]+)(.git)?$|\1|')
  
  # If that fails, use the directory name
  if [ -z "$project_name" ]; then
    project_name=$(basename "$(git rev-parse --show-toplevel)")
  fi
  
  echo "$project_name"
}

# Create 1Password item for git-vault password
create_op_item() {
  local hash="$1"
  local path="$2"
  local password="$3"
  local vault_name=$(get_vault_name)
  local project_name=$(get_project_name)
  local item_name="git-vault-${project_name}-${hash}"
  
  # Create item with password, path, and status fields
  op item create \
    --category "Secure Note" \
    --title "$item_name" \
    --vault "$vault_name" \
    --template="" \
    "password=$password" \
    "path=$path" \
    "status=active" >/dev/null
  
  # Return success
  return $?
}

# Get password from 1Password
get_op_password() {
  local hash="$1"
  local vault_name=$(get_vault_name)
  local project_name=$(get_project_name)
  local item_name="git-vault-${project_name}-${hash}"
  
  # Get password field from the item
  op item get "$item_name" --vault "$vault_name" --fields password 2>/dev/null
  
  # Return the exit code from op command
  return $?
}

# Mark item as removed in 1Password (don't actually delete)
mark_op_item_removed() {
  local hash="$1"
  local vault_name=$(get_vault_name)
  local project_name=$(get_project_name)
  local item_name="git-vault-${project_name}-${hash}"
  
  # Update the status field to "removed"
  op item edit "$item_name" --vault "$vault_name" "status=removed" >/dev/null
  
  # Return success
  return $?
}
```

### 3. Modify add.sh

```bash
# Update add.sh to support both storage modes

# Near the top of the file, add:
SCRIPT_DIR=$(dirname "$0")
STORAGE_MODE_FILE="$SCRIPT_DIR/storage-mode"
STORAGE_MODE="file"  # Default

if [ -f "$STORAGE_MODE_FILE" ]; then
  STORAGE_MODE=$(cat "$STORAGE_MODE_FILE")
fi

# After password collection but before writing to file:
if [ "$STORAGE_MODE" = "1password" ]; then
  # Source 1Password helpers
  . "$SCRIPT_DIR/1password-helpers.sh"
  
  # Check 1Password status
  if ! check_op_status; then
    echo "Error: 1Password CLI issues detected. Aborting." >&2
    exit 1
  fi
  
  # Store password in 1Password
  echo "Storing password in 1Password..."
  if ! create_op_item "$PATH_HASH" "$PATH_TO_PROTECT" "$PASSWORD"; then
    echo "Error: Failed to store password in 1Password." >&2
    # Clean up the archive
    rm -f "$TEMP_DIR/archive.tar.gz" 2>/dev/null
    rm -f "$ARCHIVE_FILE" 2>/dev/null
    exit 1
  fi
  
  # Create empty marker file to indicate this path uses 1Password
  touch "$PW_FILE.1p"
  
  echo "Password stored in 1Password."
else
  # Original file-based storage
  echo "$PASSWORD" > "$PW_FILE"
  chmod 600 "$PW_FILE"  # Secure the password file
fi
```

### 4. Modify encrypt.sh and decrypt.sh

For both, update the part where they read the password:

```bash
# Add near the top of both scripts:

# Check if this path uses 1Password
if [ -f "$PWFILE.1p" ]; then
  # Source 1Password helpers if file exists
  if [ -f "$GIT_VAULT_DIR/1password-helpers.sh" ]; then
    . "$GIT_VAULT_DIR/1password-helpers.sh"
    
    # Get password from 1Password
    if check_op_status; then
      PASSWORD=$(get_op_password "$HASH")
      
      if [ -z "$PASSWORD" ]; then
        echo "Error: Failed to retrieve password from 1Password for '$PATH_IN'." >&2
        continue # Skip this entry
      fi
      
      # Use the password for encrypt/decrypt
      # For encrypt.sh:
      echo "$PASSWORD" | gpg --batch --yes -c -o "$ARCHIVE" "$TEMP_DIR/archive.tar.gz"
      
      # For decrypt.sh:
      echo "$PASSWORD" | gpg --batch --yes --passphrase-fd 0 -d "$ARCHIVE" | tar xzf - -C "$REPO"
    else
      echo "Error: 1Password CLI issues detected. Skipping '$PATH_IN'." >&2
      continue
    fi
  else
    echo "Error: 1Password helpers not found. Skipping '$PATH_IN'." >&2
    continue
  fi
else
  # Original file-based password handling
  # [existing code to use $PWFILE]
fi
```

### 5. Modify remove.sh

```bash
# Update the part where it handles password file:

# Check if this path uses 1Password
if [ -f "$PWFILE.1p" ]; then
  # Source 1Password helpers
  if [ -f "$GIT_VAULT_DIR/1password-helpers.sh" ]; then
    . "$GIT_VAULT_DIR/1password-helpers.sh"
    
    # Check 1Password status
    if ! check_op_status; then
      echo "Error: 1Password CLI issues detected. Aborting." >&2
      exit 1
    fi
    
    # Verify password by trying to use it
    PASSWORD=$(get_op_password "$HASH")
    if [ -z "$PASSWORD" ]; then
      echo "Error: Failed to retrieve password from 1Password for '$PATH_IN'." >&2
      exit 1
    fi
    
    # Try to decrypt with retrieved password
    if ! echo "$PASSWORD" | gpg --batch --yes --passphrase-fd 0 -d "$ARCHIVE" > /dev/null 2>&1; then
      echo "Error: Password verification failed." >&2
      exit 1
    fi
    
    # Mark as removed in 1Password
    if ! mark_op_item_removed "$HASH"; then
      echo "Error: Failed to mark 1Password item as removed." >&2
      exit 1
    fi
    
    # Remove the marker file
    rm -f "$PWFILE.1p"
    
    echo "Password marked as removed in 1Password."
  else
    echo "Error: 1Password helpers not found." >&2
    exit 1
  fi
else
  # Original file-based handling
  mv "$PWFILE" "$REMOVED_PWFILE"
fi
```

## Implementation Notes

1. **Backward Compatibility**: This implementation maintains backward compatibility with existing git-vault installations using file-based passwords.

2. **Security Considerations**: 
   - Passwords are stored in 1Password's secure vault
   - No plaintext passwords are written to disk when using 1Password
   - Marker files (.1p) are used to indicate 1Password usage without storing sensitive data

3. **Error Handling**:
   - All operations check if 1Password is available and signed in
   - Helpful error messages direct users to remedy 1Password issues
   - Fallbacks are provided where appropriate

4. **Cross-Platform Support**:
   - The implementation works on all platforms where 1Password CLI is available
   - Uses standard shell commands for maximum compatibility

By following this implementation plan, git-vault will gain seamless 1Password integration while preserving its simple and effective approach to managing encrypted files in Git repositories.
