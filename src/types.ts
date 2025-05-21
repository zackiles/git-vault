import type { ParseOptions } from '@std/cli'

const COMMANDS = ['add', 'remove', 'list', 'init', 'version'] as const
export type CommandName = typeof COMMANDS[number]

export type CLIOptions = ParseOptions & {
  workspace?: string
}

export type BaseCommandArgs = {
  _: string[]
  workspace?: string
  continueInstall?: boolean
} & Record<string, unknown>

// Command handler type
export type CommandHandler = {
  run: (args: BaseCommandArgs) => Promise<void>
}

// Command registry type derived from command names
export type CommandRegistry = Record<CommandName, CommandHandler>

// Command definition derived from existing values
export type Command = {
  name: CommandName
  description: string
  aliases?: string[]
  handler: CommandHandler['run']
  args?: Array<{
    name: string
    description: string
    required?: boolean
    positional?: boolean
    default?: unknown
  }>
}

export type ManagedPath = {
  hash: string
  path: string
}

export type GitVaultConfig = {
  version: number // For future schema migrations
  storageMode: 'file' | '1password'
  lfsThresholdMB: number
  onePasswordVault?: string // Optional, only if storageMode is "1password"
  managedPaths: ManagedPath[]
}

export const DEFAULT_CONFIG_VERSION = 1
export const DEFAULT_LFS_THRESHOLD_MB = 5
export const DEFAULT_1PASSWORD_VAULT = 'Git-Vault'

export { COMMANDS }
