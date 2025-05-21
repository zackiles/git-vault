import { join, relative, resolve } from '@std/path'
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
import type { BaseCommandArgs, CommandHandler } from '../types.ts'
import { dedent } from '@qnighy/dedent'
import { createDefaultConfig, readGitVaultConfig, writeGitVaultConfig } from '../utils/config.ts'
import { DEFAULT_1PASSWORD_VAULT } from '../types.ts'

/**
 * Add command implementation
 *
 * Adds a file or directory to git-vault by encrypting it and storing it in the repository
 */
async function addCommand(args: BaseCommandArgs): Promise<void> {
  // Extract the path from arguments
  const pathToProtect = args._[0]

  if (!pathToProtect) {
    terminal.error(bold('No path specified'))
    console.log(dedent`${bold('Usage:')} ${cyan('git-vault add')} ${yellow('<path>')}`)
    return
  }

  try {
    // Get repository root using workspace parameter
    const repoRoot = await getRepositoryRoot(args.workspace as string)
    if (!repoRoot) {
      terminal.error(`Not a Git repository: ${args.workspace}`)
      return
    }

    // Ensure git-vault directory structure exists
    const gitVaultDir = join(repoRoot, '.vault')
    const storageDir = join(gitVaultDir, 'storage')

    await ensureDir(gitVaultDir)
    await ensureDir(storageDir)

    // Read config file
    let config = await readGitVaultConfig(repoRoot)

    // If config doesn't exist, create default config
    if (!config) {
      config = createDefaultConfig()
      await writeGitVaultConfig(repoRoot, config)
    }

    // Check path exists
    const resolvedPath = resolve(pathToProtect)
    try {
      const stat = await Deno.stat(resolvedPath)
      if (!stat.isFile && !stat.isDirectory) {
        terminal.error(`'${pathToProtect}' is not a file or directory`)
        return
      }
    } catch {
      terminal.error(`'${pathToProtect}' does not exist`)
      return
    }

    // Get relative path from repo root
    let relativePath = relative(repoRoot, resolvedPath)

    // For directories, add trailing slash for consistent hashing
    const isDirectory = (await Deno.stat(resolvedPath)).isDirectory
    if (isDirectory && !relativePath.endsWith('/')) {
      relativePath += '/'
    }

    // Generate hash for the path
    const pathHash = await generateHash(relativePath)

    // Check if path is already managed
    const pathIndex = config.managedPaths.findIndex((p) => p.hash === pathHash)
    if (pathIndex !== -1) {
      terminal.error(
        `${bold('Path already managed:')} '${cyan(relativePath)}' (hash: ${yellow(pathHash)})`,
      )
      return
    }

    // Password prompts
    console.log(bold('\nEncryption Setup:'))
    const password = await terminal.promptPassword(`${bold('Enter password:')} `)
    const confirmPassword = await terminal.promptPassword(`${bold('Confirm password:')} `)

    if (password !== confirmPassword) {
      terminal.error(bold('Passwords do not match'))
      return
    }

    if (!password) {
      terminal.error(bold('Password cannot be empty'))
      return
    }

    // Create archive name and path
    const archiveName = relativePath.replaceAll('/', '-')
    const archivePath = join(storageDir, `${archiveName}.tar.gz.gpg`)

    // Create a temporary directory for processing
    const tempDir = await Deno.makeTempDir()
    try {
      // Create archive
      const tempArchivePath = join(tempDir, 'archive.tar.gz')
      const archiveSuccess = await createArchive(resolvedPath, tempArchivePath)

      if (!archiveSuccess) {
        terminal.error('Failed to create archive')
        return
      }

      // Encrypt the archive
      const encryptSuccess = await encryptFile(tempArchivePath, archivePath, password)

      if (!encryptSuccess) {
        terminal.error('Failed to encrypt archive')
        return
      }

      // Store password based on storage mode
      const passwordFile = join(gitVaultDir, `git-vault-${pathHash}.pw`)

      if (config.storageMode === '1password') {
        // Check 1Password availability
        if (!await isOpAvailable()) {
          terminal.error(bold('1Password CLI is not available'))
          return
        }

        if (!await isSignedIn()) {
          terminal.error(bold('Not signed in to 1Password CLI'))
          return
        }

        // Get 1Password vault name from config
        const vaultName = config.onePasswordVault || DEFAULT_1PASSWORD_VAULT

        // Get project name for item naming
        const projectName = await getProjectName(repoRoot)
        const itemName = `git-vault-${projectName}-${pathHash}`

        // Store in 1Password
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

        // Create 1Password marker file
        await Deno.writeTextFile(join(gitVaultDir, `git-vault-${pathHash}.pw.1p`), '')
        console.log(
          `${bold('Password stored in 1Password.')} Marker file created: ${
            cyan(`${passwordFile}.1p`)
          }`,
        )
      } else {
        // Store password in file
        await Deno.writeTextFile(passwordFile, password)
        await Deno.chmod(passwordFile, 0o600) // Secure the password file
        console.log(`${bold('Password saved in:')} ${cyan(passwordFile)}`)
      }

      // Get archive size
      const archiveSize = await getFileSizeMB(archivePath)

      // Use LFS if available and necessary
      if (archiveSize >= config.lfsThresholdMB) {
        console.warn(
          `${bold('Archive size:')} ${cyan(`${archiveSize.toFixed(2)}MB`)} (exceeds threshold: ${
            yellow(`${config.lfsThresholdMB}MB`)
          })`,
        )

        if (await isLfsAvailable()) {
          console.log(bold('Configuring Git LFS for this archive...'))
          await initLfs(repoRoot)
          await configureLfs(repoRoot, `${relative(repoRoot, storageDir)}/*.tar.gz.gpg`)
        } else {
          console.log(
            `${bold('Note:')} Git LFS ${
              yellow('not available')
            }. Large archive will be stored directly in Git.`,
          )
        }
      }

      // Update config with new managed path
      config.managedPaths.push({
        hash: pathHash,
        path: relativePath,
      })

      // Save updated config
      await writeGitVaultConfig(repoRoot, config)

      // Update .gitignore
      const gitignorePattern = `/${relativePath}`
      const pwIgnorePattern = `${relative(repoRoot, gitVaultDir)}/*.pw`
      const pw1pIgnorePattern = `${relative(repoRoot, gitVaultDir)}/*.pw.1p`

      await updateGitignore(repoRoot, [
        gitignorePattern,
        pwIgnorePattern,
        pw1pIgnorePattern,
      ])

      // Stage files for commit
      const filesToStage = [
        relative(repoRoot, archivePath),
        relative(repoRoot, join(gitVaultDir, 'config.json')),
        '.gitignore',
      ]

      if (config.storageMode === '1password') {
        filesToStage.push(relative(repoRoot, join(gitVaultDir, `git-vault-${pathHash}.pw.1p`)))
      }

      for (const file of filesToStage) {
        await stageFile(file)
      }

      terminal.success(bold('File added successfully!'))
      console.log(`${bold('Path:')} ${cyan(relativePath)}`)
      console.log(`${bold('Archive:')} ${cyan(archivePath)}`)

      if (archiveSize >= config.lfsThresholdMB && await isLfsAvailable()) {
        console.log(
          `${bold('Git LFS enabled:')} archive size ${
            cyan(`${archiveSize.toFixed(2)}MB`)
          } (threshold: ${yellow(`${config.lfsThresholdMB}MB`)})`,
        )
      }
    } finally {
      // Clean up temporary directory
      await Deno.remove(tempDir, { recursive: true })
    }
  } catch (error) {
    terminal.error(
      `${bold('Failed to add file:')} ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const add: CommandHandler = { run: addCommand }

export default add
