import { isAbsolute, join } from '@std/path'
import { ensureDir, exists } from '@std/fs'
import { bold, cyan } from '@std/fmt/colors'
import { dedent } from '@qnighy/dedent'
import {
  configureLfs,
  initLfs,
  isGitRepository,
  isLfsAvailable,
  stageFile,
  updateGitignore,
} from '../services/git.ts'
import { isGpgAvailable } from '../services/gpg.ts'
import { getVaults, isOpAvailable, isSignedIn } from '../services/op.ts'
import terminal from './terminal.ts'
import {
  createDefaultConfig,
  getGitVaultConfigPath,
  writeGitVaultConfig,
} from './config.ts'
import { DEFAULT_1PASSWORD_VAULT } from '../constants.ts'

/**
 * Installs Git hooks for git-vault
 */
async function installHooks(repoRoot: string): Promise<boolean> {
  try {
    const getHooksPathCmd = new Deno.Command('git', {
      args: ['config', 'core.hooksPath'],
      cwd: repoRoot,
      stdout: 'piped',
      stderr: 'null',
    })

    const { success, stdout } = await getHooksPathCmd.output()

    const gitDir = join(repoRoot, '.git')
    let hooksDir = join(gitDir, 'hooks')

    if (success && stdout.length > 0) {
      const customPath = new TextDecoder().decode(stdout).trim()
      hooksDir = isAbsolute(customPath)
        ? customPath
        : join(repoRoot, customPath)
    }

    const hooksInfo = await Deno.stat(hooksDir).catch(() => null)
    if (!hooksInfo?.isDirectory) {
      await Deno.mkdir(hooksDir, { recursive: true })
    }

    const hooks = [
      { name: 'pre-commit', script: 'encrypt' },
      { name: 'post-checkout', script: 'decrypt' },
      { name: 'post-merge', script: 'decrypt' },
    ]

    for (const hook of hooks) {
      const hookPath = join(hooksDir, hook.name)
      const hookContent = dedent`
        #!/usr/bin/env sh
        # git-vault hook marker
        exec gv ${hook.script} --quiet
      `
      await Deno.writeTextFile(hookPath, hookContent)

      if (Deno.build.os !== 'windows') {
        await Deno.chmod(hookPath, 0o755)
      } else {
        try {
          await new Deno.Command('attrib', {
            args: ['+x', hookPath],
            stderr: 'null',
          }).output()
        } catch {
          console.warn(
            `Could not set executable permissions for ${hookPath} on Windows`,
          )
        }
      }
    }

    return true
  } catch (error) {
    terminal.error('Error installing Git hooks', error)
    return false
  }
}

/**
 * Checks if a vault is already initialized in the given repository
 */
export async function isVaultInitialized(repoRoot: string): Promise<boolean> {
  return await exists(getGitVaultConfigPath(repoRoot))
}

/**
 * Initializes a new vault in the given repository
 */
export async function initializeVault(
  workspacePath: string,
  autoConfirm = false,
): Promise<boolean> {
  let directoryCreated = false
  const gitVaultDir = join(workspacePath, '.vault')
  const cleanupGitVaultDir = () =>
    Deno.remove(gitVaultDir, { recursive: true }).catch(() => {})

  try {
    try {
      const stat = await Deno.stat(workspacePath)
      if (!stat.isDirectory) {
        terminal.error(`'${workspacePath}' is not a directory`)
        return false
      }
    } catch {
      terminal.error(`'${workspacePath}' does not exist`)
      return false
    }

    if (!(await isGitRepository(workspacePath))) {
      terminal.error(`'${workspacePath}' is not a Git repository`)
      return false
    }

    console.log(bold('Checking dependencies...'))

    if (!(await isGpgAvailable())) {
      terminal.error('GPG is not available')
      console.log(`Please install ${cyan('GPG')} and try again.`)
      return false
    }

    const storageDir = join(gitVaultDir, 'storage')
    const config = createDefaultConfig()

    if (await exists(gitVaultDir) && !autoConfirm) {
      const confirmed = terminal.createConfirm(
        `${bold('gv is already initialized.')} Do you want to re-configure it?`,
        false,
      )
      if (!confirmed) {
        console.log(`${bold('Initialization cancelled.')}`)
        return false
      }
    }

    console.log(bold('Creating .vault directory...'))
    await ensureDir(gitVaultDir)
    await ensureDir(storageDir)
    directoryCreated = true

    if (await isOpAvailable()) {
      console.log('1Password CLI detected.')

      const use1Password = autoConfirm ? false : terminal.createConfirm(
        'Would you like to use 1Password for password storage instead of local files?',
        true,
      )

      if (use1Password) {
        console.log('Checking 1Password sign-in status...')

        if (!(await isSignedIn())) {
          terminal.error('Not signed in to 1Password CLI')
          console.warn('Please sign in using "op signin" and try again.')
          if (directoryCreated) await cleanupGitVaultDir()
          return false
        }

        console.log('Sign-in status verified.')
        config.storageMode = '1password'

        const vaults = await getVaults()

        if (vaults.length === 0) {
          terminal.error('No 1Password vaults found')
          console.log(
            'Please create at least one vault in 1Password and try again.',
          )
          if (directoryCreated) await cleanupGitVaultDir()
          return false
        }

        const selection = terminal.createPromptSelect(
          'Select a 1Password vault to use:',
          [...vaults, 'Enter a custom vault name'],
        ) || vaults[0] || DEFAULT_1PASSWORD_VAULT

        config.onePasswordVault = selection === 'Enter a custom vault name'
          ? terminal.createPromptInput(
            'Enter the vault name: ',
            DEFAULT_1PASSWORD_VAULT,
          )
          : selection

        terminal.success(`Using 1Password vault: '${config.onePasswordVault}'`)
      } else {
        console.log('Using file-based password storage.')
      }
    } else {
      console.log(
        '1Password CLI not detected. Using default file-based password storage.',
      )
    }

    console.log(`Storage mode ('${config.storageMode}') saved.`)

    console.log('Checking for Git LFS support...')
    console.log(`LFS threshold set to ${config.lfsThresholdMB}MB.`)

    if (await isLfsAvailable()) {
      console.log('Git LFS detected. Setting up LFS for gv...')

      await initLfs(workspacePath)
      await configureLfs(workspacePath, '.vault/storage/*.tar.gz.gpg')

      console.log('Git LFS configured for gv archives.')
    } else {
      console.log(
        'Git LFS not detected. Large files will be stored directly in Git.',
      )
      console.log(
        'For better performance with large files, consider installing Git LFS.',
      )
    }

    await writeGitVaultConfig(workspacePath, config)

    console.log('Updating .gitignore...')

    const ignorePatterns = ['.vault/*.pw', '.vault/*.pw.1p']
    await updateGitignore(workspacePath, ignorePatterns, { mode: 'add' })

    console.log('Installing Git hooks...')

    const hooks = await installHooks(workspacePath)

    if (hooks) {
      console.log('Git hooks installed successfully.')
    } else {
      console.warn(
        'Warning: Failed to install Git hooks. You may need to install them manually.',
      )
    }

    console.log('Staging gv files...')

    const filesToStage = ['.gitignore', '.vault/config.json']
    for (const file of filesToStage) {
      await stageFile(file)
    }

    terminal.success(bold('gv initialized successfully!'))
    console.log(`${bold('Storage mode:')} ${cyan(config.storageMode)}`)

    if (config.storageMode === '1password') {
      console.log(
        `${bold('Using 1Password vault:')} '${
          cyan(config.onePasswordVault || DEFAULT_1PASSWORD_VAULT)
        }'`,
      )
    }

    if (await isLfsAvailable()) {
      terminal.success(dedent`
        \n${bold('Git LFS')} is configured with a threshold of ${
        cyan(`${config.lfsThresholdMB}MB`)
      }.
        Archives larger than this size will be managed by Git LFS automatically.
      `)
    }

    console.log(
      `\n${
        bold(
          'Remember to commit the staged changes to complete the initialization.',
        )
      }`,
    )

    return true
  } catch (error) {
    terminal.error('Initialization failed', error)
    if (directoryCreated) await cleanupGitVaultDir()
    return false
  }
}
