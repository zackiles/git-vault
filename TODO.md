# TODOs

## Current TODOs

Before marking a TODO done, run all tests. If they pass, mark it and the implementation plans as done. TODOs require an implementation plat and checklist in `docs/{todo name}-checklist.md`.

### 1 ) Integrate 1Password for Passwords

- **Objective**: Provide a way other than file-based passwords by allowing a seamless 1Password CLI integration.
- `install.sh` asks if they want to use 1Password or regular file. (if the CLI is detected) otherwise it defaults to regular files.
- All other logic in scripts stays the same except they know if they're using file or 1Password and encrypt/decrypt using a password or key stored on 1Password and managed through the 1Password CLI.
- Multiple passwords can be created for multiple files in the same project.
- The pattern for how to store the password or key IN 1Password should be idiomatic, intuitive, and seamless so that the user doesn't need to do anything and the password entries don't clutter or collide with their workspace.
- `remove.sh` should remove the password from 1Password in a way similar to how file-based does, where it "marks" it removed instead of fully deleting it in case a user makes a mistake (we don't want them losing an unrecoverable decryption key)
- Update all and tests/docs to reflect the new design. Ensure we mock 1Password's CLI interactions as best we can and doing so ONLY after doing deep research on their documentation and understanding of how it works cross-platform.

### 2 ) Support Symmetric Keys

Investigate supporting Symmetric Keys for Git-Vault. Borrow inspiration from the open source project [git-crypt]([git-crypt](https://github.com/AGWA/git-crypt)) by reviewing its documentation and code. git-crypt currently supports Symmetric Keys. Generate a TODO that documents the objective and what is needed to get feature parity with git-crypt in its usage of Symmetric Keys for encrypting and decrypting files. This TODO is to create another TODO.

### 3 ) Field Encryption For JSON and YAML

If the `add` command detects a JSON or YAML file it will prompt a user to ask if they want to encrypt just the values of all fields in the file when storing it in the vault, or do a full file encryption.

### 4 ) Put`.pw` files in the `.vault` folder

This will tidy up the end-users project by not cluttering the root of their repository with .pw files

### 6 ) Project Helpers

During the `add` command, check if user has a project config file with tasks in it at the project root, and if so, ask them if they'd like us to optionally add tasks for `vault:add` and `vault:remove`. This will greatly improve developer experience by providing a more familiar way for them to interact with git-vault in their projects.

- NOTE: also cleanup these tasks on the `remove` command.
- NOTE: not all packages may support the syntax like `vault:add` with the semi-colon, that's OK. For javascript based configs stick with the lowercase semi-colon, in other languages do what is most typical.

Prioritized list to implement:

| Filename                   | Ecosystem                 | Typical Usage Command               | Popularity (approximate rank)           |
| -------------------------- | ------------------------- | ----------------------------------- | --------------------------------------- |
| `package.json`             | JavaScript / Node.js      | `npm run`, `yarn run`, `pnpm run`   | ★★★★★ (ubiquitous in JS projects)       |
| `Makefile`                 | General (C/C++, Go, etc.) | `make`                              | ★★★★☆ (common in OSS, cross-language)   |
| `Cargo.toml`               | Rust                      | `cargo run`, `cargo build`, `cargo` | ★★★★☆ (ubiquitous in Rust projects)     |
| `build.gradle` / `*.kts`   | Java / Kotlin             | `gradle`, `./gradlew`               | ★★★★☆ (dominant in JVM projects)        |
| `pyproject.toml`           | Python                    | `poetry run`, `hatch run`           | ★★★☆☆ (rising, not universal yet)       |
| `build.sbt`                | Scala                     | `sbt`                               | ★★★☆☆ (standard for Scala)              |
| `mix.exs`                  | Elixir                    | `mix`                               | ★★★☆☆ (universal in Elixir projects)    |
| `Rakefile`                 | Ruby                      | `rake`                              | ★★★☆☆ (seen in legacy and gems)         |
| `Justfile`                 | Rust, general             | `just`                              | ★★☆☆☆ (popular in modern OSS Rust)      |
| `deno.json` / `deno.jsonc` | Deno                      | `deno task`                         | ★★☆☆☆ (limited to Deno community)       |
| `Taskfile.yml`             | Go, general               | `task`                              | ★★☆☆☆ (niche but growing)               |
| `noxfile.py`               | Python                    | `nox`                               | ★★☆☆☆ (used in some test workflows)     |
| `fabfile.py`               | Python                    | `fab`                               | ★☆☆☆☆ (mostly legacy)                   |
| `Snakefile`                | Python (Snakemake)        | `snakemake`                         | ★☆☆☆☆ (popular in data science)         |
| `invoke.yaml`              | Python (Invoke)           | `invoke`                            | ★☆☆☆☆ (niche usage)                     |
| `moon.yml`                 | Moonrepo (Monorepo)       | `moon run`                          | ★☆☆☆☆ (modern monorepo setups)          |
| `turbo.json`               | Turborepo                 | `turbo run`                         | ★☆☆☆☆ (rising in frontend monorepos)    |
| `nx.json`                  | NX                        | `nx run`                            | ★☆☆☆☆ (used in Angular/React monorepos) |

Sorted by **observed popularity in GitHub OSS projects**, focused on repositories with developer-invoked task configs.

### 7 ) CI/CD Workflow Integration

- **Objective**: Provide automated CI/CD workflow templates for unsealing vaulted items in GitHub Actions.
- Create workflow templates that users can install to automatically unseal vaulted items in CI
- Support two authentication methods:
  - File-based password/key stored as GitHub Secret
  - 1Password integration using `1password/load-secrets-action@v2` for seamless secret management
- Workflow should:
  - Install `gv` in the runner
  - Configure authentication (file-based or 1Password)
  - Unseal specified vaulted items
  - Clean up secrets after use
- Provide clear documentation and examples for both authentication methods
- Include security best practices and warnings about secret management
- Add tests that verify the workflow templates work in CI environment
- Consider adding a command like `gv workflow install` that helps users set up the CI integration

## Completed TODOs

Once TODOs are fully implemented, tested, and documented, move them here for future reference. TODOs in this section no longer need to be implemented and are kept for historical reasons.

### Rename Install to Init

- **Objective**: For the user and within this codebase, completely change terminology from 'install' to 'init'.
- The install command is now 'init'
- Code comments and methods use 'init' instead of 'install'
- Documentation has been updated to reflect this
- The only time 'install' is used is when it comes to specific "install" commands of third parties or terminal commands for things that AREN'T git-vault.

### Single Folder for Git Vault

- **Objective**: Reduce clutter in the user's project by centralizing all things related to git-vault(except the git hooks) to a single folder.
- The single folder on the user's project stores: all `.sh` scripts that are installed, `paths.list`, the main `README.md` of git-vault, and a subfolder for storage.
- Name the folder `.vault` and the storage subfolder `.vault/storage`.
- Update all and tests/docs to reflect the new design.
