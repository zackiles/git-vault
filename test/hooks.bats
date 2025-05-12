#!/usr/bin/env bats

load 'test_helper'

@test "[Hooks] Git hooks trigger appropriately" {
  install_git_vault

  # Create tracked secret file
  local tracked_path="tracked_secret.txt"
  local password="pass_tracked"
  echo "initial content" > "$tracked_path"

  # Add the file to git-vault
  add_path "$tracked_path" "$password"
  assert_success

  # Calculate expected archive path
  local archive_name=$(echo "$tracked_path" | tr '/' '-')
  local archive_path=".git-vault/storage/${archive_name}.tar.gz.gpg"

  # Commit changes
  run git add .
  assert_success "git add should succeed"
  run git commit -m "Add tracked"
  assert_success "Initial commit should succeed"

  # Store the modification time of the archive
  # local initial_mod_time=$(stat -c %Y "$archive_path" 2>/dev/null || stat -f %m "$archive_path")
  # Add a short sleep to ensure mod time will be different
  # sleep 1

  # Modify tracked file
  echo "modified content" >> "$tracked_path"

  # Stage and commit the change
  run git add --force "$tracked_path"
  assert_success "Adding tracked file should succeed with --force"
  run git commit -m "Modify tracked"
  assert_success "Commit with modification should succeed"
  assert_output --partial "HOOK: Running git-vault pre-commit encryption"

  # Verify the archive file was updated by checking the git log for the last commit
  # The commit just made ("Modify tracked") should show the archive name.
  run git log -1 --name-only --pretty=format:"" -- "$archive_path" # Check the current HEAD commit
  assert_output --partial "$archive_path" "Archive should be listed as changed in the last commit"

  # Get the hash of the commit where the archive was just modified
  local archive_last_modified_commit=$(git log -1 --pretty=%H -- "$archive_path")

  # Create and modify an untracked file
  local untracked_path="untracked_file.txt"
  echo "untracked content" > "$untracked_path"

  # Commit the untracked file
  run git add "$untracked_path"
  assert_success "Adding untracked file should succeed"
  run git commit -m "Add untracked"
  assert_success "Commit with untracked file should succeed"

  # Verify the archive file was NOT updated in this new commit ("Add untracked").
  # The commit hash where archive_path was last modified should still be the one from before this commit.
  local current_last_commit_for_archive=$(git log -1 --pretty=%H -- "$archive_path")

  echo "DEBUG hooks.bats: For untracked commit:"
  echo "DEBUG hooks.bats: archive_path='$archive_path'"
  echo "DEBUG hooks.bats: archive_last_modified_commit (expected)='$archive_last_modified_commit'"
  echo "DEBUG hooks.bats: current_last_commit_for_archive (actual)='$current_last_commit_for_archive'"
  echo "DEBUG hooks.bats: Output of 'git commit -m Add untracked' command (should show pre-commit output):"
  echo "$output"
  echo "DEBUG hooks.bats: Recent git log:"
  git log --oneline -n 3 --stat

  [ "$current_last_commit_for_archive" = "$archive_last_modified_commit" ]
  assert_success "Archive should not have been updated by commit of untracked file"

  # Delete tracked file and verify post-checkout hook restores it
  rm "$tracked_path"
  assert_file_not_exist "$tracked_path"

  # Checkout previous commit to trigger post-checkout hook
  run git checkout HEAD~1 --quiet
  assert_success "Checkout should succeed"
  assert_output --partial "HOOK: Running git-vault post-checkout"

  # Verify file was restored
  assert_file_exist "$tracked_path"
  assert_file_contains "$tracked_path" "initial content"
}

@test "[Hooks] Hooks don't run for non-managed files" {
  install_git_vault

  # Create regular files not managed by git-vault
  local normal_file="normal_file.txt"
  echo "normal content" > "$normal_file"

  # Initial commit
  run git add "$normal_file"
  assert_success "Adding normal file should succeed"

  # The pre-commit hook still runs but shouldn't perform actions on normal files
  # We can't prevent the hook from running, but we can verify it doesn't encrypt anything
  run git commit -m "Add normal file"
  assert_success "Commit should succeed"

  # The hook might run but should not perform actual encryption operations
  if [[ "$output" == *"HOOK: Running git-vault pre-commit encryption"* ]]; then
    refute_output --partial "HOOK: Encrypting"
  fi

  # Modify normal file
  echo "updated content" >> "$normal_file"

  # Commit the change
  run git add "$normal_file"
  assert_success "Adding modified normal file should succeed"
  run git commit -m "Modify normal file"
  assert_success "Commit should succeed"

  # Again, the hook might run but should not perform actual encryption operations
  if [[ "$output" == *"HOOK: Running git-vault pre-commit encryption"* ]]; then
    refute_output --partial "HOOK: Encrypting"
  fi

  # Checkout previous commit
  run git checkout HEAD~1 --quiet
  assert_success "Checkout should succeed"

  # The hook might run but should not perform any decryption operations
  if [[ "$output" == *"HOOK: Running git-vault post-checkout"* ]]; then
    refute_output --partial "HOOK: Decrypting"
  fi
}
