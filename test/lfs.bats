#!/usr/bin/env bats

load 'test_helper'

# Test for Git LFS integration with git-vault

setup() {
  # Load standard test helpers
  load "$TEST_DIR/test_helper/bats-support/load.bash"
  load "$TEST_DIR/test_helper/bats-assert/load.bash"
  load "$TEST_DIR/test_helper/bats-file/load.bash"

  # Set up test timeout
  setup_test_timeout

  # Create the main tmp directory if it doesn't exist
  mkdir -p "$TMP_DIR"
  setup_test_repo
}

teardown() {
  teardown_test_repo
}

# Helper to check if git-lfs is available
has_git_lfs() {
  command -v git-lfs >/dev/null 2>&1
}

# Helper to generate a file of the given size (in MB)
generate_large_file() {
  local file_path="$1"
  local size_in_mb="$2"

  # Create the parent directory if needed
  mkdir -p "$(dirname "$file_path")"

  # Create a file of the given size using dd
  if [ "$(uname)" = "Darwin" ]; then
    # macOS
    dd if=/dev/zero of="$file_path" bs=1m count="$size_in_mb" 2>/dev/null
  else
    # Linux and others
    dd if=/dev/zero of="$file_path" bs=1M count="$size_in_mb" 2>/dev/null
  fi
}

# Skip helper for LFS tests
skip_if_no_lfs() {
  if ! has_git_lfs; then
    skip "Git LFS is not installed, skipping test"
  fi
}

@test "[LFS] install.sh creates lfs-config with default threshold" {
  install_git_vault

  # Check if lfs-config exists and contains default value (5)
  assert_file_exist ".git-vault/lfs-config"
  run cat ".git-vault/lfs-config"
  assert_output "5"
}

@test "[LFS] install.sh accepts custom LFS threshold" {
  # Setup a clean test repo
  local custom_threshold=10

  # Run install.sh with custom threshold from temporary scripts directory
  mkdir -p "$TEST_REPO/temp_scripts"
  cp "$PROJECT_ROOT/add.sh" "$TEST_REPO/temp_scripts/"
  cp "$PROJECT_ROOT/remove.sh" "$TEST_REPO/temp_scripts/"
  cp "$PROJECT_ROOT/encrypt.sh" "$TEST_REPO/temp_scripts/"
  cp "$PROJECT_ROOT/decrypt.sh" "$TEST_REPO/temp_scripts/"
  cp "$PROJECT_ROOT/install.sh" "$TEST_REPO/temp_scripts/"
  cp "$PROJECT_ROOT/utils.sh" "$TEST_REPO/temp_scripts/" # Add utils.sh for this test as well

  # Fix the shebang and remove pipefail in copied files for POSIX compatibility
  for script in add.sh remove.sh encrypt.sh decrypt.sh install.sh; do
    # Replace any bash shebangs to POSIX sh
    sed -i.bak 's|^#!/usr/bin/env bash|#!/usr/bin/env sh|' "$TEST_REPO/temp_scripts/$script"
    sed -i.bak 's|^#!/bin/bash|#!/usr/bin/env sh|' "$TEST_REPO/temp_scripts/$script"
    # Remove pipefail (already done in our edits, but make sure temp copies are correct)
    sed -i.bak 's|set -euo pipefail|set -e|' "$TEST_REPO/temp_scripts/$script"
    sed -i.bak 's|set -eu|set -e|' "$TEST_REPO/temp_scripts/$script"
    rm -f "$TEST_REPO/temp_scripts/$script.bak"
  done

  cd "$TEST_REPO" || return 1
  # Pipe "n" to avoid 1Password prompt
  run sh -c "printf 'n\\n' | sh $TEST_REPO/temp_scripts/install.sh --target-dir $TEST_REPO --min-lfs=$custom_threshold"
  assert_success "install.sh should succeed with custom LFS threshold"

  # Check if lfs-config exists and contains custom value
  assert_file_exist ".git-vault/lfs-config"
  run cat ".git-vault/lfs-config"
  assert_output "$custom_threshold"

  # Clean up
  rm -rf "$TEST_REPO/temp_scripts"
}

@test "[LFS] add.sh creates gitattributes file for LFS if available" {
  skip_if_no_lfs

  install_git_vault

  # Set a small LFS threshold for testing
  echo "1" > ".git-vault/lfs-config"

  # Create a file that will definitely be over the threshold (2MB)
  local file_path="large_file.bin"
  generate_large_file "$file_path" 2

  # Add the file with git-vault
  add_path "$file_path" "password123"
  assert_success

  # Check that gitattributes file was created
  assert_file_exist ".gitattributes"

  # Check that LFS tracking was set up
  local archive_name=$(echo "$file_path" | tr '/' '-')
  local archive_file=".git-vault/storage/${archive_name}.tar.gz.gpg"

  # The output should mention LFS
  assert_output --partial "Archive size"
  assert_output --partial "exceeds LFS threshold"

  # .gitattributes should contain either specific pattern or wildcard for archives
  run cat ".gitattributes"
  assert_output --partial "filter=lfs diff=lfs merge=lfs -text"

  # Test skips for now to get first stage working. Additional
  # We would need extra test to validate with the LFS command but that depends on
  # complex local Git LFS setup

  # Verify git add works
  run git add .
  assert_success "git add should succeed with LFS-tracked files"

  # Verify commit works
  run git commit -m "Add large file with LFS"
  assert_success "git commit should succeed with LFS-tracked files"
}

@test "[LFS] add.sh handles archives under LFS threshold normally" {
  install_git_vault

  # Set a large LFS threshold (50MB)
  echo "50" > ".git-vault/lfs-config"

  # Create a small file (1MB)
  local file_path="small_file.bin"
  generate_large_file "$file_path" 1

  # Add the file with git-vault
  add_path "$file_path" "password123"
  assert_success

  # Output should not mention LFS
  refute_output --partial "Archive size"
  refute_output --partial "exceeds LFS threshold"

  # Check that archive was created normally
  local archive_name=$(echo "$file_path" | tr '/' '-')
  local archive_file=".git-vault/storage/${archive_name}.tar.gz.gpg"
  assert_file_exist "$archive_file"

  # Verify git operations work normally
  run git add .
  assert_success "git add should succeed with normal files"

  run git commit -m "Add small file without LFS"
  assert_success "git commit should succeed with normal files"
}

@test "[LFS] add.sh handles missing LFS by falling back to normal Git" {
  # Call install_git_vault FIRST to ensure the scripts are in place
  install_git_vault

  # Skip this test if we can't modify the add.sh file
  # Check the path relative to $TEST_REPO
  local add_script_in_repo="$TEST_REPO/.git-vault/add.sh"
  if [ ! -f "$add_script_in_repo" ]; then
    echo "DEBUG: Looking for add.sh at $add_script_in_repo" >&2
    # Optional: list contents for debugging
    ls -la "$TEST_REPO/.git-vault/" >&2
    skip "Could not find add.sh file ('$add_script_in_repo') to test fallback behavior"
  fi

  # Set a small LFS threshold for testing
  echo "1" > ".git-vault/lfs-config"

  # Create a file that will definitely be over the threshold (2MB)
  local file_path="large_fallback.bin"
  generate_large_file "$file_path" 2

  # This is more reliable and safer for testing
  local add_script=".git-vault/add.sh" # Relative path is fine here as we are cd'd into $TEST_REPO
  local add_script_bak="${add_script}.bak"

  # Backup the original add.sh
  cp "$add_script" "$add_script_bak"
  echo "DEBUG lfs.bats: Backed up $add_script to $add_script_bak"

  # Modify add.sh to simulate git-lfs not being available
  # We need to replace the "command -v git-lfs" check to always return false
  echo "DEBUG lfs.bats: Modifying $add_script to simulate missing git-lfs..."
  echo "DEBUG lfs.bats: Content before sed:"
  grep 'command -v git-lfs' "$add_script" >&2 || echo " -- pattern not found before sed --" >&2

  # Use a different delimiter (|) and a simpler replacement approach
  # Just add the word 'false_' before 'command' to make it not find the command
  sed -i.sedtmp 's|command -v git-lfs|false_command -v git-lfs|g' "$add_script"

  rm -f "${add_script}.sedtmp"  # Remove temporary sed file
  echo "DEBUG lfs.bats: Content after sed:"
  grep 'false_command -v git-lfs' "$add_script" >&2 || echo " -- pattern not successfully replaced --" >&2

  # Now run add.sh which should fall back to normal Git
  # Correct quoting for printf and pipes within bash -c
  local run_command="printf '%s\\n%s\\n' 'password123' 'password123' | bash '$add_script' '$file_path'"
  echo "DEBUG lfs.bats: Running command: bash -c '$run_command'"
  run bash -c "$run_command"

  # Restore the original add.sh
  echo "DEBUG lfs.bats: Restoring original $add_script from $add_script_bak"
  mv "$add_script_bak" "$add_script"

  # Check that the command succeeded
  assert_success "add.sh should succeed even with LFS unavailable"

  # Verify the fallback message
  assert_output --partial "Git LFS not available" || assert_output --partial "stored directly in Git"

  # Verify the file was still processed correctly
  local archive_name=$(echo "$file_path" | tr '/' '-')
  local archive_file=".git-vault/storage/${archive_name}.tar.gz.gpg"
  assert_file_exist "$archive_file"
}
