import { dedent } from '@qnighy/dedent'
import { parseArgs } from '@std/cli'
import { bold, cyan, green, yellow } from '@std/fmt/colors'
import { join } from '@std/path/join'
import { resolve } from '@std/path'
import { exists } from '@std/fs'
import add from './commands/add.ts'
import remove from './commands/remove.ts'
import list from './commands/list.ts'
import version from './commands/version.ts'
import uninstall from './commands/uninstall.ts'
import gracefulShutdown from './utils/graceful-shutdown.ts'
import terminal from './utils/terminal.ts'
import { COMMAND_DESCRIPTIONS } from './constants.ts'
import { PATHS } from './paths.ts'
import type { CommandName, CommandRegistry } from './types.ts'

Deno.env.set('GV_VERSION', '0.0.5')

// IMPORTANT: Production is the default, must be overridden in tests/development/integration tests
if (!Deno.env.get('DENO_ENV')) {
  Deno.env.set('DENO_ENV', 'production')
}

const options = {
  alias: {
    a: 'add',
    r: 'remove',
    rm: 'remove',
    l: 'list',
    ls: 'list',
    v: 'version',
    h: 'help',
    w: 'workspace',
    u: 'uninstall',
  },
  string: ['workspace'],
  boolean: ['help', 'version'],
  default: {
    workspace: Deno.cwd(),
  },
  stopEarly: false,
}

const handlers: CommandRegistry = {
  add,
  remove,
  list,
  version,
  uninstall,
}

function printHelp() {
  console.log(dedent`
    ${bold('Git Vault - Secure file encryption for Git repositories')}

    ${bold('Usage:')} gv ${cyan('<command>')} ${yellow('[options]')}

    ${bold('Commands:')}
      add       ${COMMAND_DESCRIPTIONS.add}
      remove    ${COMMAND_DESCRIPTIONS.remove}
      list      ${COMMAND_DESCRIPTIONS.list}
      version   ${COMMAND_DESCRIPTIONS.version}
      uninstall ${COMMAND_DESCRIPTIONS.uninstall}

    ${bold('Global Options:')}
      --workspace, -w  Path to the Git repository (default: current directory)
                       All commands operate relative to this workspace

    ${bold('Examples:')}
      gv .env                            # Shorthand for: gv add .env
      gv add .env                        # Add a single file
      gv add config                      # Add a directory named config
      gv remove secrets.txt              # Remove a file
      gv list                            # List all vault files in specific workspace

    Run "gv ${cyan('<command>')} ${yellow('--help')}" for more information on a specific command.
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
  if (Deno.env.get('DENO_ENV') !== 'development') return runCommand(args)

  const setupTempDir = async () => {
    const tempDir = await Deno.makeTempDir({ prefix: `${PATHS.BASE_NAME}-dev-` })
    const originalCwd = Deno.cwd()

    console.log(green(`Development Mode. Temporary workspace directory: ${tempDir}`))
    Deno.chdir(tempDir)

    gracefulShutdown.addShutdownHandler(() => {
      try {
        console.log(`Cleaning up temporary directory: ${tempDir}`)
        Deno.chdir(originalCwd)
        Deno.removeSync(tempDir, { recursive: true })
      } catch (error) {
        terminal.error('Failed to clean up temporary directory:', error)
      }
    })

    await new Deno.Command('git', { args: ['init'] }).output()
    await Deno.writeTextFile(join(tempDir, 'README.md'), '')

    return tempDir
  }

  const tempDir = await setupTempDir()
  const modifiedArgs = [
    ...args.filter((arg) => !arg.startsWith('--workspace') && !arg.startsWith('-w')),
    '--workspace',
    tempDir,
  ]

  await runCommand(modifiedArgs)
}

async function runCommand(args: string[]) {
  const parsed = parseArgs(args, options)
  const workspace = resolve(parsed.workspace as string)
  const [command, ...rest] = parsed._.map(String)

  if (parsed.help || command === 'help') return printHelp()
  if (parsed.version) return handlers.version({ workspace })
  if (!command) return printHelp()

  const handleConflict = async (cmd: string) => {
    const hasConflict = await checkCommandPathConflict(cmd, workspace)
    if (!hasConflict) return false

    console.log(dedent`
      ${bold(`'${cyan(cmd)}' is both a command name and an existing file/directory.`)}
      ${bold('Please specify which one you want to use:')}
    `)

    const choice = terminal.createPromptSelect(
      'What would you like to do?',
      [`Run the '${cyan(cmd)}' command`, `Add '${cyan(cmd)}' to gv`],
    )

    return choice.includes(`Add '${cmd}' to gv`)
  }

  let cmd = command as CommandName

  if (cmd in handlers) {
    const shouldAddFile = await handleConflict(cmd)
    if (shouldAddFile) {
      rest.unshift(cmd)
      return handlers.add({ workspace, item: rest[0] })
    }
  } else if (cmd && !cmd.startsWith('-')) {
    rest.unshift(cmd)
    cmd = 'add'
  }

  if (!(cmd in handlers)) {
    console.error(dedent`${bold(`Unknown command: ${cyan(command)}`)}`)
    return printHelp()
  }

  await handlers[cmd]({ workspace, item: rest[0] })
}

if (import.meta.main) {
  gracefulShutdown.startAndWrap(main)
}

export default main
