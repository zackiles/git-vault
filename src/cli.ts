import { dedent } from '@qnighy/dedent'
import { parseArgs } from '@std/cli'
import { bold, cyan, green, yellow } from '@std/fmt/colors'
import { join } from '@std/path/join'
import { exists } from '@std/fs'
import add from './commands/add.ts'
import remove from './commands/remove.ts'
import list from './commands/list.ts'
import init from './commands/init.ts'
import version from './commands/version.ts'
import gracefulShutdown from './utils/graceful-shutdown.ts'
import terminal from './utils/terminal.ts'
import { COMMAND_DESCRIPTIONS } from './constants.ts'
import type { BaseCommandArgs, CLIOptions, CommandName, CommandRegistry } from './types.ts'

// IMPORTANT: Production is the default, must be overridden in tests/development/integration tests
if (!Deno.env.get('DENO_ENV')) {
  Deno.env.set('DENO_ENV', 'production')
}

const options: CLIOptions = {
  alias: {
    a: 'add',
    r: 'remove',
    rm: 'remove',
    l: 'list',
    ls: 'list',
    i: 'init',
    install: 'init',
    v: 'version',
    h: 'help',
    w: 'workspace',
  },
  string: ['workspace'],
  boolean: ['help', 'version', 'continueInstall'], // NOTE: continueInstall is used for self-replication during initial install
  default: {
    workspace: '.',
  },
  stopEarly: false,
}

// Map command names to handlers
const handlers: CommandRegistry = {
  add,
  remove,
  list,
  init,
  version,
}

function printHelp() {
  console.log(dedent`
    ${bold('Git Vault - Secure file encryption for Git repositories')}

    ${bold('Usage:')} gv ${cyan('<command>')} ${yellow('[options]')}

    ${bold('Commands:')}
      add      ${COMMAND_DESCRIPTIONS.add}
      remove   ${COMMAND_DESCRIPTIONS.remove}
      list     ${COMMAND_DESCRIPTIONS.list}
      init     ${COMMAND_DESCRIPTIONS.init}
      version  ${COMMAND_DESCRIPTIONS.version}

    ${bold('Global Options:')}
      --workspace, -w  Path to the Git repository (default: current directory)
                       All commands operate relative to this workspace

    ${bold('Examples:')}
      gv .env                            # Shorthand for: gv add .env
      gv add .env                        # Add a single file
      gv add config                      # Add a directory named config
      gv remove secrets.txt              # Remove a file
      gv list                            # List all vault files in specific workspace
      gv init                            # Initialize git-vault hooks

    Run "gv ${cyan('<command>')} ${yellow('--help')}" or "git-vault ${cyan('<command>')} ${
    yellow('--help')
  }" for more information on a specific command.
  `)
}

/**
 * Check if a potential command name conflicts with an existing file or directory
 */
async function checkCommandPathConflict(cmd: string, workspace: string): Promise<boolean> {
  try {
    const resolvedPath = join(workspace, cmd)
    return await exists(resolvedPath)
  } catch {
    return false
  }
}

async function main(args: string[] = Deno.args): Promise<void> {
  let tempDir: string | undefined
  let originalCwd: string | undefined

  // Development mode setup
  if (Deno.env.get('DENO_ENV') === 'development') {
    // Create a temporary directory
    tempDir = await Deno.makeTempDir({ prefix: 'git-vault-dev-' })
    console.log(green(`Development Mode. Temporary workspace directory: ${tempDir}`))

    // Change to the temporary directory
    originalCwd = Deno.cwd()
    Deno.chdir(tempDir)

    // Add shutdown handler to clean up temporary directory
    gracefulShutdown.addShutdownHandler(() => {
      if (tempDir) {
        try {
          console.log(`Cleaning up temporary directory: ${tempDir}`)
          if (originalCwd) Deno.chdir(originalCwd)
          Deno.removeSync(tempDir, { recursive: true })
        } catch (error) {
          console.error(
            `Failed to clean up temporary directory: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }
    })

    // Initialize git repository
    const gitInitProcess = new Deno.Command('git', { args: ['init'] })
    await gitInitProcess.output()

    // Create blank README.md
    await Deno.writeTextFile(join(tempDir, 'README.md'), '')
  }

  // Run the command
  await runCommand(args)

  // Restore original directory in development mode when not using graceful shutdown
  if (Deno.env.get('DENO_ENV') === 'development' && originalCwd) {
    Deno.chdir(originalCwd)
  }
}

async function runCommand(args: string[]) {
  const parsed = parseArgs(args, options)
  const [command, ...rest] = parsed._.map(String)

  // Help/version flags (global)
  if (parsed.help || command === 'help') {
    printHelp()
    return
  }
  if (parsed.version) {
    await handlers.version.run({ _: [] })
    return
  }

  // If no command, print help
  if (!command) {
    printHelp()
    return
  }

  // Check for potential path/command conflicts
  if (command in handlers) {
    const hasConflict = await checkCommandPathConflict(command, parsed.workspace as string)
    if (hasConflict) {
      console.log(dedent`
        ${bold(`'${cyan(command)}' is both a command name and an existing file/directory.`)}
        ${bold('Please specify which one you want to use:')}
      `)

      const displayOptions = [
        `Run the '${cyan(command)}' command`,
        `Add '${cyan(command)}' to git-vault`,
      ]

      const choice = terminal.promptSelect(
        'What would you like to do?',
        displayOptions,
      )

      if (choice.includes(`Add '${command}' to git-vault`)) {
        // Treat as a path instead of a command
        rest.unshift(command)
        await handlers.add.run({ ...parsed, _: rest })
        return
      }
      // Otherwise continue with command execution
    }
  }

  // If the command is not recognized, default to 'add' if it's a path
  let cmd = command as CommandName
  if (!(cmd in handlers) && cmd && !cmd.startsWith('-')) {
    // If the first argument is a path, use the add command by default
    rest.unshift(cmd)
    cmd = 'add'
  }

  if (!(cmd in handlers)) {
    console.error(dedent`${bold(`Unknown command: ${cyan(command)}`)}`)
    printHelp()
    return
  }

  // Prepare arguments for the handler
  const handlerArgs: BaseCommandArgs = { ...parsed, _: rest }
  await handlers[cmd].run(handlerArgs)
}

if (import.meta.main) {
  gracefulShutdown.startAndWrap(() => main())
}

export default main
