import { dirname, join, relative, resolve } from '@std/path'
import { exists } from '@std/fs'
import { bold, cyan, yellow } from '@std/fmt/colors'
import terminal from '../utils/terminal.ts'
import type { CommandArgs, CommandHandler } from '../types.ts'
import { generateHash } from '../utils/crypto.ts'
import { getProjectName, getRepositoryRoot, stageFile, updateGitignore } from '../services/git.ts'
import { verifyPassword } from '../services/gpg.ts'
import { getPassword, isOpAvailable, isSignedIn, markItemRemoved } from '../services/op.ts'
import { dedent } from '@qnighy/dedent'
import { readGitVaultConfig, writeGitVaultConfig } from '../utils/config.ts'
import { DEFAULT_1PASSWORD_VAULT } from '../constants.ts'
import { PATHS } from '../paths.ts'
import { removeTasksFromProjectConfig } from '../utils/project-config.ts'
import type { ProjectConfigFile } from '../utils/project-config.ts'

/**
 * Remove command implementation
 *
 * Removes a file or directory from gv management
 */
async function run(args: CommandArgs): Promise<void> {
  if (!args.item) {
    terminal.error('No path to a vaulted item to remove specified')
    console.log(dedent`${bold('Usage:')} ${cyan('gv remove')} ${yellow('<path>')}`)
    return
  }

  try {
    // Get repository root using workspace parameter
    const repoRoot = await getRepositoryRoot(args.workspace as string)
    if (!repoRoot) {
      terminal.error(`Not a Git repository: ${args.workspace}`)
      return
    }

    // Setup paths
    const gitVaultDir = join(repoRoot, '.vault')
    const storageDir = join(gitVaultDir, 'storage')

    // Read config
    const config = await readGitVaultConfig(repoRoot)

    // Check if config exists
    if (!config) {
      terminal.error(`Config file '.vault/config.json' not found. Cannot remove path.`)
      return
    }

    // Get the resolved path and relative path
    const resolvedPath = resolve(args.item)
    let relativePath = relative(repoRoot, resolvedPath)

    // Generate hash for the path without trailing slash first
    let pathHash = await generateHash(relativePath)

    // Find the entry in config.managedPaths
    let pathEntry = config.managedPaths.find((p) => p.hash === pathHash)

    // If not found, try with trailing slash (for directories)
    if (!pathEntry && !relativePath.endsWith('/')) {
      const relativePathWithSlash = `${relativePath}/`
      const pathHashWithSlash = await generateHash(relativePathWithSlash)

      pathEntry = config.managedPaths.find((p) => p.hash === pathHashWithSlash)

      if (pathEntry) {
        pathHash = pathHashWithSlash
        relativePath = relativePathWithSlash
      }
    }

    // Check if path is managed
    if (!pathEntry) {
      terminal.error(`Path not managed by gv: ${args.item} (hash ${pathHash})`)
      return
    }

    // Determine file paths
    const passwordFile = join(gitVaultDir, `${PATHS.BASE_NAME}-${pathHash}.pw`)
    const passwordFile1p = `${passwordFile}.1p`
    const archiveName = relativePath.replaceAll('/', '-')
    const archivePath = join(storageDir, `${archiveName}.tar.gz.gpg`)

    // Check if we're using 1Password or file storage
    const use1Password = await exists(passwordFile1p)

    // Verify password if using file storage
    if (!use1Password && !await exists(passwordFile)) {
      terminal.error(
        `Neither password file ('${passwordFile}') nor 1Password marker ('${passwordFile1p}') found for '${relativePath}'.`,
      )
      terminal.error('Cannot verify password or proceed with removal.')
      return
    }

    terminal.section(`Verifying password for: ${relativePath}`)

    // Verify password
    if (use1Password) {
      // Check 1Password connection
      if (!await isOpAvailable() || !await isSignedIn()) {
        terminal.error('1Password CLI issues detected. Aborting removal.')
        return
      }

      // Get 1Password vault name from config
      const vaultName = config.onePasswordVault || DEFAULT_1PASSWORD_VAULT

      // Get project name for item naming
      const projectName = await getProjectName(repoRoot)
      const itemName = `${PATHS.BASE_NAME}-${projectName}-${pathHash}`

      // Get password from 1Password
      const password = await getPassword(itemName, vaultName)

      if (!password) {
        terminal.error('Failed to retrieve password from 1Password. Aborting removal.')
        return
      }

      // Verify password with a decryption test
      if (!await exists(archivePath)) {
        terminal.error(`Archive not found: ${archivePath}. Aborting removal.`)
        return
      }

      const passwordVerified = await verifyPassword(archivePath, password)

      if (!passwordVerified) {
        terminal.error(
          `Password verification failed using 1Password credential for archive '${archivePath}'.`,
        )
        terminal.error(
          'The password in 1Password might be incorrect or the archive corrupted. Aborting removal.',
        )
        return
      }
    } else {
      // For file storage, verify using the password file
      const password = await Deno.readTextFile(passwordFile)

      if (!await exists(archivePath)) {
        terminal.error(`Archive not found: ${archivePath}. Aborting removal.`)
        return
      }

      const passwordVerified = await verifyPassword(archivePath, password)

      if (!passwordVerified) {
        terminal.error(
          `Password verification failed using '${passwordFile}' for archive '${archivePath}'.`,
        )
        terminal.error('Please check the password file content. Aborting removal.')
        return
      }
    }

    terminal.success('Password verified successfully')
    console.log('')

    // Password verified, proceed with removal
    terminal.section('Removing from gv management...')

    // Store the current pathEntry for project config cleanup
    const removingPathEntry = pathEntry

    // 1. Remove from config
    terminal.status('Updating configuration')
    config.managedPaths = config.managedPaths.filter((p) => p.hash !== pathHash)
    await writeGitVaultConfig(repoRoot, config)

    // 2. Handle password file or 1Password entry
    if (use1Password) {
      terminal.status('Marking 1Password item as removed')

      // Get 1Password vault name from config
      const vaultName = config.onePasswordVault || DEFAULT_1PASSWORD_VAULT

      // Get project name for item naming
      const projectName = await getProjectName(repoRoot)
      const itemName = `${PATHS.BASE_NAME}-${projectName}-${pathHash}`

      // Mark as removed in 1Password
      const marked = await markItemRemoved(itemName, vaultName)

      if (!marked) {
        terminal.warn('Failed to mark 1Password item as removed. Continuing with local cleanup.')
      }

      // Remove marker file
      await Deno.remove(passwordFile1p)
    } else {
      // For file storage, rename password file
      const removedPasswordFile = join(
        dirname(passwordFile),
        `${PATHS.BASE_NAME}-${pathHash}.removed`,
      )
      terminal.status('Preserving password file')
      await Deno.rename(passwordFile, removedPasswordFile)
    }

    // 3. Remove archive file
    terminal.status('Removing encrypted archive')

    // Ignore errors if this fails
    await stageFile(`--rm --cached --ignore-unmatch ${relative(repoRoot, archivePath)}`).catch()

    if (await exists(archivePath)) {
      await Deno.remove(archivePath)
    }

    // 4. Handle .gitignore cleanup
    terminal.status('Checking .gitignore cleanup')
    const gitignorePath = join(repoRoot, '.gitignore')
    const ignorePattern = `/${relativePath}`

    // Check if the pattern exists in the .gitignore
    let patternExists = false
    if (await exists(gitignorePath)) {
      const gitignoreContent = await Deno.readTextFile(gitignorePath)
      const gitignoreLines = gitignoreContent.split('\n')
      patternExists = gitignoreLines.includes(ignorePattern)
    }

    if (patternExists) {
      const confirmed = terminal.createConfirm(
        `Remove '${ignorePattern}' from .gitignore?`,
        false,
      )

      if (confirmed) {
        // Patterns to remove
        const patternsToRemove = [ignorePattern]

        // If there are no more managed paths, also remove the password patterns
        if (config.managedPaths.length === 0) {
          terminal.status('Removing generic password ignore patterns')

          const pwIgnorePattern = `${relative(repoRoot, gitVaultDir)}/*.pw`
          const pw1pIgnorePattern = `${relative(repoRoot, gitVaultDir)}/*.pw.1p`

          patternsToRemove.push(pwIgnorePattern, pw1pIgnorePattern)

          await updateGitignore(repoRoot, patternsToRemove, {
            mode: 'remove',
            removeCommentsMatching: ['GV password files', 'GV 1Password marker files'],
          })
        } else {
          // Just remove the specific pattern
          await updateGitignore(repoRoot, patternsToRemove, { mode: 'remove' })
        }

        await stageFile('.gitignore')
      }
    }

    // 5. Handle project config cleanup
    if (removingPathEntry?.addedTasks) {
      for (const addedTask of removingPathEntry.addedTasks) {
        const shouldRemoveTasks = terminal.createConfirm(
          `Remove Git-Vault tasks from ${addedTask.file}?`,
          true,
        )

        if (shouldRemoveTasks) {
          const success = await removeTasksFromProjectConfig(
            repoRoot,
            addedTask.file as ProjectConfigFile,
          )

          if (success) {
            await stageFile(addedTask.file)
            terminal.info(`Removed Git-Vault tasks from ${addedTask.file}`, '')
          } else {
            terminal.warn(`Failed to remove tasks from ${addedTask.file}`)
          }
        }
      }
    }

    // Show success message
    console.log('')
    terminal.success(`File unmanaged from gv: ${relativePath}`)

    terminal.section('Changes made:')
    terminal.status('Config entry removed from .vault/config.json', '•')
    terminal.status(`Archive ${archivePath} removed`, '•')

    if (use1Password) {
      terminal.status('1Password item marked as removed', '•')
      terminal.status('1Password marker file removed', '•')
    } else {
      const removedPasswordFile = join(
        dirname(passwordFile),
        `${PATHS.BASE_NAME}-${pathHash}.removed`,
      )
      terminal.status(`Password file preserved as ${removedPasswordFile}`, '•')
    }

    terminal.section('Next steps:')
    terminal.status('Please commit the changes made to:', '•')
    terminal.status('.vault/config.json', ' ')
    terminal.status('.gitignore (if modified)', ' ')
    terminal.status('Any removal of tracked archives', ' ')

    terminal.section('Note:')
    terminal.status(`The original path '${relativePath}' remains in your working directory.`)

    if (use1Password) {
      terminal.warn('The password item in 1Password was marked as removed but not deleted.')
    }
  } catch (error) {
    terminal.error('Failed to remove file', error)
  }
}

export default run satisfies CommandHandler
