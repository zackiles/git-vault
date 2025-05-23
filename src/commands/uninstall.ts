import { dirname, join } from '@std/path'
import { exists } from '@std/fs'
import terminal from '../utils/terminal.ts'
import type { CommandArgs, CommandHandler } from '../types.ts'
import { getElevationInstructions, PATHS } from '../paths.ts'

/**
 * Attempt to remove a file with appropriate error handling
 */
async function attemptRemove(filePath: string, isMainExecutable = false) {
  try {
    if (await exists(filePath)) {
      await Deno.remove(filePath)
      terminal.info('Successfully removed:', filePath)
    }
  } catch (error) {
    terminal.warn(
      `Could not remove ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    )

    if (error instanceof Deno.errors.PermissionDenied) {
      console.warn(getElevationInstructions())
    } else if (isMainExecutable && Deno.build.os === 'windows') {
      terminal.warn(
        `If ${filePath} is still present, it might be locked. Please delete it manually after this command finishes.`,
      )
    }
  }
}

/**
 * Find the gv alias/symlink in common locations
 */
async function findAlias(execPath: string, binaryBaseName: string): Promise<string | null> {
  const execDir = dirname(execPath)
  const binaryName = PATHS.getBinaryName(binaryBaseName)

  const aliasInExecDir = join(execDir, binaryName)
  if (await exists(aliasInExecDir)) {
    try {
      const realAliasPath = await Deno.realPath(aliasInExecDir)
      if (realAliasPath === execPath) return aliasInExecDir

      if (realAliasPath === aliasInExecDir) {
        return aliasInExecDir
      }
    } catch {
      // Ignore errors, might not be a symlink
    }
  }

  for (const dir of PATHS.getBinaryDirs()) {
    const potentialAliasPath = join(dir, binaryName)
    if (await exists(potentialAliasPath)) {
      try {
        if (await Deno.realPath(potentialAliasPath) === execPath) {
          return potentialAliasPath
        }
      } catch {
        // Ignore errors
      }
    }
  }
  return null
}

/**
 * Run a system command and return its output
 */
async function runCommand(command: string, args: string[]) {
  const process = new Deno.Command(command, {
    args,
    stdout: 'piped',
    stderr: 'piped',
  })

  const { code, stdout, stderr } = await process.output()
  const output = new TextDecoder().decode(stdout)
  const error = new TextDecoder().decode(stderr)

  return { code, output, error }
}

/**
 * Uninstalls gv from the system
 */
async function run(_args: CommandArgs): Promise<void> {
  const execPath = Deno.execPath()

  const confirmed = terminal.createConfirm(
    'This will uninstall gv from your system. Continue?',
    false,
  )

  if (!confirmed) {
    terminal.status('Uninstallation cancelled.')
    return
  }

  terminal.info('Attempting to uninstall gv from:', execPath)

  if (PATHS.isInstalledByHomebrew(execPath)) {
    terminal.status(
      `${PATHS.BASE_NAME} appears to be installed via Homebrew. Attempting to run 'brew uninstall ${PATHS.BASE_NAME}'...`,
    )

    const { code, error } = await runCommand('brew', ['uninstall', PATHS.BASE_NAME])
    if (code === 0) {
      terminal.success(`Successfully uninstalled ${PATHS.BASE_NAME} via Homebrew.`)
    } else {
      terminal.error(`Failed to uninstall ${PATHS.BASE_NAME} via Homebrew:`, error)
    }
    return
  }

  if (Deno.build.os === 'windows' && PATHS.isInstalledByChocolatey(execPath)) {
    terminal.status(
      `${PATHS.BASE_NAME} appears to be installed via Chocolatey. Attempting to run 'choco uninstall ${PATHS.BASE_NAME}'...`,
    )

    const { code, error } = await runCommand('choco', ['uninstall', PATHS.BASE_NAME, '-y'])
    if (code === 0) {
      terminal.success(`Successfully uninstalled ${PATHS.BASE_NAME} via Chocolatey.`)
    } else {
      terminal.error(`Failed to uninstall ${PATHS.BASE_NAME} via Chocolatey:`, error)
    }
    return
  }

  terminal.status(`Attempting to uninstall manually installed ${PATHS.BASE_NAME}...`)

  const aliasPath = await findAlias(execPath, PATHS.BASE_NAME)
  if (aliasPath) {
    await attemptRemove(aliasPath)
  } else {
    terminal.warn(
      `Could not find a '${PATHS.BASE_NAME}' alias/symlink associated with this ${PATHS.BASE_NAME} installation.`,
    )
  }

  await attemptRemove(execPath, true)

  terminal.section('Uninstallation process finished.')

  terminal.status(`If ${PATHS.BASE_NAME} commands are still found, you might need to:`)
  terminal.status('- Manually delete the files if warnings occurred above', ' ')
  terminal.status(
    "- Open a new terminal session or clear your shell's command cache (e.g., 'hash -r')",
    ' ',
  )

  terminal.status('To remove git-vault from a specific project:')
  terminal.status('- Remove the .vault directory', ' ')
  terminal.status(`- Remove git hooks installed by ${PATHS.BASE_NAME}`, ' ')
  terminal.status(`- Remove ${PATHS.BASE_NAME}-related entries from .gitignore`, ' ')
}

export default run satisfies CommandHandler
