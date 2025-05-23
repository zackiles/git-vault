// A single type containing all command names
type CommandName = 'add' | 'remove' | 'list' | 'version' | 'uninstall'

// Command arguments with workspace always defined
type CommandArgs = {
  workspace: string
  item?: string
  [key: string]: unknown
}

// Command functions that take args and return void
type CommandHandler = (args: CommandArgs) => Promise<void> | void

// Command registry
type CommandRegistry = Record<CommandName, CommandHandler>

type ManagedPath = {
  hash: string
  path: string
  // Track which project config files have Git-Vault tasks added
  addedTasks?: {
    file: string // e.g., 'package.json', 'deno.json'
  }[]
}

type GitVaultConfig = {
  version: number // For future schema migrations
  storageMode: 'file' | '1password'
  lfsThresholdMB: number
  onePasswordVault?: string // Optional, only if storageMode is "1password"
  managedPaths: ManagedPath[]
}

export type {
  CommandArgs,
  CommandHandler,
  CommandName,
  CommandRegistry,
  GitVaultConfig,
  ManagedPath,
}
