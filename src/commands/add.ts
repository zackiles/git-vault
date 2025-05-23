import { isAbsolute, join, relative, resolve } from '@std/path'
import { ensureDir } from '@std/fs'
import { bold, cyan, yellow } from '@std/fmt/colors'
import { generateHash } from '../utils/crypto.ts'
import { createArchive, getFileSizeMB } from '../utils/compression.ts'
import {
  configureLfs,
  getProjectName,
  getRepositoryRoot,
  initLfs,
  isLfsAvailable,
  stageFile,
  updateGitignore,
} from '../services/git.ts'
import { encryptFile } from '../services/gpg.ts'
import { createPasswordItem, isOpAvailable, isSignedIn } from '../services/op.ts'
import terminal from '../utils/terminal.ts'
import type { CommandArgs, CommandHandler } from '../types.ts'
import { dedent } from '@qnighy/dedent'
import { readGitVaultConfig, writeGitVaultConfig } from '../utils/config.ts'
import { DEFAULT_1PASSWORD_VAULT } from '../constants.ts'
import { initializeVault, isVaultInitialized } from '../utils/initialize-vault.ts'
import { PATHS } from '../paths.ts'
import {
  addTasksToProjectConfig,
  detectProjectConfigFile,
  getTaskDefinitions,
} from '../utils/project-config.ts'

/**
 * Adds a file or directory to gv by encrypting it and storing it in the repository
 */
async function run(args: CommandArgs): Promise<void> {
  if (!args.item) {
    terminal.error('No path to an item to add specified')
    console.log(dedent`${bold('Usage:')} ${cyan('gv add')} ${yellow('<path>')}`)
    return
  }

  // Handle both absolute and relative paths correctly
  const pathToProtected = isAbsolute(args.item) ? args.item : join(args.workspace, args.item)

  try {
    const repoRoot = await getRepositoryRoot(args.workspace as string)
    if (!repoRoot) {
      terminal.error(`Not a Git repository: ${args.workspace}`)
      return
    }

    // Check if vault needs initialization
    if (!await isVaultInitialized(repoRoot)) {
      const confirmed = terminal.createConfirm(
        `A vault was not detected in ${repoRoot}. Would you like to create one and add ${pathToProtected}?`,
        true,
      )
      if (!confirmed) {
        console.log('Vault creation cancelled. Exiting.')
        return
      }
      const initialized = await initializeVault(repoRoot, false)
      if (!initialized) {
        terminal.error('Failed to initialize the vault. Please try again or check for errors.')
        return
      }
      terminal.success('Vault initialized successfully.')
    }

    const gitVaultDir = join(repoRoot, '.vault')
    const storageDir = join(gitVaultDir, 'storage')

    await ensureDir(gitVaultDir)
    await ensureDir(storageDir)

    const config = await readGitVaultConfig(repoRoot)
    if (!config) {
      terminal.error('Vault configuration not found after initialization. This should not happen.')
      return
    }

    try {
      const stat = await Deno.stat(pathToProtected)
      if (!stat.isFile && !stat.isDirectory) {
        terminal.error(`'${pathToProtected}' is not a file or directory`)
        return
      }
    } catch {
      terminal.error(`'${pathToProtected}' does not exist`)
      return
    }

    // Normalize both paths for consistent comparison
    const normalizedRepoRoot = resolve(repoRoot)
    const normalizedPathToProtected = resolve(pathToProtected)

    // Verify the file is actually inside the repository
    // Use realPath for validation to handle symlinks (like /var -> /private/var on macOS)
    const realRepoRoot = await Deno.realPath(repoRoot)
    const realPathToProtected = await Deno.realPath(pathToProtected)

    if (
      !normalizedPathToProtected.startsWith(`${normalizedRepoRoot}/`) &&
      normalizedPathToProtected !== normalizedRepoRoot
    ) {
      // Try again with real paths to handle symlinks
      if (
        !realPathToProtected.startsWith(`${realRepoRoot}/`) &&
        realPathToProtected !== realRepoRoot
      ) {
        terminal.error(`Path '${pathToProtected}' is not inside the repository '${repoRoot}'`)
        return
      }
    }

    // Calculate relative path using consistent normalized paths
    let relativePath = relative(realRepoRoot, realPathToProtected)
    /**
    // NOTE: KEEP THESE HERE. PATHS BREAK ALL THE TIME
    // DEBUG: Log the path calculations
    console.log('DEBUG paths:')
    console.log('  repoRoot:', repoRoot)
    console.log('  pathToProtected:', pathToProtected)
    console.log('  normalizedRepoRoot:', normalizedRepoRoot)
    console.log('  normalizedPathToProtected:', normalizedPathToProtected)
    console.log('  realRepoRoot:', realRepoRoot)
    console.log('  realPathToProtected:', realPathToProtected)
    console.log('  relativePath:', relativePath)
    */
    // Add trailing slash for directories
    const isDirectory = (await Deno.stat(pathToProtected)).isDirectory
    if (isDirectory && !relativePath.endsWith('/')) {
      relativePath += '/'
    }

    const pathHash = await generateHash(relativePath)

    const pathIndex = config.managedPaths.findIndex((p) => p.hash === pathHash)
    if (pathIndex !== -1) {
      terminal.error(`Path already managed: '${relativePath}' (hash: ${pathHash})`)
      return
    }

    terminal.section('Encryption Setup:')
    let password = ''
    let confirmPassword = ''

    // Password input loop
    while (true) {
      password = terminal.createPromptPassword('Enter password: ')

      // Check for empty password
      if (!password) {
        terminal.warn('Password cannot be empty. Please try again.')
        continue
      }

      // Check password length
      if (password.length < 8) {
        terminal.warn('Password is less than 8 characters long')
      }

      confirmPassword = terminal.createPromptPassword('Confirm password: ')

      // Check if passwords match
      if (password !== confirmPassword) {
        terminal.warn('Passwords do not match. Please try again.')
        continue
      }

      // If we've made it here, passwords are valid
      break
    }

    const archiveName = relativePath.replaceAll('/', '-')
    const archivePath = join(storageDir, `${archiveName}.tar.gz.gpg`)

    const tempDir = await Deno.makeTempDir()
    try {
      const tempArchivePath = join(tempDir, 'archive.tar.gz')
      const archiveSuccess = await createArchive(pathToProtected, tempArchivePath)

      if (!archiveSuccess) {
        terminal.error('Failed to create archive')
        return
      }

      const encryptSuccess = await encryptFile(tempArchivePath, archivePath, password)

      if (!encryptSuccess) {
        terminal.error('Failed to encrypt archive')
        return
      }

      const passwordFile = join(gitVaultDir, `${PATHS.BASE_NAME}-${pathHash}.pw`)

      if (config.storageMode === '1password') {
        if (!await isOpAvailable()) {
          terminal.error('1Password CLI is not available')
          return
        }

        const signedIn = await isSignedIn()
        if (!signedIn) {
          terminal.error(
            'Failed to sign in to 1Password. Please try again or check your credentials.',
          )
          return
        }

        const vaultName = config.onePasswordVault || DEFAULT_1PASSWORD_VAULT
        const projectName = await getProjectName(repoRoot)
        const itemName = `${PATHS.BASE_NAME}-${projectName}-${pathHash}`

        const createSuccess = await createPasswordItem(
          itemName,
          vaultName,
          password,
          {
            path: relativePath,
            status: 'active',
          },
        )

        if (!createSuccess) {
          terminal.error('Failed to store password in 1Password')
          return
        }

        await Deno.writeTextFile(join(gitVaultDir, `${PATHS.BASE_NAME}-${pathHash}.pw.1p`), '')
        terminal.info('Password stored in 1Password.', `Marker file created: ${passwordFile}.1p`)
      } else {
        await Deno.writeTextFile(passwordFile, password)
        if (Deno.build.os !== 'windows') {
          await Deno.chmod(passwordFile, 0o600)
        } else {
          try {
            await new Deno.Command('attrib', {
              args: ['+r', passwordFile],
              stderr: 'null',
            }).output()
          } catch {
            terminal.warn(`Could not set secure permissions for ${passwordFile} on Windows`)
          }
        }
        terminal.info('Password saved in:', passwordFile)
      }

      const archiveSize = await getFileSizeMB(archivePath)

      if (archiveSize >= config.lfsThresholdMB) {
        terminal.warn(
          `Archive size: ${
            archiveSize.toFixed(2)
          }MB (exceeds threshold: ${config.lfsThresholdMB}MB)`,
        )

        if (await isLfsAvailable()) {
          terminal.status('Configuring Git LFS for this archive...')
          await initLfs(repoRoot)
          await configureLfs(repoRoot, `${relative(repoRoot, storageDir)}/*.tar.gz.gpg`)
        } else {
          terminal.warn('Git LFS not available. Large archive will be stored directly in Git.')
        }
      }

      config.managedPaths.push({
        hash: pathHash,
        path: relativePath,
      })

      await writeGitVaultConfig(repoRoot, config)

      const gitignorePattern = `/${relativePath}`
      const pwIgnorePattern = `${relative(repoRoot, gitVaultDir)}/*.pw`
      const pw1pIgnorePattern = `${relative(repoRoot, gitVaultDir)}/*.pw.1p`

      await updateGitignore(repoRoot, [
        gitignorePattern,
        pwIgnorePattern,
        pw1pIgnorePattern,
      ], { mode: 'add' })

      const filesToStage = [
        relative(repoRoot, archivePath),
        relative(repoRoot, join(gitVaultDir, 'config.json')),
        '.gitignore',
      ]

      if (config.storageMode === '1password') {
        filesToStage.push(
          relative(repoRoot, join(gitVaultDir, `${PATHS.BASE_NAME}-${pathHash}.pw.1p`)),
        )
      }

      for (const file of filesToStage) {
        await stageFile(file)
      }

      terminal.success('File added successfully!')
      terminal.info('Path:', relativePath)
      terminal.info('Archive:', archivePath)

      if (archiveSize >= config.lfsThresholdMB && await isLfsAvailable()) {
        terminal.info(
          'Git LFS enabled:',
          `archive size ${archiveSize.toFixed(2)}MB (threshold: ${config.lfsThresholdMB}MB)`,
        )
      }

      // Check for project config files and offer to add Git-Vault tasks
      const projectConfigFile = await detectProjectConfigFile(repoRoot)
      if (projectConfigFile) {
        const shouldAddTasks = terminal.createConfirm(
          `Would you like to add Git-Vault tasks to ${projectConfigFile}?`,
          true,
        )

        if (shouldAddTasks) {
          const tasks = getTaskDefinitions(projectConfigFile)
          const success = await addTasksToProjectConfig(repoRoot, projectConfigFile, tasks)

          if (success) {
            // Update the managed path entry to track which config file was modified
            const pathEntry = config.managedPaths.find((p) => p.hash === pathHash)
            if (pathEntry) {
              if (!pathEntry.addedTasks) {
                pathEntry.addedTasks = []
              }
              pathEntry.addedTasks.push({ file: projectConfigFile })
            }

            await writeGitVaultConfig(repoRoot, config)
            await stageFile(projectConfigFile)

            terminal.info(`Added Git-Vault tasks to ${projectConfigFile}`, '')

            // Provide usage instructions based on the config file type
            switch (projectConfigFile) {
              case 'package.json':
                terminal.info(
                  'Usage: npm run vault:add <path> | npm run vault:remove <path> | npm run vault:list',
                  '',
                )
                break
              case 'deno.json':
              case 'deno.jsonc':
                terminal.info(
                  'Usage: deno task vault:add <path> | deno task vault:remove <path> | deno task vault:list',
                  '',
                )
                break
              case 'Makefile':
                terminal.info(
                  'Usage: make vault-add <path> | make vault-remove <path> | make vault-list',
                  '',
                )
                break
            }
          } else {
            terminal.warn(`Failed to add tasks to ${projectConfigFile}`)
          }
        }
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true })
    }
  } catch (error) {
    terminal.error('Failed to add file', error)
  }
}

export default run satisfies CommandHandler
