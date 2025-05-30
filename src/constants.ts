export const COMMAND_DESCRIPTIONS = {
  add: 'Add a file or directory to gv',
  remove: 'Remove a file or directory from gv',
  list: 'List all files and directories managed by gv',
  version: 'Show gv version',
  uninstall: 'Uninstall gv from your system',
  encrypt: 'Encrypt all managed files',
  decrypt: 'Decrypt all managed files',
} as const

export const DEFAULT_CONFIG_VERSION = 1
export const DEFAULT_LFS_THRESHOLD_MB = 5
export const DEFAULT_1PASSWORD_VAULT = 'Git-Vault'

export const VAULT_TASKS = {
  ADD: 'vault:add',
  REMOVE: 'vault:remove',
  LIST: 'vault:list',
  ENCRYPT: 'vault:encrypt',
  DECRYPT: 'vault:decrypt',
} as const

export const MAKEFILE_TASKS = {
  ADD: 'vault-add',
  REMOVE: 'vault-remove',
  LIST: 'vault-list',
  ENCRYPT: 'vault-encrypt',
  DECRYPT: 'vault-decrypt',
} as const

export const MAKEFILE_SECTION_MARKER = '# Git-Vault tasks'

export const VSCODE_TASK_DEFAULTS = {
  VERSION: '2.0.0',
  TYPE: 'shell',
  ARGS: [],
  PROBLEM_MATCHER: [],
} as const

export const NX_EXECUTOR = 'nx:run-commands'

export const FORMATTING_OPTIONS = {
  insertSpaces: true,
  tabSize: 2,
} as const
