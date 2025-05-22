import { dirname, join } from '@std/path'
import { exists } from '@std/fs'
import { dedent } from '@qnighy/dedent'
import { bold, cyan } from '@std/fmt/colors'
import terminal from '../utils/terminal.ts'
import type { CommandHandler } from '../types.ts'
import { getElevationInstructions, PATHS } from '../paths.ts'

const isWindows = Deno.build.os === 'windows'

/**
 * Attempt to remove a file with appropriate error handling
 */
async function attemptRemove(filePath: string, isMainExecutable = false) {
  try {
    if (await exists(filePath)) {
      await Deno.remove(filePath)
      console.log(`Successfully removed: ${filePath}`)
    }
  } catch (error) {
    console.warn(
      `Could not remove ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    )
    if (error instanceof Deno.errors.PermissionDenied) {
      console.warn(getElevationInstructions())
    } else if (isMainExecutable && isWindows) {
      console.warn(
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
async function run(): Promise<void> {
  const execPath = Deno.execPath()

  const confirmed = terminal.confirm(
    dedent`${bold('This will uninstall gv from your system.')} Continue?`,
    false,
  )

  if (!confirmed) {
    console.log(dedent`${bold('Uninstallation cancelled.')}`)
    return
  }

  console.log(`Attempting to uninstall gv from: ${execPath}`)

  if (PATHS.isInstalledByHomebrew(execPath)) {
    console.log(
      dedent`gv appears to be installed via Homebrew. Attempting to run 'brew uninstall gv'...`,
    )
    const { code, error } = await runCommand('brew', ['uninstall', 'gv'])
    if (code === 0) {
      console.log(dedent`Successfully uninstalled gv via Homebrew.`)
    } else {
      console.error(dedent`Failed to uninstall gv via Homebrew:`, error)
    }
    return
  }

  if (isWindows && PATHS.isInstalledByChocolatey(execPath)) {
    console.log(
      dedent`gv appears to be installed via Chocolatey. Attempting to run 'choco uninstall gv'...`,
    )
    const { code, error } = await runCommand('choco', ['uninstall', 'gv', '-y'])
    if (code === 0) {
      console.log(dedent`Successfully uninstalled gv via Chocolatey.`)
    } else {
      console.error(dedent`Failed to uninstall gv via Chocolatey:`, error)
    }
    return
  }

  console.log(dedent`Attempting to uninstall manually installed gv...`)

  const aliasPath = await findAlias(execPath, PATHS.BASE_NAME)
  if (aliasPath) {
    await attemptRemove(aliasPath)
  } else {
    console.log(dedent`Could not find a 'gv' alias/symlink associated with this gv installation.`)
  }

  await attemptRemove(execPath, true)

  console.log(dedent`
    ${bold('Uninstallation process finished.')}

    If gv commands are still found, you might need to:
      - Manually delete the files if warnings occurred above
      - Open a new terminal session or clear your shell's command cache (e.g., 'hash -r')

    To remove git-vault from a specific project:
      - Remove the ${cyan('.vault')} directory
      - Remove git hooks installed by gv
      - Remove gv-related entries from ${cyan('.gitignore')}
  `)
}

export default run satisfies CommandHandler
