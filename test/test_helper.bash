#!/usr/bin/env bash
# Common helper functions for git-vault bats tests

# Absolute path to the main project root (where add.sh, etc. are)
PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." >/dev/null 2>&1 && pwd)"
# Absolute path to the test directory
TEST_DIR="$PROJECT_ROOT/test"
# Temporary directory for test repositories
TMP_DIR="$TEST_DIR/tmp"
# Default test timeout in seconds
TEST_TIMEOUT=${TEST_TIMEOUT:-90}

# Function to set up timeout for tests
setup_test_timeout() {
  # Only set up timeout if timeout command is available
  if command -v timeout >/dev/null 2>&1; then
    # Create a timeout function that will be called by bats_test_begin
    bats_test_begin_original="$BATS_TEST_BEGIN"
    BATS_TEST_BEGIN=bats_test_begin_with_timeout
    bats_test_begin_with_timeout() {
      # Start a background process that will kill the test after TEST_TIMEOUT seconds
      (
        sleep "$TEST_TIMEOUT"
        echo "Test timed out after $TEST_TIMEOUT seconds: $BATS_TEST_DESCRIPTION" >&2
        # Get the PID of the running test and kill it with SIGTERM
        ps -o pid= -p $$ | xargs -I{} sh -c "pkill -P {} || true" >/dev/null 2>&1
      ) &
      timeout_pid=$!

      # Call the original bats_test_begin function
      "$bats_test_begin_original"
    }

    # Override bats_test_end to kill the timeout process
    bats_test_end_original="$BATS_TEST_END"
    BATS_TEST_END=bats_test_end_with_timeout
    bats_test_end_with_timeout() {
      # Kill the timeout process if it's still running
      if [ -n "$timeout_pid" ]; then
        kill "$timeout_pid" >/dev/null 2>&1 || true
        wait "$timeout_pid" 2>/dev/null || true
        unset timeout_pid
      fi

      # Call the original bats_test_end function
      "$bats_test_end_original"
    }
  else
    echo "Warning: 'timeout' command not found. Tests will run without timeouts." >&2
  fi
}

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
  cp "$PROJECT_ROOT/utils.sh" "$TEST_REPO/temp_scripts/"

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

  # Create an empty paths.list for testing - restore this line
  touch "$TEST_REPO/temp_scripts/paths.list"

  # Run the install script with the --target-dir flag pointing to our test repository
  # This ensures we never modify the main project's files or hooks
  cd "$TEST_REPO" || return 1
  # Pipe "n" to the 1Password prompt to default to file-based storage for tests
  run sh -c "printf 'n\\n' | sh \"$TEST_REPO/temp_scripts/install.sh\" --target-dir \"$TEST_REPO\""
  assert_success "install.sh should succeed"

  # Verify basic installation results
  assert_dir_exist ".git-vault"
  assert_dir_exist ".git-vault/storage"
  assert_dir_exist ".githooks" # Check custom hooks path
  assert_file_exist ".git-vault/paths.list"

  # Check hooks in the CUSTOM locations (.githooks not .git/hooks)
  assert_file_exist ".githooks/pre-commit"
  assert_file_exist ".githooks/post-checkout"
  assert_file_exist ".githooks/post-merge"
  assert_file_executable ".githooks/pre-commit"
  assert_file_executable ".githooks/post-checkout"
  assert_file_executable ".githooks/post-merge"

  # Check .gitignore for the pw file pattern
  assert_file_exist ".gitignore"
  run grep -q '\.git-vault/\*\.pw' ".gitignore"
  assert_success ".gitignore should contain .git-vault/*.pw rule"

  # Add all git-vault scripts to the repo so they don't show as untracked
  git add .githooks .git-vault
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

  # Set up test timeout
  setup_test_timeout

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
  local add_script="$TEST_REPO/.git-vault/add.sh"

  # Debug the setup
  echo "Debug: Adding path '$path_to_add' with password"
  echo "Debug: Working in directory: $(pwd)"
  echo "Debug: Test repo: $TEST_REPO"
  echo "Debug: Checking for add.sh at: $add_script"

  # Make sure add.sh is available
  if [ ! -f "$add_script" ]; then
    echo "ERROR: add.sh not found at $add_script" >&2
    # Check if we can find it elsewhere
    find "$TEST_REPO" -name "add.sh" -type f >&2
    return 1
  fi

  # Create content if it doesn't exist
  if [ ! -e "$path_to_add" ]; then
    case "$path_to_add" in
      */) # Check if it ends with / indicating directory
        mkdir -p "$path_to_add"
        echo "Debug: Created directory $path_to_add"
        echo "content for dir $path_to_add" > "$path_to_add/file.txt"
        echo "Debug: Added test file in directory"
        ;;
      *)
        mkdir -p "$(dirname "$path_to_add")"
        echo "Debug: Created parent dir for $path_to_add"
        echo "content for $path_to_add" > "$path_to_add"
        echo "Debug: Created file $path_to_add"
        ;;
    esac
  fi

  # Ensure storage directory exists with proper structure
  mkdir -p "$TEST_REPO/.git-vault/storage"
  echo "Debug: Ensured storage directory exists"

  # Run add.sh, piping the password twice
  echo "Running add.sh for $path_to_add"
  run bash -c "printf '%s\\n%s\\n' '$password' '$password' | bash '$add_script' '$path_to_add'"

  # If add.sh fails, provide more debugging info
  if [ "$status" -ne 0 ]; then
    echo "ERROR: add.sh failed with status $status" >&2
    echo "Output: $output" >&2
    return 1
  fi

  assert_success "add.sh should succeed for '$path_to_add'"
}
