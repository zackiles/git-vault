#!/usr/bin/env bats

load 'test_helper'

# Test Case 1: Core End-to-End Flow (Install, Add, Commit, Checkout)

@test "[Core] install.sh completes successfully and sets up structure" {
  install_git_vault # setup already creates the repo
  # Assertions are inside install_git_vault helper
}

@test "[Core] add.sh adds a file, creates pw, archive, updates manifest, .gitignore" {
  install_git_vault
  local file_path="secrets/my_key.txt"
  local password="testpassword123"

  # Calculate expected hash and filenames (relative to TEST_REPO)
  local path_hash=$(printf "%s" "$file_path" | sha1sum | cut -c1-8)
  local pw_file="git-vault/git-vault-${path_hash}.pw"
  local archive_name=$(echo "$file_path" | sed 's|/|-|g') # Based on add.sh logic
  local archive_file="storage/${archive_name}.tar.gz.gpg"
  local gitignore_pattern="/$file_path"

  add_path "$file_path" "$password"

  assert_output --partial "Success: '$file_path' is now managed by git-vault."

  # Verify files created by add.sh
  assert_file_exist "$pw_file"
  assert_file_exist "$archive_file"
  assert_file_exist "git-vault/paths.list"
  assert_file_exist ".gitignore"

  # Verify pw file content (optional, maybe too sensitive?)
  # run cat "$pw_file"
  # assert_output "$password"

  # Verify manifest content
  run grep -q "^$path_hash $file_path" "git-vault/paths.list"
  assert_success "Manifest should contain hash and path for '$file_path'"

  # Verify .gitignore content
  run grep -qxF "$gitignore_pattern" ".gitignore"
  assert_success ".gitignore should contain exact pattern '$gitignore_pattern'"

  # Verify git status shows archive and .gitignore staged (add.sh stages them)
  run git status --porcelain
  assert_output --partial "A  $archive_file"
  assert_output --partial "M  .gitignore"
}

@test "[Core] add.sh adds a directory, creates pw, archive, updates manifest, .gitignore" {
  install_git_vault
  local dir_path="sensitive_data/"
  local password="dirpass456"

  # Create the directory before adding
  mkdir -p "$dir_path"
  echo "secret stuff" > "${dir_path}file1.txt"

  add_path "$dir_path" "$password"

  # Extract the actual hash and paths from the script output
  local actual_pw_file=$(echo "$output" | grep "Password saved in:" | sed -E 's/.*git-vault-([a-f0-9]{8})\.pw.*/\1/')
  local actual_archive_file=$(echo "$output" | grep "Archive stored in:" | sed -E 's/.*storage\/([^\.]+\.tar\.gz\.gpg).*/\1/')

  local pw_file="git-vault/git-vault-${actual_pw_file}.pw"
  local archive_file="storage/${actual_archive_file}"

  assert_output --partial "Success: '$dir_path' is now managed by git-vault."
  assert_file_exist "$pw_file"
  assert_file_exist "$archive_file"

  # Check paths.list with the actual hash
  run grep -q "^${actual_pw_file} $dir_path" "git-vault/paths.list"
  assert_success "Manifest should contain hash and path for directory '$dir_path'"

  # Check gitignore
  local gitignore_pattern="/$dir_path" # Remove the trailing slash since dir_path already has one
  run grep -qxF "$gitignore_pattern" ".gitignore"
  assert_success ".gitignore should contain directory pattern '$gitignore_pattern'"

  # Verify git status
  run git status --porcelain
  assert_output --partial "A  $archive_file"
  assert_output --partial "M  .gitignore"
}

@test "[Core] First commit after add succeeds" {
  install_git_vault
  add_path "my_secret.conf" "password"

  run git add .
  assert_success "git add should succeed"
  run git commit -m "Initial vault setup"
  # Check output for hook messages (encrypt hook shouldn't run if no change)
  refute_output --partial "HOOK: Running git-vault encrypt"
  assert_success "First commit should succeed"
}

@test "[Core] pre-commit hook encrypts modified vaulted file" {
  install_git_vault
  local file_path="my_secret.conf"
  add_path "$file_path" "password"

  # Add all files including ignored ones
  run git add --force .
  assert_success "git add should succeed"

  run git commit -m "Add initial secret"
  assert_success "Initial commit should succeed"

  # Modify the secret file
  echo "new content" >> "$file_path"

  # Make sure the file is staged (force add because it's in .gitignore)
  run git add --force "$file_path"
  assert_success "Adding ignored file should succeed with --force"

  # Commit the change
  run git commit -m "Update secret data"
  assert_success "Commit with modification should succeed"
  assert_output --partial "HOOK: Running git-vault pre-commit encryption..."
  assert_output --partial "HOOK: Encrypting '$file_path'"

  # Verify the archive file was updated (check git log)
  local archive_name=$(echo "$file_path" | tr '/' '-')
  local archive_file="storage/${archive_name}.tar.gz.gpg"
  run git log -1 --stat -- "$archive_file"
  assert_output --partial "$archive_file" # Should show the archive file changed
}

@test "[Core] post-checkout hook decrypts vaulted file" {
  install_git_vault
  local file_path="my_secret.conf"
  local initial_content="first version"
  local updated_content="second version"

  # Add and commit initial version
  echo "$initial_content" > "$file_path"
  add_path "$file_path" "password"

  # Force add the ignored files
  run git add --force .
  assert_success "git add with force should succeed"
  run git commit -m "Commit v1"
  assert_success

  # Modify and commit second version
  echo "$updated_content" > "$file_path"

  # Force add the modified file
  run git add --force "$file_path"
  assert_success "Adding modified file should succeed with --force"
  run git commit -m "Commit v2"
  assert_success
  assert_output --partial "HOOK: Running git-vault pre-commit encryption..."

  # Verify content is v2
  assert_file_contains "$file_path" "$updated_content"

  # Checkout previous commit
  run git checkout HEAD~1 --quiet
  assert_success
  assert_output --partial "HOOK: Running git-vault post-checkout/post-merge decryption..."
  assert_output --partial "HOOK: Decrypting 'storage/my_secret.conf.tar.gz.gpg' -> 'my_secret.conf'"

  # Verify content is now v1
  assert_file_contains "$file_path" "$initial_content"

  # Checkout latest commit again
  run git checkout main --quiet
  assert_success
  assert_output --partial "HOOK: Running git-vault post-checkout/post-merge decryption..."

  # Verify content is back to v2
  assert_file_contains "$file_path" "$updated_content"
}

# Test Case 2: Multi-Path Handling

@test "[MultiPath] pre-commit hook encrypts multiple modified files" {
  install_git_vault
  local file1="secret1.txt"
  local file2="config/secret2.yml"
  add_path "$file1" "pass1"
  add_path "$file2" "pass2"

  # Add files with force to override gitignore
  run git add --force .
  assert_success "git add with force should succeed"
  run git commit -m "Add secrets 1 and 2"
  assert_success

  # Modify both files
  echo "update1" >> "$file1"
  echo "update2" >> "$file2"

  # Force add the ignored files
  run git add --force "$file1" "$file2"
  assert_success "Adding modified files should succeed with --force"

  run git commit -m "Update both secrets"
  assert_success
  assert_output --partial "HOOK: Running git-vault pre-commit encryption..."
  # Check that *both* files are mentioned in the encryption output
  assert_output --partial "HOOK: Encrypting '$file1'"
  assert_output --partial "HOOK: Encrypting '$file2'"
}

@test "[MultiPath] post-checkout hook decrypts multiple files" {
  install_git_vault
  local file1="secret1.txt"; local content1_v1="v1.1"; local content1_v2="v1.2"
  local file2="config/secret2.yml"; local content2_v1="v2.1"; local content2_v2="v2.2"

  # Commit v1
  mkdir -p config
  echo "$content1_v1" > "$file1"; echo "$content2_v1" > "$file2"
  add_path "$file1" "pass1"
  add_path "$file2" "pass2"

  # Force add the ignored files
  run git add --force .
  assert_success "git add with force should succeed"
  run git commit -m "Commit v1 for both"
  assert_success

  # Commit v2
  echo "$content1_v2" > "$file1"; echo "$content2_v2" > "$file2"

  # Force add the ignored files
  run git add --force "$file1" "$file2"
  assert_success "Adding modified files should succeed with --force"
  run git commit -m "Commit v2 for both"
  assert_success

  # Verify content is v2
  assert_file_contains "$file1" "$content1_v2"
  assert_file_contains "$file2" "$content2_v2"

  # Checkout v1
  run git checkout HEAD~1 --quiet
  assert_success
  assert_output --partial "HOOK: Running git-vault post-checkout/post-merge decryption..."
  # Check that *both* files are mentioned in decryption output
  assert_output --partial "Decrypting 'storage/secret1.txt.tar.gz.gpg' -> '$file1'"
  assert_output --partial "Decrypting 'storage/config-secret2.yml.tar.gz.gpg' -> '$file2'"

  # Verify content is v1
  assert_file_contains "$file1" "$content1_v1"
  assert_file_contains "$file2" "$content2_v1"
}

@test "[Nested] Complex directory structure is preserved after encrypt/decrypt cycle" {
  install_git_vault
  local dir_path="nested_secrets"
  local password="complex_dir_password"

  # Create a complex nested directory structure
  mkdir -p "$dir_path/level1/level2/level3"
  mkdir -p "$dir_path/branch1/branch2"
  mkdir -p "$dir_path/empty_dir"  # Empty directory

  # Create files at different levels
  echo "root level content" > "$dir_path/root_file.txt"
  echo "level 1 content" > "$dir_path/level1/level1_file.txt"
  echo "level 2 content" > "$dir_path/level1/level2/level2_file.txt"
  echo "level 3 content" > "$dir_path/level1/level2/level3/level3_file.txt"
  echo "branch 1 content" > "$dir_path/branch1/branch1_file.txt"
  echo "branch 2 content" > "$dir_path/branch1/branch2/branch2_file.txt"

  # Add some special content
  echo "file with spaces" > "$dir_path/file with spaces.txt"
  echo "file.with.dots" > "$dir_path/file.with.dots.txt"

  # Add the nested directory to git-vault
  add_path "$dir_path" "$password"
  assert_success
  assert_output --partial "Success: '$dir_path/' is now managed by git-vault."

  # Commit everything
  run git add .
  assert_success "git add should succeed"
  run git commit -m "Add nested directory structure"
  assert_success

  # Create a list of all files/directories for verification
  find "$dir_path" -type f -o -type d | sort > original_structure.txt

  # Get content of all files for verification
  find "$dir_path" -type f -exec sh -c 'echo "File: $1"; cat "$1"; echo ""' _ {} \; > original_content.txt

  # Remove the entire directory (simulate checkout to a clean state)
  rm -rf "$dir_path"

  # Trigger decryption via post-checkout hook
  run git checkout .
  assert_success
  assert_output --partial "HOOK: Running git-vault post-checkout/post-merge decryption..."
  assert_output --partial "HOOK: Decrypting"

  # Verify structure is preserved
  find "$dir_path" -type f -o -type d | sort > restored_structure.txt
  run diff original_structure.txt restored_structure.txt
  assert_success "Directory structure should be identical after decryption"
  assert_output ""  # Empty output means no differences

  # Verify content is preserved
  find "$dir_path" -type f -exec sh -c 'echo "File: $1"; cat "$1"; echo ""' _ {} \; > restored_content.txt
  run diff original_content.txt restored_content.txt
  assert_success "File content should be identical after decryption"
  assert_output ""  # Empty output means no differences

  # Verify a few specific files more explicitly
  assert_file_exist "$dir_path/root_file.txt"
  assert_file_exist "$dir_path/level1/level2/level3/level3_file.txt"
  assert_file_exist "$dir_path/branch1/branch2/branch2_file.txt"
  assert_file_exist "$dir_path/file with spaces.txt"

  # Verify content of specific files
  assert_file_contains "$dir_path/root_file.txt" "root level content"
  assert_file_contains "$dir_path/level1/level2/level3/level3_file.txt" "level 3 content"
  assert_file_contains "$dir_path/file with spaces.txt" "file with spaces"
}
