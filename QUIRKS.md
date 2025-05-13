# Quirks Found

This document lists various quirks and oddities when developing this shell-based cross-platform project. Example quirk:

```md
## Quirk: `sh` On macOS (EXAMPLE ONLY)

The default `sh` is actually **`bash` (pre-v3.2)** or a **POSIX-compatible `zsh`**, but **it is not the same behavior as `/bin/sh` on many Linux systems**, which is often **`dash`** (a much stricter POSIX shell).

**Implication:** Scripts that run fine with `#!/bin/sh` on macOS may silently fail or behave differently on Linux due to `dash` not supporting common `bash`isms like:

* `[[ ... ]]` instead of `[ ... ]`
* `function` keyword for defining functions
* `source` instead of `.`
* `echo -e` behavior varies
* Arrays syntax like `array=(a b)` not being valid

**Unexpected Path Angle:** macOS's `$PATH` when running scripts from Finder, GUI apps, or launch agents does **not include** `/usr/local/bin`, `/opt/homebrew/bin`, or user shell init modifications. So scripts depending on Homebrew-installed binaries may fail silently when launched outside terminal, even though they work in terminal. Linux typically maintains consistent `$PATH` between GUI and terminal contexts via PAM or `env` propagation.

**Mitigation:** Always use `/usr/bin/env bash` in shebangs for portability and explicitly set safe `$PATH` values in scripts run in GUI or background contexts.

<!-- ADd more quirks under other H2 sections-->
```

## Quirk: macOS BSD `sed` vs GNU `sed`

The `sed` command on macOS (BSD version) has significant differences from the GNU `sed` found on most Linux distributions.

**Implication:** Commands that work fine on Linux may fail on macOS with cryptic errors:

* In-place editing with `-i` requires an extension argument on macOS (`-i ''` or `-i.bak`)
* Special characters in replacement strings behave differently
* Regular expression syntax compatibility issues (BSD sed is more restrictive)
* Forward slashes in search patterns require different escaping approaches

**Unexpected Behavior:** When using `/` as delimiter with paths containing slashes, BSD `sed` throws errors like `bad flag in substitute command: 'n'` when it encounters `/dev/null`.

**Mitigation:** Use alternative delimiters like `|` or `#` instead of `/` when working with paths. Always test `sed` commands on both platforms and prefer simpler patterns that work cross-platform.

## Quirk: Shell Function Mocking and Recursion 

When mocking shell commands like `git` in tests, the mock can recursively call itself leading to an infinite loop or hang.

**Implication:** Tests that try to intercept and mock certain command calls may fail mysteriously or hang without any visible error.

**Unexpected Behavior:** A common pattern like:
```bash
git() {
  if [special condition]; then
    echo "mock output"
  else
    git "$@"  # DANGER: This calls the mock itself, not the real git!
  fi
}
```

creates infinite recursion since the `git` command inside the function calls the mock again.

**Mitigation:** Always use `command git "$@"` to bypass the function and call the actual command. For more complex mocking scenarios, use PATH manipulation or create external wrapper scripts.

## Quirk: Shell Command Quoting in Subshells

Commands with multiple levels of quotes and variable expansions behave differently when run through subshells using `bash -c`.

**Implication:** Complex commands with pipes, quotes, and redirects may work as expected when run directly but fail when passed to `bash -c` as a string.

**Unexpected Behavior:** Code like:
```bash
run bash -c "printf '%s\n%s\n' 'password' 'password' | command '$path'"
```
can fail with syntax errors about unexpected EOF or mismatched quotes.

**Mitigation:** For complex commands in tests, write them to a temporary script file and execute that script instead. Alternatively, use single quotes for the outer shell and carefully manage nested quotes. When possible, avoid nesting interpretation layers by using heredocs or script files.
