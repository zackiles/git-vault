import { isAbsolute, join, relative } from '@std/path'
import { exists } from '@std/fs'
import { bold } from '@std/fmt/colors'
import { createArchive } from '../utils/compression.ts'
import { getProjectName, getRepositoryRoot } from '../services/git.ts'
import { encryptFile } from '../services/gpg.ts'
import { getPassword, isOpAvailable, isSignedIn } from '../services/op.ts'
import terminal from '../utils/terminal.ts'
import type { CommandArgs, CommandHandler, ManagedPath } from '../types.ts'
import { readGitVaultConfig } from '../utils/config.ts'
import { DEFAULT_1PASSWORD_VAULT } from '../constants.ts'
import { PATHS } from '../paths.ts'

/**
 * Encrypts managed files in the vault
 * When called without arguments, encrypts all managed files
 * When called with a path argument, encrypts only that specific file/folder if it's managed
 */
async function run(args: CommandArgs): Promise<void> {
  try {
    const repoRoot = await getRepositoryRoot(args.workspace as string)
    if (!repoRoot) {
      terminal.error(`Not a Git repository: ${args.workspace}`)
      return
    }

    const config = await readGitVaultConfig(repoRoot)
    if (!config) {
      // No vault config, nothing to encrypt
      return
    }

    if (config.managedPaths.length === 0) {
      // No managed paths, nothing to encrypt
      return
    }

    const gitVaultDir = join(repoRoot, '.vault')
    const storageDir = join(gitVaultDir, 'storage')

    let encryptedCount = 0
    let failedCount = 0

    // If item is specified, only encrypt that specific file/folder
    let pathsToEncrypt: ManagedPath[] = [...config.managedPaths]

    if (args.item) {
      // Convert the provided path to a relative path from the repo root
      const pathToEncrypt = isAbsolute(args.item)
        ? args.item
        : join(args.workspace, args.item)
      const realPathToEncrypt = await Deno.realPath(pathToEncrypt)
      const realRepoRoot = await Deno.realPath(repoRoot)

      let relativePath = relative(realRepoRoot, realPathToEncrypt)

      // Add trailing slash for directories
      try {
        const stat = await Deno.stat(pathToEncrypt)
        if (stat.isDirectory && !relativePath.endsWith('/')) {
          relativePath += '/'
        }
      } catch {
        terminal.error(`Path does not exist: ${args.item}`)
        return
      }

      // Find the managed path matching the provided path
      const managedPath = config.managedPaths.find((p) =>
        p.path === relativePath
      )

      if (!managedPath) {
        terminal.error(`Path is not managed by git-vault: ${relativePath}`)
        return
      }

      pathsToEncrypt = [managedPath]
    }

    for (const managedPath of pathsToEncrypt) {
      const sourcePath = join(repoRoot, managedPath.path)

      // Check if the source file/directory exists
      if (!await exists(sourcePath)) {
        terminal.warn(`Skipping missing file: ${managedPath.path}`)
        continue
      }

      const archiveName = managedPath.path.replaceAll('/', '-')
      const archivePath = join(storageDir, `${archiveName}.tar.gz.gpg`)

      try {
        // Get the password
        let password: string | null = null

        if (config.storageMode === '1password') {
          if (!await isOpAvailable()) {
            terminal.error('1Password CLI is not available')
            failedCount++
            continue
          }

          if (!await isSignedIn()) {
            terminal.error('Not signed in to 1Password')
            failedCount++
            continue
          }

          const vaultName = config.onePasswordVault || DEFAULT_1PASSWORD_VAULT
          const projectName = await getProjectName(repoRoot)
          const itemName =
            `${PATHS.BASE_NAME}-${projectName}-${managedPath.hash}`

          password = await getPassword(itemName, vaultName)

          if (!password) {
            terminal.error(
              `Failed to retrieve password from 1Password for: ${managedPath.path}`,
            )
            failedCount++
            continue
          }
        } else {
          // File-based password storage
          const passwordFile = join(
            gitVaultDir,
            `${PATHS.BASE_NAME}-${managedPath.hash}.pw`,
          )

          if (!await exists(passwordFile)) {
            terminal.error(`Password file not found for: ${managedPath.path}`)
            failedCount++
            continue
          }

          password = await Deno.readTextFile(passwordFile)
        }

        // Create temporary archive
        const tempDir = await Deno.makeTempDir()
        try {
          const tempArchivePath = join(tempDir, 'archive.tar.gz')

          // Create archive
          const archiveSuccess = await createArchive(
            sourcePath,
            tempArchivePath,
          )
          if (!archiveSuccess) {
            terminal.error(`Failed to create archive for: ${managedPath.path}`)
            failedCount++
            continue
          }

          // Encrypt archive
          const encryptSuccess = await encryptFile(
            tempArchivePath,
            archivePath,
            password,
          )
          if (!encryptSuccess) {
            terminal.error(`Failed to encrypt archive for: ${managedPath.path}`)
            failedCount++
            continue
          }

          encryptedCount++

          if (!args.quiet) {
            terminal.info('Encrypted:', managedPath.path)
          }
        } finally {
          // Clean up temp directory
          await Deno.remove(tempDir, { recursive: true })
        }
      } catch (error) {
        terminal.error(`Failed to encrypt ${managedPath.path}:`, error)
        failedCount++
      }
    }

    if (!args.quiet) {
      if (encryptedCount > 0) {
        terminal.success(`Encrypted ${bold(String(encryptedCount))} file(s)`)
      }
      if (failedCount > 0) {
        terminal.warn(`Failed to encrypt ${bold(String(failedCount))} file(s)`)
      }
      if (encryptedCount === 0 && failedCount === 0) {
        terminal.warn('No files were encrypted')
      }
    }
  } catch (error) {
    terminal.error('Encryption failed', error)
  }
}

export default run satisfies CommandHandler
