#!/usr/bin/env sh
# Shared utility functions for git-vault scripts

set -eu # Exit on error, treat unset variables as error

# --- Dependency Checks (for functions needing them) ---
check_and_report_missing() {
  local cmd="$1"
  local purpose="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error (git-vault utils): '$cmd' command not found, which is needed for $purpose." >&2
    return 1
  fi
  return 0
}

# --- 1Password Helper Functions ---

# Check if 1Password CLI is available and properly signed in
# Usage: check_op_status
check_op_status() {
  # Check if op command exists
  if ! command -v op >/dev/null 2>&1; then
    echo "Error (git-vault utils): 1Password CLI 'op' not found. Install it from https://1password.com/downloads/command-line/" >&2
    return 1
  fi

  # Check if user is signed in
  if ! op whoami >/dev/null 2>&1; then
    echo "Error (git-vault utils): Not signed in to 1Password CLI. Sign in with: op signin" >&2
    return 1
  fi

  return 0
}

# Get Git-Vault vault name (reads from config file)
# Usage: get_vault_name <git-vault-dir-path>
get_vault_name() {
  local git_vault_dir="${1:-.git-vault}" # Default to .git-vault if not provided
  local vault_file="$git_vault_dir/1password-vault"

  if [ -f "$vault_file" ]; then
    cat "$vault_file"
  else
    echo "Git-Vault" # Default vault name
  fi
}

# Get project name for item naming (relative to current repo)
# Requires git command
# Usage: get_project_name
get_project_name() {
  check_and_report_missing "git" "determining project name" || return 1
  check_and_report_missing "sed" "determining project name" || return 1
  check_and_report_missing "basename" "determining project name" || return 1

  local project_name
  # Run git in the current directory (should be repo root)
  project_name=$(git remote get-url origin 2>/dev/null | sed -E 's|^.*/([^/]+)(\\.git)?$|\\1|' || true)
  if [ -z "$project_name" ]; then
    project_name=$(basename "$(git rev-parse --show-toplevel)")
  fi
  echo "$project_name"
}

# Create 1Password item for git-vault password
# Requires op command
# Usage: create_op_item <hash> <relative_path> <password> [<git-vault-dir>]
create_op_item() {
  local hash="$1"
  local path="$2"
  local password="$3"
  local git_vault_dir="${4:-.git-vault}"
  local vault_name
  local project_name
  local item_name

  check_and_report_missing "op" "creating 1Password item" || return 1

  vault_name=$(get_vault_name "$git_vault_dir")
  project_name=$(get_project_name) || return 1 # Propagate error
  item_name="git-vault-${project_name}-${hash}"

  echo "Attempting to create item '$item_name' in vault '$vault_name'..." >&2

  # Create item with password, path, and status fields
  if op item create \
    --category "Secure Note" \
    --title "$item_name" \
    --vault "$vault_name" \
    --template="" \
    "password=$password" \
    "path=$path" \
    "status=active" >/dev/null; then
      echo "Successfully created 1Password item '$item_name' in vault '$vault_name'." >&2
      return 0
  else
      echo "Error (git-vault utils): Failed to create 1Password item '$item_name' in vault '$vault_name'." >&2
      echo "       Check vault name, permissions, and network connection." >&2
      return 1
  fi
}

# Get password from 1Password
# Requires op command
# Usage: get_op_password <hash> [<git-vault-dir>]
get_op_password() {
  local hash="$1"
  local git_vault_dir="${2:-.git-vault}"
  local vault_name
  local project_name
  local item_name

  check_and_report_missing "op" "getting 1Password password" || return 1

  vault_name=$(get_vault_name "$git_vault_dir")
  project_name=$(get_project_name) || return 1
  item_name="git-vault-${project_name}-${hash}"

  # echo "Attempting to read password from 1Password item '$item_name' in vault '$vault_name'..." >&2

  # Get password field from the item
  local password
  # Use --no-newline to avoid issues with piping later
  password=$(op item get "$item_name" --vault "$vault_name" --fields password --no-newline 2>/dev/null)
  local op_exit_code=$?

  if [ $op_exit_code -ne 0 ] || [ -z "$password" ]; then
    echo "Error (git-vault utils): Failed to retrieve password from 1Password item '$item_name' in vault '$vault_name'." >&2
    echo "       Check item name, vault name, permissions, and sign-in status." >&2
    return 1
  fi

  echo "$password"
  return 0
}

# Mark item as removed in 1Password (don't actually delete)
# Requires op command
# Usage: mark_op_item_removed <hash> [<git-vault-dir>]
mark_op_item_removed() {
  local hash="$1"
  local git_vault_dir="${2:-.git-vault}"
  local vault_name
  local project_name
  local item_name

  check_and_report_missing "op" "marking 1Password item as removed" || return 1

  vault_name=$(get_vault_name "$git_vault_dir")
  project_name=$(get_project_name) || return 1
  item_name="git-vault-${project_name}-${hash}"

  echo "Attempting to mark 1Password item '$item_name' as removed in vault '$vault_name'..." >&2

  # Update the status field to "removed"
  if op item edit "$item_name" --vault "$vault_name" "status=removed" >/dev/null; then
      echo "Successfully marked 1Password item '$item_name' as removed." >&2
      return 0
  else
      echo "Error (git-vault utils): Failed to mark 1Password item '$item_name' as removed." >&2
      echo "       Check item name, vault name, permissions, and sign-in status." >&2
      return 1
  fi
}

# --- End 1Password Helper Functions ---
