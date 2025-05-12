#!/usr/bin/env bash
# Run tests with timeout

# Configuration
TEST_TIMEOUT=${TEST_TIMEOUT:-60}  # Default timeout in seconds (increased to 60)
TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if timeout command is available
if ! command -v timeout >/dev/null 2>&1; then
  echo "Warning: 'timeout' command not found. Tests will run without timeouts."
  # Fall back to running bats directly
  exec bats "$@"
fi

# Run bats with timeout - if any test takes longer than TEST_TIMEOUT, it will be terminated
echo "Running tests with ${TEST_TIMEOUT}s timeout per test..."

# If no arguments provided, run all tests in the test directory
if [ $# -eq 0 ]; then
  timeout --foreground --kill-after=10 "$TEST_TIMEOUT" bats "$TESTS_DIR"
else
  # Run with the provided arguments
  timeout --foreground --kill-after=10 "$TEST_TIMEOUT" bats "$@"
fi
