# Git-Vault Test Improvements Checklist
*October 19, 2023*

## Overview

This document outlines the implementation plan for fixing the remaining test failures in the git-vault test suite. While the primary tests related to directory handling and LFS integration are now passing, there are still two tests in `test/utils.bats` that have been temporarily skipped and need proper fixes.

## Implementation Checklist

### 1) Fix `get_project_name - from remote` Test
Fix the test that verifies the `get_project_name()` function correctly extracts the project name from a Git remote URL. Currently, the test hangs or produces incorrect output due to issues with shell function recursion and sed expression interpretation.

#### 1.1) Understand the Root Cause
- [x] Review the implementation of `get_project_name()` in `utils.sh`
- [x] Analyze how the sed expression `'s|^.*/([^/]+)(\\.git)?$|\\1|'` is processed differently across platforms
- [x] Verify the specific shell expansion behavior for `\\1` in different contexts

#### 1.2) Implement a Robust Test Script Approach
- [ ] Create a test approach that doesn't rely on function mocking
- [ ] Prepare a standalone script that handles proper path escaping for the sed expression
- [x] Ensure proper file descriptor handling for stderr capture
- [ ] Use heredoc syntax to avoid quoting issues in the test script

#### 1.3) Update Test and Verify Cross-Platform Compatibility
- [ ] Update the `get_project_name - from remote` test with the robust implementation
- [ ] Test on both macOS and Linux to ensure compatibility
- [ ] Add comments explaining the technique for future maintainers

### 2) Fix `get_op_password - op failure` Test
Fix the test that verifies that `get_op_password()` function properly handles and reports errors when the 1Password CLI fails. Currently, the test isn't properly capturing stderr output from the 1Password CLI mock.

#### 2.1) Analyze Error Handling in the Function
- [x] Review how `get_op_password()` captures and processes error output from `op`
- [x] Verify how error messages are passed between the function and test environment
- [x] Identify where the current test is failing to capture the error message

#### 2.2) Create a Better Mock Strategy
- [ ] Develop a proper mock for the `op` command that reliably produces error output
- [x] Ensure error output is directed to the appropriate file descriptor
- [ ] Set up a test environment that properly propagates and captures all output
- [ ] Use a temporary script approach instead of inline shell execution

#### 2.3) Update Test for Cross-Platform Compatibility
- [ ] Implement the revised test for `get_op_password - op failure`
- [ ] Test on both macOS and Linux environments
- [ ] Add comments explaining the technique for future maintainers
- [ ] Consider adding a helper function in `test_helper.bash` for similar tests

### 3) Enhance Test Suite Robustness
Apply the lessons learned from fixing these tests to enhance the overall robustness of the test suite, especially for cross-platform compatibility.

#### 3.1) Add Common Helper Functions
- [x] Create helper functions for common mock patterns
- [x] Implement safe shell command execution patterns
- [x] Add utilities for capturing and testing stderr output more reliably

#### 3.2) Improve Test Timeout Handling
- [x] Review and enhance the timeout mechanism in `run-tests.sh`
- [ ] Add more granular timeout controls for individual tests that might be slow
- [ ] Ensure clean termination of subprocesses when timeouts occur

#### 3.3) Document Platform-Specific Considerations
- [x] Update test documentation with platform-specific considerations
- [ ] Add more details to `QUIRKS.md` as encountered
- [ ] Create a guide section in `test/README.md` for writing cross-platform tests

## Appendix: Code Samples

### A. Robust Shell Function Mock Pattern

```bash
# Create a test file with predefined output
echo "git@github.com:username/repo-name.git" > git_remote_output.txt

# Create a test script that uses function redefinition
cat > test_script.sh << 'EOF'
#!/bin/bash
# Source the function we want to test
. ./utils.sh

# Define our own git function that uses command
git() {
  if [ "$1" = "remote" ] && [ "$2" = "get-url" ] && [ "$3" = "origin" ]; then
    cat git_remote_output.txt
    return 0
  else
    # Use 'command' to avoid recursion
    command git "$@"
  fi
}
# Export the function so it's available to the sourced script
export -f git

# Call the function under test
get_project_name
EOF
chmod +x test_script.sh

# Run the script directly (not through bash -c)
run ./test_script.sh
```

### B. Reliable Error Capture Pattern

```bash
# Create mock script for a command
cat > mock_op.sh << 'EOF'
#!/bin/bash
# Write to stderr
echo "Error: Operation failed" >&2
# Exit with error status
exit 1
EOF
chmod +x mock_op.sh

# Put mock directory at front of PATH
export PATH="$(pwd)/mocks:$PATH"

# Create a test script that will properly capture all output
cat > test_op_error.sh << 'EOF'
#!/bin/bash
# Source the function we want to test
. ./utils.sh

# Call function and capture all output
get_op_password "hash" ".git-vault"
EOF
chmod +x test_op_error.sh

# Run with combined stderr
run bash -c "./test_op_error.sh 2>&1"
```

## Summary

This implementation plan addresses the remaining test failures in the git-vault test suite, specifically focusing on the two skipped tests in `test/utils.bats`. The primary objective is to make these tests robust, cross-platform compatible, and reliable by addressing common shell scripting pitfalls.

To implement this plan, follow each phase in order and mark steps as complete before moving to the next phase. After completing each phase, run the tests to validate that the changes work correctly before proceeding. You can choose to write any additional tests either at the end once all phases are complete, or after each phase, depending on what makes the most sense for these utility functions.

Remember that these fixes must work on both macOS and Linux environments due to the differences in shell implementations and utility behaviors noted in the QUIRKS.md file. Always test your changes on both platforms if possible. 
