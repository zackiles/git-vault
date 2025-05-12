#!/usr/bin/env bash
# Common helper functions for git-vault bats tests

# Absolute path to the main project root (where add.sh, etc. are)
PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." >/dev/null 2>&1 && pwd)"
# Absolute path to the test directory
TEST_DIR="$PROJECT_ROOT/test"
# Temporary directory for test repositories
TMP_DIR="$TEST_DIR/tmp"

# Function to set up a temporary git repository for a test
setup_test_repo() {
  # Create a temporary directory for this test
  local test_repo_path
  test_repo_path=$(mktemp -d "$TMP_DIR/git-vault-test.XXXXXX")

  # Store the path in a global variable for the test to use and for teardown
  TEST_REPO="$test_repo_path"
  export TEST_REPO # Make it available to subshells run by 'run'

  # Initialize a proper git repository in the temp directory
  cd "$TEST_REPO" || return 1
  git init --initial-branch=main --quiet

  # Configure git user for commits (required by Git)
  git config user.email "test@example.com"
  git config user.name "Git Vault Test"

  # Create a basic .gitignore file
  echo "# Git test repository" > ".gitignore"
  echo "*.log" >> ".gitignore"
  echo "*.tmp" >> ".gitignore"

  # Make an initial commit to establish the repo
  git add .gitignore
  git commit -m "Initial commit with .gitignore" --quiet

  # Set up custom hooks directory for better isolation
  # IMPORTANT: Use .githooks instead of .git/hooks to avoid modifying the real Git hooks
  git config core.hooksPath ".githooks" # Use a local dir instead of .git/hooks
  mkdir -p ".githooks"
}

# Function to simulate installing git-vault into the current test repository
install_git_vault() {
  # Ensure we are in the TEST_REPO
  if [ "$(pwd)" != "$TEST_REPO" ]; then
    echo "Error: install_git_vault must be run from within TEST_REPO" >&2
    return 1
  fi

  # SAFELY copy the scripts to the test repo first
  mkdir -p "$TEST_REPO/temp_scripts"
  cp "$PROJECT_ROOT/add.sh" "$TEST_REPO/temp_scripts/"
  cp "$PROJECT_ROOT/remove.sh" "$TEST_REPO/temp_scripts/"
  cp "$PROJECT_ROOT/encrypt.sh" "$TEST_REPO/temp_scripts/"
  cp "$PROJECT_ROOT/decrypt.sh" "$TEST_REPO/temp_scripts/"
  cp "$PROJECT_ROOT/install.sh" "$TEST_REPO/temp_scripts/"

  # Create an empty paths.list instead of copying it (since it's now embedded in install.sh)
  touch "$TEST_REPO/temp_scripts/paths.list"

  # Run the install script with the --target-dir flag pointing to our test repository
  # This ensures we never modify the main project's files or hooks
  cd "$TEST_REPO" || return 1
  run bash "$TEST_REPO/temp_scripts/install.sh" --target-dir "$TEST_REPO"
  assert_success "install.sh should succeed"

  # Verify basic installation results
  assert_dir_exist "git-vault"
  assert_dir_exist "storage"
  assert_dir_exist ".githooks" # Check custom hooks path
  assert_file_exist "git-vault/paths.list"

  # Check hooks in the CUSTOM locations (.githooks not .git/hooks)
  assert_file_exist ".githooks/pre-commit"
  assert_file_exist ".githooks/post-checkout"
  assert_file_exist ".githooks/post-merge"
  assert_file_executable ".githooks/pre-commit"
  assert_file_executable ".githooks/post-checkout"
  assert_file_executable ".githooks/post-merge"

  # Check .gitignore for the pw file pattern
  assert_file_exist ".gitignore"
  run grep -q 'git-vault/\*\.pw' ".gitignore"
  assert_success ".gitignore should contain git-vault/*.pw rule"

  # Add all git-vault scripts to the repo so they don't show as untracked
  git add .githooks git-vault storage
  git commit -m "Add git-vault infrastructure" --quiet

  # Cleanup our temp scripts
  rm -rf "$TEST_REPO/temp_scripts"
}

# Function to cleanup the temporary repository
teardown_test_repo() {
  if [ -n "$TEST_REPO" ] && [ -d "$TEST_REPO" ]; then
    rm -rf "$TEST_REPO"
  fi
  # Reset TEST_REPO var? Optional. Bats usually runs tests in subshells.
  # unset TEST_REPO
}

# Common setup for tests needing a repo with git-vault installed
setup() {
  # Load helpers from the test_helper directory
  load "$TEST_DIR/test_helper/bats-support/load.bash"
  load "$TEST_DIR/test_helper/bats-assert/load.bash"
  load "$TEST_DIR/test_helper/bats-file/load.bash"

  # Create the main tmp directory if it doesn't exist
  mkdir -p "$TMP_DIR"
  setup_test_repo
}

# Common teardown
teardown() {
  teardown_test_repo
  # Optional: Add more cleanup if needed
}

# Function to add a file/dir using add.sh and handle password prompts
# Usage: add_path <path_to_add> <password>
add_path() {
  local path_to_add="$1"
  local password="$2"
  local add_script="$TEST_REPO/git-vault/add.sh"

  # Create content if it doesn't exist
  if [ ! -e "$path_to_add" ]; then
    if [[ "$path_to_add" == */ ]]; then # Check if it ends with / indicating directory
        mkdir -p "$path_to_add"
        echo "content for dir $path_to_add" > "$path_to_add/file.txt"
    else
        mkdir -p "$(dirname "$path_to_add")"
        echo "content for $path_to_add" > "$path_to_add"
    fi
  fi

  # Ensure storage directory exists with proper structure
  mkdir -p "$TEST_REPO/storage"

  # Don't try to create directories based on archive_name, as it should be dash-separated
  # The actual add.sh script will correctly create parent directories as needed

  # Run add.sh, piping the password twice
  # Use a subshell or process substitution to handle stdin
  echo "Running add.sh for $path_to_add"
  run bash -c "printf '%s\\n%s\\n' '$password' '$password' | bash '$add_script' '$path_to_add'"
  assert_success "add.sh should succeed for '$path_to_add'"
}
