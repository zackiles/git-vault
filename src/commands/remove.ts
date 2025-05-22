import { dirname, join, relative, resolve } from '@std/path'
import { exists } from '@std/fs'
import { bold, cyan, yellow } from '@std/fmt/colors'
import terminal from '../utils/terminal.ts'
import type { BaseCommandArgs, CommandHandler } from '../types.ts'
import { generateHash } from '../utils/crypto.ts'
import { getProjectName, getRepositoryRoot, stageFile } from '../services/git.ts'
import { verifyPassword } from '../services/gpg.ts'
import { getPassword, isOpAvailable, isSignedIn, markItemRemoved } from '../services/op.ts'
import { dedent } from '@qnighy/dedent'
import { readGitVaultConfig, writeGitVaultConfig } from '../utils/config.ts'
import { DEFAULT_1PASSWORD_VAULT } from '../constants.ts'

/**
 * Remove command implementation
 *
 * Removes a file or directory from gv management
 */
async function run(args: BaseCommandArgs): Promise<void> {
  const paths = args._

  if (paths.length === 0) {
    terminal.error(bold('No path specified'))
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
    const resolvedPath = resolve(paths[0])
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
      terminal.error(`Path not managed by gv: ${paths[0]} (hash ${pathHash})`)
      return
    }

    // Determine file paths
    const passwordFile = join(gitVaultDir, `gv-${pathHash}.pw`)
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

    // Verify password
    if (use1Password) {
      console.log(`${bold('Verifying password:')} via 1Password for '${cyan(relativePath)}'...`)

      // Check 1Password connection
      if (!await isOpAvailable() || !await isSignedIn()) {
        terminal.error('1Password CLI issues detected. Aborting removal.')
        return
      }

      // Get 1Password vault name from config
      const vaultName = config.onePasswordVault || DEFAULT_1PASSWORD_VAULT

      // Get project name for item naming
      const projectName = await getProjectName(repoRoot)
      const itemName = `gv-${projectName}-${pathHash}`

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
      console.log(`${bold('Verifying password:')} via local file for '${cyan(relativePath)}'...`)
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

    // Password verified, proceed with removal
    console.log(bold('\nProceeding with removal...'))

    // 1. Remove from config
    console.log(`${bold('Step 1:')} Removing entry from config '${cyan('.vault/config.json')}'...`)
    config.managedPaths = config.managedPaths.filter((p) => p.hash !== pathHash)
    await writeGitVaultConfig(repoRoot, config)

    // 2. Handle password file or 1Password entry
    if (use1Password) {
      console.log(`${bold('Step 2:')} Marking 1Password item as removed...`)

      // Get 1Password vault name from config
      const vaultName = config.onePasswordVault || DEFAULT_1PASSWORD_VAULT

      // Get project name for item naming
      const projectName = await getProjectName(repoRoot)
      const itemName = `gv-${projectName}-${pathHash}`

      // Mark as removed in 1Password
      const marked = await markItemRemoved(itemName, vaultName)

      if (!marked) {
        console.log(
          'Error: Failed to mark 1Password item as removed. Continuing with local cleanup.',
        )
      }

      // Remove marker file
      console.log(`${bold('Step 3:')} Removing 1Password marker file '${cyan(passwordFile1p)}'...`)
      await Deno.remove(passwordFile1p)
    } else {
      // For file storage, rename password file
      const removedPasswordFile = join(dirname(passwordFile), `gv-${pathHash}.removed`)
      console.log(`${bold('Step 2:')} Renaming password file to '${cyan(removedPasswordFile)}'...`)
      await Deno.rename(passwordFile, removedPasswordFile)
    }

    // 3. Remove archive file
    console.log(
      `${bold('Step 3:')} Removing archive file '${
        cyan(archivePath)
      }' from Git index and filesystem...`,
    )

    // Ignore errors if this fails
    await stageFile(`--rm --cached --ignore-unmatch ${relative(repoRoot, archivePath)}`).catch()

    if (await exists(archivePath)) {
      await Deno.remove(archivePath)
    }

    console.log(' - Checking .gitignore for ignore rule...')
    const gitignorePath = join(repoRoot, '.gitignore')

    const ignorePattern = `/${relativePath}`

    if (await exists(gitignorePath)) {
      const gitignoreContent = await Deno.readTextFile(gitignorePath)
      const gitignoreLines = gitignoreContent.split('\n')

      if (gitignoreLines.includes(ignorePattern)) {
        const confirmed = terminal.confirm(
          `Remove '${ignorePattern}' from .gitignore?`,
          false,
        )

        if (confirmed) {
          console.log(`   Removing '${ignorePattern}' from .gitignore...`)

          const newGitignore = gitignoreLines.filter((line) => line !== ignorePattern).join('\n')
          await Deno.writeTextFile(gitignorePath, newGitignore)

          if (config.managedPaths.length === 0) {
            console.log('   No more managed paths. Removing generic password ignore patterns...')

            const pwIgnorePattern = `${relative(repoRoot, gitVaultDir)}/*.pw`
            const pwCommentLine = '# GV password files (DO NOT COMMIT)'
            const pw1pIgnorePattern = `${relative(repoRoot, gitVaultDir)}/*.pw.1p`
            const pw1pCommentLine = '# GV 1Password marker files (DO NOT COMMIT)'

            const finalGitignore = (await Deno.readTextFile(gitignorePath))
              .split('\n')
              .filter((line) =>
                line !== pwCommentLine &&
                line !== pwIgnorePattern &&
                line !== pw1pCommentLine &&
                line !== pw1pIgnorePattern
              )
              .join('\n')

            await Deno.writeTextFile(gitignorePath, finalGitignore)
          }

          console.log('   Staging updated .gitignore...')
          await stageFile('.gitignore')
        } else {
          console.log(`   Keeping '${ignorePattern}' in .gitignore.`)
        }
      } else {
        console.log(`   Ignore pattern '${ignorePattern}' not found in .gitignore.`)
      }
    }

    // Show success message
    console.log('')
    terminal.success(bold('File successfully unmanaged from gv'))
    console.log(`${bold('Path:')} ${cyan(relativePath)}`)
    console.log(`${bold('Changes made:')}`)
    console.log(` - Config entry removed from ${cyan('.vault/config.json')}`)

    if (use1Password) {
      console.log(' - 1Password item marked as removed')
      console.log(` - 1Password marker file ${cyan(passwordFile1p)} removed`)
    } else {
      const removedPasswordFile = join(dirname(passwordFile), `gv-${pathHash}.removed`)
      console.log(` - Password file renamed to ${cyan(removedPasswordFile)}`)
    }

    console.log(` - Archive ${cyan(archivePath)} removed`)

    console.log(dedent`\n${bold('Next steps:')}`)
    console.log('Please commit the changes made to:')
    console.log(` - ${cyan('.vault/config.json')}`)
    console.log(' - .gitignore (if modified)')
    console.log(` - Any removal of ${cyan(archivePath)} tracked by Git`)

    console.log(dedent`\n${bold('Note:')}`)
    console.log(
      `The original plaintext path '${cyan(relativePath)}' remains in your working directory.`,
    )

    if (use1Password) {
      console.log(
        `The password item in 1Password was marked as ${yellow('removed')} but not deleted.`,
      )
    } else {
      const removedPasswordFile = join(dirname(passwordFile), `gv-${pathHash}.removed`)
      console.log(
        `The password file was renamed to '${cyan(removedPasswordFile)}' for potential recovery.`,
      )
    }
  } catch (error) {
    terminal.error('Failed to remove file', error)
  }
}

export default run satisfies CommandHandler
