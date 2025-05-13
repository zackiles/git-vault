#!/usr/bin/env bats

load 'test_helper'

# Test Case 3: Remove Path Functionality

@test "[Remove] remove.sh requires correct password" {
  install_git_vault
  local file_path="a_secret_to_remove.txt"
  local correct_password="removethis"
  local wrong_password="keepthis"

  # Create file directly since add_path is failing
  echo "content to remove" > "$file_path"

  # Run add.sh manually
  run bash -c "printf '%s\\n%s\\n' '$correct_password' '$correct_password' | bash .git-vault/add.sh '$file_path'"
  assert_success

  # Add files forcefully (because of .gitignore)
  run git add --force .
  assert_success

  run git commit -m "Add file to remove"
  assert_success

  # Verify the file was properly added
  local path_hash=$(printf "%s" "$file_path" | sha1sum | cut -c1-8)
  local pw_file=".git-vault/git-vault-${path_hash}.pw"
  local archive_name=$(echo "$file_path" | tr '/' '-')
  local archive_file=".git-vault/storage/${archive_name}.tar.gz.gpg"

  # Debug output to see if the file is properly tracked
  run cat ".git-vault/paths.list"
  echo "DEBUG: paths.list content: $output"

  # Verify prerequisite files exist
  assert_file_exist "$pw_file" "Password file must exist before test"
  assert_file_exist "$archive_file" "Archive file must exist before test"

  # Check that the entry exists in paths.list
  run grep -q "^$path_hash $file_path" ".git-vault/paths.list"
  assert_success "Path must be in manifest before testing removal"

  # Overwrite the password file with the wrong password to test verification
  echo "$wrong_password" > "$pw_file"

  # Pipe 'n' to avoid hang, though it should fail before prompt
  run bash -c "echo 'n' | bash .git-vault/remove.sh '$file_path'"
  assert_failure "Remove should fail with wrong password"
  # Check for key terms rather than exact message
  assert_output --partial "verification failed" || assert_output --partial "Password"

  # Check that files were NOT removed/renamed
  assert_file_exist "$pw_file"
  assert_file_not_exist "${pw_file%.pw}.removed"
  assert_file_exist "$archive_file"
  run grep -q "^$path_hash $file_path" ".git-vault/paths.list"
  assert_success "Manifest entry should still exist after failed removal"
}

@test "[Remove] remove.sh with correct password unmanages path" {
  # Make sure we have a clean test environment with all needed scripts
  install_git_vault

  local file_path="another_secret.dat"
  local password="S3cret789!"

  # Create the file to protect
  echo "secret data" > "$file_path"

  # Add the file with add.sh
  add_path "$file_path" "$password"
  assert_success

  # Verify the file was added properly
  assert_file_exist ".git-vault/paths.list"
  assert_file_contains ".git-vault/paths.list" "$file_path"

  # Run remove.sh with the correct password
  echo "Attempting to remove $file_path..."
  run bash -c "printf '%s\\n' \"$password\" | ./.git-vault/remove.sh \"$file_path\""

  # Output the full command output for debugging if it fails
  echo "Command output: $output"

  # Check for success
  assert_success

  # Verify output contains the key success messages
  assert_output --partial "Verifying password via local file"
  assert_output --partial "Proceeding with removal"
  assert_output --partial "Success: '$file_path' has been unmanaged from git-vault"

  # Verify the file was removed from tracking - use grep with run instead
  run grep -q "$file_path" ".git-vault/paths.list"
  assert_failure "Entry for $file_path should not exist in paths.list"
}

@test "[Remove] remove.sh keeps .gitignore entry if user answers no" {
  install_git_vault
  local file_path="config.json"
  local password="keepignored"
  add_path "$file_path" "$password"
  run git commit -am "Add config to remove"
  assert_success

  local gitignore_pattern="/$file_path"
  run grep -qxF "$gitignore_pattern" ".gitignore"
  assert_success ".gitignore should contain entry before removal"

  # Run remove.sh, respond 'n' or just enter
  run bash -c "echo 'n' | bash .git-vault/remove.sh '$file_path'"
  assert_success "remove.sh should succeed"
  assert_output --partial "Keeping '$gitignore_pattern' in .gitignore."

  # Verify .gitignore was NOT modified
  run grep -qxF "$gitignore_pattern" ".gitignore"
  assert_success ".gitignore entry should still exist"

  # Verify git status shows manifest modified, but not .gitignore
  run git status --porcelain
  assert_output --partial " M .git-vault/paths.list"
  refute_output --partial ".gitignore" # Check .gitignore is not listed as modified
}

@test "[GitIgnore] Handles .gitignore updates correctly" {
  install_git_vault

  # For debugging
  echo "DEBUG [GitIgnore]: Start of test"

  # 1. Clear .gitignore
  > .gitignore
  echo "DEBUG [GitIgnore]: .gitignore cleared"

  # 2. Add a file - should add path to .gitignore
  local file_one="item_one.txt"
  echo "test" > "$file_one"
  echo "DEBUG [GitIgnore]: Adding item_one..."
  add_path "$file_one" "password123"
  echo "DEBUG [GitIgnore]: item_one added. Output contains: $output"

  # Verify .gitignore contains item_one.txt
  run grep -q "/$file_one" .gitignore
  assert_success "/$file_one should be in .gitignore after add"
  echo "DEBUG [GitIgnore]: Checked for /$file_one in .gitignore"

  # Verify gitignore contains .git-vault/*.pw
  run grep -q ".git-vault/\*.pw" .gitignore
  assert_success ".git-vault/*.pw pattern should be in .gitignore"
  echo "DEBUG [GitIgnore]: Checked for .git-vault/*.pw in .gitignore (after 1st add)"

  # Show current .gitignore
  echo "DEBUG [GitIgnore]: .gitignore content after 1st add:"
  cat .gitignore

  # 3. Remove the file - should remove path from .gitignore
  echo "DEBUG [GitIgnore]: Removing item_one..."
  run bash -c "printf 'y\\npassword123\\n' | ./.git-vault/remove.sh \"$file_one\""
  assert_success "remove.sh should succeed"
  echo "DEBUG [GitIgnore]: item_one removed. Output contains: $output"

  # Verify item_one not in .gitignore anymore - test with run
  run grep -q "/$file_one" .gitignore
  assert_failure ".gitignore should not contain /$file_one pattern after removal"
  echo "DEBUG [GitIgnore]: Checked /$file_one not in .gitignore (after removal)"

  # Show final .gitignore content
  echo "DEBUG [GitIgnore]: .gitignore content after removal:"
  cat .gitignore
}
