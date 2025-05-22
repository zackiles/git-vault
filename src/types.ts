import type { ParseOptions } from '@std/cli'

const COMMANDS = ['add', 'remove', 'list', 'version', 'uninstall'] as const
type CommandName = typeof COMMANDS[number]

type CLIOptions = ParseOptions & {
  workspace?: string
}

type BaseCommandArgs = {
  _: string[]
  workspace?: string
} & Record<string, unknown>

// Command handler type is directly a function type
type CommandHandler = (args: BaseCommandArgs) => Promise<void> | void

// Command registry type derived from command names
type CommandRegistry = Record<CommandName, CommandHandler>

// Command definition derived from existing values
type Command = {
  name: CommandName
  description: string
  aliases?: string[]
  handler: CommandHandler
  args?: Array<{
    name: string
    description: string
    required?: boolean
    positional?: boolean
    default?: unknown
  }>
}

type ManagedPath = {
  hash: string
  path: string
}

type GitVaultConfig = {
  version: number // For future schema migrations
  storageMode: 'file' | '1password'
  lfsThresholdMB: number
  onePasswordVault?: string // Optional, only if storageMode is "1password"
  managedPaths: ManagedPath[]
}

export type {
  BaseCommandArgs,
  CLIOptions,
  Command,
  CommandHandler,
  CommandName,
  CommandRegistry,
  GitVaultConfig,
  ManagedPath,
}
