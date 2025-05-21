# Security Policy

## Supported Versions

Git-Vault aims for simplicity and stability. Security updates will primarily focus on the latest version available on the `main` branch. Older versions are not actively supported with security patches.

## Reporting a Vulnerability

The Git-Vault maintainers take security seriously. We appreciate your efforts to responsibly disclose your findings, and will make every effort to acknowledge your contributions.

To report a security vulnerability, please use the [GitHub Security Advisory feature](https://github.com/zackiles/git-vault/security/advisories/new) (if available for this repository) or email the maintainer directly (if contact information is provided in the repository or profile).

**Please do not report security vulnerabilities through public GitHub issues.**

When reporting a vulnerability, please provide:

- A clear description of the vulnerability and its potential impact.
- Steps to reproduce the vulnerability, including any specific configurations or files needed.
- If applicable, suggestions for a potential fix.

We will aim to acknowledge your report within 48 hours and provide a timeline for addressing the issue.

## Security Philosophy and Scope

Git-Vault relies on established tools like GPG and standard Git mechanisms (hooks) to provide its functionality. Its primary security goal is to prevent sensitive plaintext files from being committed to the remote Git repository history, replacing them with GPG-encrypted archives.

**In Scope:**

- Vulnerabilities in the `git-vault` shell scripts (`add.sh`, `remove.sh`, `encrypt.sh`, `decrypt.sh`, `install.sh`) that could lead to unintended exposure of plaintext secrets, incorrect encryption/decryption, or bypass of the hook mechanisms.
- Flaws in the installation process that compromise repository security.
- Issues related to the handling or exposure of the `.pw` password files by the scripts themselves.

**Out of Scope:**

- **GPG Vulnerabilities:** Security issues inherent to the GPG implementation itself should be reported to the GPG project.
- **Underlying Tool Vulnerabilities:** Issues in `tar`, `sha1sum`/`shasum`, `mktemp`, or the shell environment.
- **Weak User Passwords:** The strength of the encryption depends entirely on the password chosen by the user. Git-Vault cannot protect against weak or compromised passwords.
- **Local System Security:** Compromise of the user's local machine where plaintext files or password files reside.
- **Git History Manipulation:** Advanced Git operations that might bypass hooks (users should understand the implications of such actions).
- **Social Engineering:** Tricking users into revealing passwords or misusing the tool.

We recommend users follow best practices for password management and local system security when using Git-Vault.
