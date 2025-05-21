# Product Requirements Document — **Git‑Vault** (DEPRECATED)

## 1 Purpose

Protect sensitive files inside a Git repo using lightweight, cross‑platform shell scripts. Encryption happens before commit; decryption happens after checkout or merge. Secrets never reach remote history.

## 2 Goals

* Zero‑config install with one‐line `curl`
* Preferred: No external binaries beyond `tar`, `gpg`, `mktemp`, `sha1sum` (or `shasum`). Exceptions depending on needs of the RFC.
* Same user flow on macOS, Linux, Windows (git‑bash/WSL)
* Hooks auto‑manage multiple protected paths
* Passwords stored only in local `.pw` files, ignored by Git
* Automatically configure Git LFS for large encrypted archives (>5MB by default)

## 3 Scope

Encrypt whole folders or single files. Configure Git LFS for large archives to prevent repository bloat. Fully supports binary large objects through seamless Git LFS integration. Do not manage key escrow.

## 4 User‑Facing Scripts

| Script       | Role           | Main Steps                                                                                                                                       |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `install.sh` | bootstrap      | create `git-vault/`, copy scripts, install hooks                                                                                                 |
| `add.sh`     | protect path   | resolve path ➜ check duplicates ➜ prompt password twice ➜ write `.pw` ➜ dry‑run encrypt+decrypt in `mktemp` ➜ update hooks ➜ append `.gitignore` |
| `remove.sh`  | unprotect path | verify path & password ➜ test decrypt ➜ strip hooks entry ➜ rename `.pw` ➜ offer `.gitignore` clean‑up                                           |

## 5 Core Engine Scripts

| Script       | Function          | Key Ops                                        |                                                                                           |
| ------------ | ----------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `encrypt.sh` | archive & encrypt | \`tar czf - <path>                             | gpg --symmetric --batch --passphrase-file <pw> --cipher-algo AES256 > <path>.tar.gz.gpg\` |
| `decrypt.sh` | decrypt & restore | inverse pipeline into `tar xzf -` in work‑tree |                                                                                           |

## 6 Git Hooks

| Hook            | Trigger Phase                 | Action                                                                              | Implementation                                                               |
| --------------- | ----------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pre-commit`    | before commit objects created | run `git-vault/encrypt.sh` for every tracked vault path; abort commit on failure    | Hook lists `.pw` files, reads relative paths from their names, loops encrypt |
| `post-checkout` | after branch/commit checkout  | run `git-vault/decrypt.sh` on all vault paths; ignore missing archives on fresh add | Same loop; silent on success                                                 |
| `post-merge`    | after `git merge`             | identical to `post-checkout`                                                        | reuse hook body via `source git-vault/decrypt.sh`                            |

Hook installer logic (inside `install.sh` or `add.sh` if hooks absent):

```bash
for h in pre-commit post-checkout post-merge; do
  hook=".git/hooks/$h"
  if ! grep -q "# git-vault" "$hook" 2>/dev/null; then
    printf '#!/usr/bin/env bash\n# git-vault\ngit-vault/%s "$@"\n' \
      "$( [ "$h" = pre-commit ] && echo encrypt.sh || echo decrypt.sh )" \
      >"$hook"
    chmod +x "$hook"
  fi
done
```

## 7 Data Flow

1. **Add resource →** password saved → plaintext path ignored → initial encrypt committed
2. **Commit cycle →** `pre-commit` re‑encrypt updated plaintext → only `.gpg` enters history
3. **Clone / checkout →** decrypted copy appears via `post-checkout` / `post-merge`
4. **Large archives →** automatically tracked via Git LFS if size exceeds threshold (default 5MB)

## 8 Error Handling

* Missing `gpg` or `tar` ➜ hard exit with code 1
* Password mismatch ➜ retry prompt up to 3
* Encrypt test fail ➜ roll back touched files, delete bad `.pw`

## 9 Security Notes

* AES‑256‑CTR via `gpg --symmetric`
* `.pw` files chmod 600 on \*nix; `attrib +h` on Windows git‑bash
* `.pw` filename uses `sha1sum <<< "$relpath"` first 8 chars to avoid leaking path
* Large encrypted archives stored via Git LFS to maintain repository performance and efficiently handle binary large objects

## 10 Non‑Goals

* No GUI key prompts
* No hardware token integration
* No automatic password sync across machines

## 11 Acceptance Criteria

* Fresh repo + install ➜ hooks created, commit succeeds, encrypted blob visible in Git log
* Checkout on second machine with same `.pw` files ➜ plaintext auto‑restored
* Remove script ➜ archives gone, hooks updated, `.pw.removed` created
* Large archives (>5MB) automatically tracked via Git LFS if available
* Binary large objects like images, videos, and other large datasets properly handled via LFS
* Install with `--min-lfs=10` ➜ only archives >10MB use Git LFS

## 12 Future Work

* Optional age/openssl backend
* CI helper to fetch passwords from secrets store
* Bulk rotate passwords command
* Enhanced Git LFS integration with progress reporting
