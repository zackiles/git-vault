import { join, resolve } from '@std/path'
import { copy, ensureDir, exists } from '@std/fs'
import { bold, cyan, yellow } from '@std/fmt/colors'
import terminal from '../utils/terminal.ts'
import type { BaseCommandArgs, CommandHandler } from '../types.ts'
import {
  configureLfs,
  initLfs,
  installHooks,
  isGitRepository,
  isLfsAvailable,
  stageFile,
  updateGitignore,
} from '../services/git.ts'
import { isGpgAvailable } from '../services/gpg.ts'
import { getVaults, isOpAvailable, isSignedIn } from '../services/op.ts'
import { dedent } from '@qnighy/dedent'
import { createDefaultConfig, writeGitVaultConfig } from '../utils/config.ts'
import { DEFAULT_1PASSWORD_VAULT } from '../types.ts'
import { COMMAND_DESCRIPTIONS } from '../constants.ts'

/**
 * Gets the appropriate bin directory for the current platform
 */
async function getBinPath(): Promise<string> {
  // In test mode, use the first directory in PATH environment variable
  if (Deno.env.get('DENO_ENV') === 'test') {
    const path = Deno.env.get('PATH') || ''
    const firstPath = path.split(Deno.build.os === 'windows' ? ';' : ':')[0]

    if (firstPath) {
      return firstPath
    }
    // Fall through to normal behavior if PATH is empty or not set
  }

  const homeDir = Deno.env.get('HOME') || Deno.env.get('USERPROFILE')
  if (!homeDir) {
    throw new Error('Could not determine user home directory')
  }

  switch (Deno.build.os) {
    case 'windows': {
      // On Windows, we'll use %USERPROFILE%\AppData\Local\Microsoft\WindowsApps
      return join(homeDir, 'AppData', 'Local', 'Microsoft', 'WindowsApps')
    }
    case 'darwin': {
      // On macOS, we'll use ~/bin if it exists, otherwise ~/.local/bin
      const macBin = join(homeDir, 'bin')
      const macLocalBin = join(homeDir, '.local', 'bin')
      return await exists(macBin) ? macBin : macLocalBin
    }
    default: {
      // On Linux and other Unix-like systems, use ~/.local/bin
      return join(homeDir, '.local', 'bin')
    }
  }
}

/**
 * Checks if git-vault binary exists on the PATH
 */
async function isGitVaultOnPath(): Promise<boolean> {
  // Define binary name once based on OS
  const binaryName = Deno.build.os === 'windows' ? 'gv.exe' : 'gv'

  // In test mode with tempDir path, we should not assume git-vault is already installed
  if (Deno.env.get('DENO_ENV') === 'test') {
    // Check if the binary exists in the first PATH directory specifically
    const path = Deno.env.get('PATH') || ''
    const firstPath = path.split(Deno.build.os === 'windows' ? ';' : ':')[0]
    if (firstPath) {
      return await exists(join(firstPath, binaryName))
    }
  }

  // Normal check for other environments
  try {
    const cmd = new Deno.Command(
      Deno.build.os === 'windows' ? 'where' : 'which',
      { args: [binaryName] },
    )
    const { success } = await cmd.output()
    return success
  } catch {
    return false
  }
}

/**
 * Get the path to the current executable
 */
function getCurrentExecutable(): string {
  // In development or test mode, use the current script path
  if (Deno.env.get('DENO_ENV') === 'development' || Deno.env.get('DENO_ENV') === 'test') {
    const mainModule = new URL(import.meta.url).pathname
    // Find the main script path (src/cli.ts)
    const srcPath = mainModule.split('/src/')[0]
    return resolve(join(srcPath, 'src', 'cli.ts'))
  }

  // In production, this will be the path to the executable
  return Deno.execPath()
}

/**
 * Copies the git-vault binary to the global PATH
 */
async function installGlobalBinary(binPath: string): Promise<string> {
  await ensureDir(binPath)

  const currentExe = getCurrentExecutable()
  const targetPath = join(binPath, Deno.build.os === 'windows' ? 'gv.exe' : 'gv')

  if (Deno.env.get('DENO_ENV') === 'test' || Deno.env.get('DENO_ENV') === 'development') {
    // In test/dev mode, create a shell script or batch file that calls the Deno script
    if (Deno.build.os === 'windows') {
      await Deno.writeTextFile(
        targetPath,
        `@echo off
deno run -A "${currentExe}" %*`,
      )
    } else {
      await Deno.writeTextFile(
        targetPath,
        `#!/bin/sh
deno run -A "${currentExe}" "$@"`,
      )
    }
  } else {
    // In production mode, actually copy the binary
    await copy(currentExe, targetPath, { overwrite: true })
  }

  await Deno.chmod(targetPath, 0o755) // Make executable

  return targetPath
}

/**
 * Creates a symlink for the git-vault command
 * @param binPath The path to create the symlink in
 * @param gvPath The path to the gv executable
 */
async function createGitVaultSymlink(binPath: string, gvPath: string): Promise<void> {
  try {
    const gitVaultPath = join(binPath, Deno.build.os === 'windows' ? 'git-vault.exe' : 'git-vault')

    // Create the bin directory if it doesn't exist
    await ensureDir(binPath)

    // Create the symlink
    try {
      if (Deno.build.os === 'windows') {
        // On Windows, we need to ensure the target has .exe extension
        const targetPath = gvPath.endsWith('.exe') ? gvPath : `${gvPath}.exe`
        await Deno.writeTextFile(
          gitVaultPath,
          dedent`
          @echo off
          "${targetPath}" %*
        `,
        )
      } else {
        await Deno.symlink(gvPath, gitVaultPath, { type: 'file' })
        await Deno.chmod(gitVaultPath, 0o755) // Make executable
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        // Symlink/batch file already exists, that's fine
        return
      }
      throw error
    }
  } catch (error) {
    console.log(
      dedent`Note: Could not create 'git-vault' command: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    console.log(dedent`You can create it manually by linking 'git-vault' to the gv executable.`)
  }
}

/**
 * Init command implementation
 *
 * Sets up git-vault in a Git repository
 */
async function initCommand(args: BaseCommandArgs): Promise<void> {
  // Check if this is a re-launched process for global install
  const isGlobalInstallProcess = args.continueInstall === true

  try {
    // Use workspace parameter or fallback to specified directory
    const targetDir = args._[0] || args.workspace as string || '.'
    const resolvedPath = resolve(targetDir)

    // Check if directory exists
    try {
      const stat = await Deno.stat(resolvedPath)
      if (!stat.isDirectory) {
        terminal.error(`'${targetDir}' is not a directory`)
        return
      }
    } catch {
      terminal.error(`'${targetDir}' does not exist`)
      return
    }

    // Check if it's a Git repository
    if (!(await isGitRepository(resolvedPath))) {
      terminal.error(`'${targetDir}' is not a Git repository`)
      return
    }

    // Handle global installation flag for tests
    if (args.global === true) {
      try {
        // Check if git-vault is already on PATH
        if (await isGitVaultOnPath()) {
          console.log(dedent`git-vault is already installed globally. Skipping installation.`)
          return
        }

        // Get the path to install to
        const binPath = await getBinPath()

        console.log(dedent`Installing git-vault globally to ${binPath}...`)

        // Install the binary
        const installedPath = await installGlobalBinary(binPath)

        // Create the git-vault symlink
        await createGitVaultSymlink(binPath, installedPath)

        console.log(dedent`Global installation complete.`)
      } catch (error) {
        console.log(
          dedent`Note: Could not install git-vault globally: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }

    // Check for dependency availability
    console.log(dedent`${bold('Checking dependencies...')}`)

    if (!(await isGpgAvailable())) {
      terminal.error('GPG is not available')
      console.log(dedent`Please install ${cyan('GPG')} and try again.`)
      return
    }

    // Define paths
    const gitVaultDir = join(resolvedPath, '.vault')
    const storageDir = join(gitVaultDir, 'storage')
    // Initialize config with default values
    const config = createDefaultConfig()

    // Check if already installed
    if (await exists(gitVaultDir)) {
      const confirmed = terminal.confirm(
        `${bold('git-vault is already initialized.')} Do you want to re-configure it?`,
        false,
      )
      if (!confirmed) {
        console.log(dedent`${bold('Initialization cancelled.')}`)
        return
      }
    }

    console.log(dedent`${bold('Creating .vault directory...')}`)
    await ensureDir(gitVaultDir)
    await ensureDir(storageDir)

    // Check 1Password availability for storage mode selection
    if (await isOpAvailable()) {
      console.log(dedent`1Password CLI detected.`)

      const use1Password = terminal.confirm(
        'Would you like to use 1Password for password storage instead of local files?',
        false,
      )

      if (use1Password) {
        console.log(dedent`Checking 1Password sign-in status...`)

        if (!(await isSignedIn())) {
          terminal.error('Not signed in to 1Password CLI')
          console.log(dedent`Please sign in using "op signin" and try again.`)
          return
        }

        console.log(dedent`Sign-in status verified.`)
        config.storageMode = '1password'

        // Get available vaults
        const vaults = await getVaults()

        if (vaults.length === 0) {
          terminal.error('No 1Password vaults found')
          console.log(dedent`Please create at least one vault in 1Password and try again.`)
          return
        }

        // Let user select a vault or enter a custom name
        console.log(dedent`Available 1Password vaults:`)
        for (let i = 0; i < vaults.length; i++) {
          console.log(`  ${i + 1}. ${vaults[i]}`)
        }
        console.log(dedent`  0. Enter a custom vault name`)

        // Ask user to select a vault
        const selection = terminal.promptSelect(
          'Select a 1Password vault to use:',
          [...vaults, 'Enter a custom vault name'],
        ) || vaults[0] || DEFAULT_1PASSWORD_VAULT // Fallback to first vault or default name

        if (selection === 'Enter a custom vault name') {
          const customVault = terminal.promptInput(
            'Enter the vault name: ',
            DEFAULT_1PASSWORD_VAULT,
          )
          config.onePasswordVault = customVault // promptInput always returns a string
        } else {
          config.onePasswordVault = selection
        }

        console.log(dedent`Using 1Password vault: '${config.onePasswordVault}'`)
      } else {
        console.log(dedent`Using file-based password storage.`)
      }
    } else {
      console.log(dedent`1Password CLI not detected. Using default file-based password storage.`)
    }

    console.log(dedent`Storage mode ('${config.storageMode}') saved.`)

    // Configure Git LFS if available
    console.log(dedent`Checking for Git LFS support...`)
    console.log(dedent`LFS threshold set to ${config.lfsThresholdMB}MB.`)

    if (await isLfsAvailable()) {
      console.log(dedent`Git LFS detected. Setting up LFS for git-vault...`)

      // Initialize Git LFS in the repository
      await initLfs(resolvedPath)

      // Configure LFS tracking pattern
      await configureLfs(resolvedPath, '.vault/storage/*.tar.gz.gpg')

      console.log(dedent`Git LFS configured for git-vault archives.`)
    } else {
      console.log(dedent`Git LFS not detected. Large files will be stored directly in Git.`)
      console.log(dedent`For better performance with large files, consider installing Git LFS.`)
    }

    // Save the config file
    await writeGitVaultConfig(resolvedPath, config)

    // Update .gitignore
    console.log(dedent`Updating .gitignore...`)

    const pwIgnorePattern = '.vault/*.pw'
    const pw1pIgnorePattern = '.vault/*.pw.1p'

    await updateGitignore(resolvedPath, [pwIgnorePattern, pw1pIgnorePattern])

    // Install Git hooks
    console.log(dedent`Installing Git hooks...`)

    const hooks = await installHooks(resolvedPath, gitVaultDir)

    if (hooks) {
      console.log(dedent`Git hooks installed successfully.`)
    } else {
      console.log(
        dedent`Warning: Failed to install Git hooks. You may need to install them manually.`,
      )
    }

    // If this is a global install, skip creating symlinks since we already did that
    if (!isGlobalInstallProcess) {
      // Create git-vault symlink
      try {
        const binPath = await getBinPath()
        const gvPath = getCurrentExecutable()

        // Check if gv is already on PATH before creating symlink
        if (!await isGitVaultOnPath()) {
          // Only create symlink in non-global installs or in development mode
          if (Deno.env.get('DENO_ENV') !== 'production' || !isGlobalInstallProcess) {
            await createGitVaultSymlink(binPath, gvPath)
          }
        }
      } catch (error) {
        console.log(
          dedent`Note: Could not determine bin path: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        console.log(
          dedent`You can create the 'git-vault' command manually by linking it to the gv executable.`,
        )
      }
    }

    // Stage files for commit
    console.log(dedent`Staging git-vault files...`)

    const filesToStage = [
      '.gitignore',
      '.vault/config.json',
    ]

    for (const file of filesToStage) {
      await stageFile(file)
    }

    // Success message
    terminal.success(bold('git-vault initialized successfully!'))
    console.log(`${bold('Storage mode:')} ${cyan(config.storageMode)}`)

    if (config.storageMode === '1password') {
      console.log(
        `${bold('Using 1Password vault:')} '${
          cyan(config.onePasswordVault || DEFAULT_1PASSWORD_VAULT)
        }'`,
      )
    }

    console.log(dedent`\n${bold('Usage:')}`)
    const commands = [
      { cmd: 'gv add', arg: '<path>', desc: COMMAND_DESCRIPTIONS.add },
      { cmd: 'gv remove', arg: '<path>', desc: COMMAND_DESCRIPTIONS.remove },
      { cmd: 'gv list', desc: COMMAND_DESCRIPTIONS.list },
      { cmd: 'git-vault', arg: '<command>', desc: 'Use the alternative alias for any command' },
    ]

    for (const { cmd, arg = '', desc } of commands) {
      const command = `  ${cyan(cmd)}${arg ? ` ${yellow(arg)}` : ''}`
      console.log(`${command.padEnd(40)}${desc}`)
    }

    if (await isLfsAvailable()) {
      console.log(dedent`
        \n${bold('Git LFS')} is configured with a threshold of ${
        cyan(`${config.lfsThresholdMB}MB`)
      }.
        Archives larger than this size will be managed by Git LFS automatically.
      `)
    }

    console.log(
      dedent`\n${bold('Remember to commit the staged changes to complete the initialization.')}`,
    )
  } catch (error) {
    terminal.error(
      `Initialization failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const init: CommandHandler = { run: initCommand }

export default init
