import { isAbsolute, join, relative } from '@std/path'
import { ensureDir, exists } from '@std/fs'
import { bold } from '@std/fmt/colors'
import { extractArchive } from '../utils/compression.ts'
import { getProjectName, getRepositoryRoot } from '../services/git.ts'
import { decryptFile } from '../services/gpg.ts'
import {
  createPasswordItem,
  getPassword,
  isOpAvailable,
  isSignedIn,
} from '../services/op.ts'
import terminal from '../utils/terminal.ts'
import type {
  CommandArgs,
  CommandHandler,
  GitVaultConfig,
  ManagedPath,
} from '../types.ts'
import { readGitVaultConfig } from '../utils/config.ts'
import { DEFAULT_1PASSWORD_VAULT } from '../constants.ts'
import { PATHS } from '../paths.ts'

/**
 * Decrypts managed files from the vault
 * When called without arguments, decrypts all managed files
 * When called with a path argument, decrypts only that specific file/folder if it's managed
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
      // No vault config, nothing to decrypt
      return
    }

    if (config.managedPaths.length === 0) {
      // No managed paths, nothing to decrypt
      return
    }

    const gitVaultDir = join(repoRoot, '.vault')
    const storageDir = join(gitVaultDir, 'storage')

    let decryptedCount = 0
    let failedCount = 0

    // If item is specified, only decrypt that specific file/folder
    let pathsToDecrypt: ManagedPath[] = [...config.managedPaths]

    if (args.item) {
      // Convert the provided path to a relative path from the repo root
      const pathToDecrypt = isAbsolute(args.item)
        ? args.item
        : join(args.workspace, args.item)

      try {
        const realRepoRoot = await Deno.realPath(repoRoot)
        let relativePath: string
        let managedPath: ManagedPath | undefined

        // First try to find it as an existing path
        try {
          const realPathToDecrypt = await Deno.realPath(pathToDecrypt)
          relativePath = relative(realRepoRoot, realPathToDecrypt)

          // Add trailing slash for directories
          const stat = await Deno.stat(pathToDecrypt)
          if (stat.isDirectory && !relativePath.endsWith('/')) {
            relativePath += '/'
          }

          // Find the managed path matching the provided path
          managedPath = config.managedPaths.find((p) => p.path === relativePath)
        } catch {
          // If the path doesn't exist, it might be because it needs to be decrypted
          // Try to find it in the managed paths without checking if it exists
          relativePath = relative(repoRoot, pathToDecrypt)

          managedPath = config.managedPaths.find((p) => {
            // Try to match with and without trailing slash
            const normalizedPath = p.path.endsWith('/') ? p.path : `${p.path}/`
            const normalizedInput = relativePath.endsWith('/')
              ? relativePath
              : `${relativePath}/`
            return p.path === relativePath || normalizedPath === normalizedInput
          })
        }

        if (!managedPath) {
          terminal.error(`Path is not managed by git-vault: ${relativePath}`)
          return
        }

        pathsToDecrypt = [managedPath]
      } catch {
        terminal.error(`Invalid path: ${args.item}`)
        return
      }
    }

    for (const managedPath of pathsToDecrypt) {
      const archiveName = managedPath.path.replaceAll('/', '-')
      const archivePath = join(storageDir, `${archiveName}.tar.gz.gpg`)

      // Check if the encrypted archive exists
      if (!await exists(archivePath)) {
        terminal.warn(`Skipping missing archive: ${archivePath}`)
        continue
      }

      try {
        // Get the password
        let password: string | null = null
        let passwordWasProvided = false

        if (args.password) {
          // Use provided password
          password = args.password
          passwordWasProvided = true
          if (!args.quiet) {
            terminal.info('Using provided password', '')
          }
        } else if (config.storageMode === '1password') {
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

        // Create temporary directory for decryption
        const tempDir = await Deno.makeTempDir()
        try {
          const tempArchivePath = join(tempDir, 'archive.tar.gz')

          // Decrypt archive
          const decryptSuccess = await decryptFile(
            archivePath,
            tempArchivePath,
            password,
          )
          if (!decryptSuccess) {
            terminal.error(`Failed to decrypt archive for: ${managedPath.path}`)
            failedCount++
            continue
          }

          // Extract archive to repository
          // For files, extract to parent directory; for directories, extract in place
          const targetPath = join(repoRoot, managedPath.path)
          const isDirectory = managedPath.path.endsWith('/')

          if (isDirectory) {
            // For directories, ensure target exists and extract there
            await ensureDir(targetPath)
            const extractSuccess = await extractArchive(
              tempArchivePath,
              repoRoot,
            )
            if (!extractSuccess) {
              terminal.error(
                `Failed to extract archive for: ${managedPath.path}`,
              )
              failedCount++
              continue
            }
          } else {
            // For files, ensure parent directory exists
            const parentDir = join(
              repoRoot,
              managedPath.path.split('/').slice(0, -1).join('/'),
            )
            if (parentDir !== repoRoot) {
              await ensureDir(parentDir)
            }

            const extractSuccess = await extractArchive(
              tempArchivePath,
              repoRoot,
            )
            if (!extractSuccess) {
              terminal.error(
                `Failed to extract archive for: ${managedPath.path}`,
              )
              failedCount++
              continue
            }
          }

          decryptedCount++

          if (!args.quiet) {
            terminal.info('Decrypted:', managedPath.path)
          }

          // Handle --write functionality: save provided password after successful decryption
          if (passwordWasProvided && args.write) {
            await handlePasswordWrite(
              password,
              managedPath,
              config,
              repoRoot,
              gitVaultDir,
              !args.quiet,
            )
          }
        } finally {
          // Clean up temp directory
          await Deno.remove(tempDir, { recursive: true })
        }
      } catch (error) {
        terminal.error(`Failed to decrypt ${managedPath.path}:`, error)
        failedCount++
      }
    }

    if (!args.quiet) {
      if (decryptedCount > 0) {
        terminal.success(`Decrypted ${bold(String(decryptedCount))} file(s)`)
      }
      if (failedCount > 0) {
        terminal.warn(`Failed to decrypt ${bold(String(failedCount))} file(s)`)
      }
      if (decryptedCount === 0 && failedCount === 0) {
        terminal.warn('No files were decrypted')
      }
    }
  } catch (error) {
    terminal.error('Decryption failed', error)
  }
}

/**
 * Handles writing a password to storage after successful decryption
 * Used when --write flag is provided with --password
 */
async function handlePasswordWrite(
  password: string,
  managedPath: ManagedPath,
  config: GitVaultConfig,
  repoRoot: string,
  gitVaultDir: string,
  showMessages: boolean,
): Promise<void> {
  try {
    if (config.storageMode === '1password') {
      if (!await isOpAvailable()) {
        if (showMessages) terminal.error('1Password CLI is not available')
        return
      }

      if (!await isSignedIn()) {
        if (showMessages) terminal.error('Not signed in to 1Password')
        return
      }

      const vaultName = config.onePasswordVault || DEFAULT_1PASSWORD_VAULT
      const projectName = await getProjectName(repoRoot)
      const itemName = `${PATHS.BASE_NAME}-${projectName}-${managedPath.hash}`

      // Ask user if they want to overwrite existing 1Password entry
      if (showMessages) {
        const shouldOverwrite = terminal.createConfirm(
          `Overwrite existing 1Password entry for ${managedPath.path}?`,
          true,
        )
        if (!shouldOverwrite) {
          return
        }
      }

      const success = await createPasswordItem(
        itemName,
        vaultName,
        password,
        {
          path: managedPath.path,
          status: 'active',
        },
      )

      if (success && showMessages) {
        terminal.info('Password saved to 1Password', itemName)
      } else if (!success && showMessages) {
        terminal.error('Failed to save password to 1Password')
      }
    } else {
      // File-based storage
      const passwordFile = join(
        gitVaultDir,
        `${PATHS.BASE_NAME}-${managedPath.hash}.pw`,
      )

      // Ask user if they want to overwrite existing password file
      if (showMessages && await exists(passwordFile)) {
        const shouldOverwrite = terminal.createConfirm(
          `Overwrite existing password file for ${managedPath.path}?`,
          true,
        )
        if (!shouldOverwrite) {
          return
        }
      }

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
          if (showMessages) {
            terminal.warn(
              `Could not set secure permissions for ${passwordFile} on Windows`,
            )
          }
        }
      }

      if (showMessages) {
        terminal.info('Password saved to file', passwordFile)
      }
    }
  } catch (error) {
    if (showMessages) {
      terminal.error('Failed to write password:', error)
    }
  }
}

export default run satisfies CommandHandler
