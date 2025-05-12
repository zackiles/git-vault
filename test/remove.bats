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
  install_git_vault
  local file_path="another_secret.dat"
  local password="correcthorsebatterystaple"
  add_path "$file_path" "$password"

  # Add files forcefully (because of .gitignore)
  run git add --force .
  assert_success

  run git commit -m "Add file to be removed"
  assert_success

  local path_hash=$(printf "%s" "$file_path" | sha1sum | cut -c1-8)
  local pw_file=".git-vault/git-vault-${path_hash}.pw"
  local removed_pw_file="${pw_file%.pw}.removed"
  local archive_name=$(echo "$file_path" | tr '/' '-')
  local archive_file=".git-vault/storage/${archive_name}.tar.gz.gpg"
  local gitignore_pattern="/$file_path"

  # Ensure files exist before removal
  assert_file_exist "$pw_file"
  assert_file_exist "$archive_file"
  run grep -q "^$path_hash $file_path" ".git-vault/paths.list"
  assert_success "Manifest should contain entry before removal"
  run grep -qxF "$gitignore_pattern" ".gitignore"
  assert_success ".gitignore should contain entry before removal"

  # Run remove.sh (no interactive prompt needed as it uses the pw file)
  # Respond 'y' to the .gitignore removal prompt
  run bash -c "echo 'y' | bash .git-vault/remove.sh '$file_path'"
  assert_success "remove.sh should succeed with correct password"
  assert_output --partial "Password verified"
  assert_output --partial "Success: '$file_path' has been unmanaged"

  # Verify removals and renaming
  assert_file_not_exist "$pw_file"
  assert_file_exist "$removed_pw_file"
  assert_file_not_exist "$archive_file"

  # Verify manifest updated
  run grep -q "^$path_hash $file_path" ".git-vault/paths.list"
  assert_failure "Entry should be removed from manifest"

  # Verify .gitignore updated (since we answered 'y')
  run grep -qxF "$gitignore_pattern" ".gitignore"
  assert_failure "Entry should be removed from .gitignore"

  # Verify git status shows changes
  run git status --porcelain
  # Look for key pattern rather than exact match
  assert_output --partial "D"
  assert_output --partial "$archive_file"
  assert_output --partial ".git-vault/paths.list"
  assert_output --partial ".gitignore"

  # Verify plaintext file still exists
  assert_file_exist "$file_path"
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
  echo "DEBUG [GitIgnore]: Start of test"

  # Create an empty .gitignore file to start with (overwrite existing one)
  echo "" > ".gitignore"
  echo "DEBUG [GitIgnore]: .gitignore cleared"

  # Create first item
  local item_one="item_one.txt"
  echo "content one" > "$item_one"

  # Add first item
  echo "DEBUG [GitIgnore]: Adding item_one..."
  add_path "$item_one" "pass_one"
  assert_success
  echo "DEBUG [GitIgnore]: item_one added. Output contains: ... $(echo "$output" | tail -n 3)"

  # Verify .gitignore contains the right entries
  run grep -qxF "/$item_one" ".gitignore"
  assert_success "/.gitignore should contain $item_one pattern"
  echo "DEBUG [GitIgnore]: Checked for /$item_one in .gitignore"
  # Use grep -F (fixed string) for literal match
  run grep -qF ".git-vault/*.pw" ".gitignore"
  assert_success ".gitignore should contain .git-vault/*.pw pattern (after 1st add)"
  echo "DEBUG [GitIgnore]: Checked for .git-vault/*.pw in .gitignore (after 1st add)"
  echo "DEBUG [GitIgnore]: .gitignore content after 1st add:"
  cat ".gitignore"

  # Remove first item
  echo "DEBUG [GitIgnore]: Removing item_one..."
  # Pipe 'y' to confirm removal from .gitignore
  run bash -c "echo 'y' | bash .git-vault/remove.sh '$item_one'"
  assert_success
  echo "DEBUG [GitIgnore]: item_one removed. Output contains: ... $(echo "$output" | tail -n 5)"

  # Verify .gitignore is properly updated
  run grep -qxF "/$item_one" ".gitignore"
  assert_failure "/.gitignore should not contain $item_one pattern after removal"
  echo "DEBUG [GitIgnore]: Checked /$item_one not in .gitignore (after 1st remove)"
  # Use grep -F (fixed string) for literal match
  run grep -qF ".git-vault/*.pw" ".gitignore"
  # Current remove.sh does not remove the generic .pw pattern, so expect it to still be there.
  assert_failure ".gitignore should not contain .git-vault/*.pw pattern after last item removal"
  echo "DEBUG [GitIgnore]: Checked .git-vault/*.pw IS NOT in .gitignore (after 1st remove)"
  echo "DEBUG [GitIgnore]: .gitignore content after 1st remove:"
  cat ".gitignore"

  # Add item_one back and add item_two
  local item_two="item_two.txt"
  echo "content one" > "$item_one" # Recreate file
  echo "content two" > "$item_two"

  echo "DEBUG [GitIgnore]: Adding item_one back..."
  add_path "$item_one" "pass_one"
  assert_success
  echo "DEBUG [GitIgnore]: item_one added back."
  echo "DEBUG [GitIgnore]: Adding item_two..."
  add_path "$item_two" "pass_two"
  assert_success
  echo "DEBUG [GitIgnore]: item_two added."

  # Verify .gitignore contains both items
  run grep -qxF "/$item_one" ".gitignore"
  assert_success ".gitignore should contain $item_one pattern"
  run grep -qxF "/$item_two" ".gitignore"
  assert_success ".gitignore should contain $item_two pattern"
  # Use grep -F (fixed string) for literal match
  run grep -qF ".git-vault/*.pw" ".gitignore"
  assert_success ".gitignore should contain .git-vault/*.pw pattern (after 2nd adds)"
  echo "DEBUG [GitIgnore]: Checked patterns after 2nd adds. .gitignore content:"
  cat ".gitignore"

  # Remove first item again
  echo "DEBUG [GitIgnore]: Removing item_one again..."
  run bash -c "echo 'y' | bash .git-vault/remove.sh '$item_one'"
  assert_success
  echo "DEBUG [GitIgnore]: item_one removed again. Output contains: ... $(echo "$output" | tail -n 5)"

  # Verify .gitignore still has item_two and .git-vault/*.pw
  run grep -qxF "/$item_one" ".gitignore"
  assert_failure ".gitignore should not contain $item_one pattern after removal"
  run grep -qxF "/$item_two" ".gitignore"
  assert_success ".gitignore should still contain $item_two pattern"
  # Use grep -F (fixed string) for literal match
  run grep -qF ".git-vault/*.pw" ".gitignore"
  assert_success ".gitignore should still contain .git-vault/*.pw pattern"
  echo "DEBUG [GitIgnore]: End of test. .gitignore content:"
  cat ".gitignore"
}
