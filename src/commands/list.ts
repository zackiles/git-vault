import { join } from '@std/path'
import { exists } from '@std/fs'
import { bold, cyan, yellow } from '@std/fmt/colors'
import terminal from '../utils/terminal.ts'
import type { BaseCommandArgs, CommandHandler } from '../types.ts'
import { getRepositoryRoot, isLfsAvailable } from '../services/git.ts'
import { getFileSizeMB } from '../utils/compression.ts'
import { dedent } from '@qnighy/dedent'
import { readGitVaultConfig } from '../utils/config.ts'

/**
 * List command implementation
 *
 * Lists all files and directories managed by git-vault
 */
async function listCommand(args: BaseCommandArgs): Promise<void> {
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
      console.log('No files are currently managed by git-vault.')
      console.log(`Configuration file '.vault/config.json' not found.`)
      return
    }

    // Check if there are any managed paths
    if (config.managedPaths.length === 0) {
      console.log('No files are currently managed by git-vault.')
      return
    }

    // Display header
    console.log(dedent`\n${bold('Files managed by git-vault:')}\n`)
    console.log(dedent`${bold('Storage mode:')} ${cyan(config.storageMode)}\n`)

    // Format table headers
    const headers = [bold('Path'), bold('Hash'), bold('Archive Size'), bold('Status')]
    const columnWidths = [40, 10, 15, 15]

    // Print table header
    console.log(
      headers[0].padEnd(columnWidths[0]) +
        headers[1].padEnd(columnWidths[1]) +
        headers[2].padEnd(columnWidths[2]) +
        headers[3],
    )

    // Print separator
    console.log(
      '-'.repeat(columnWidths[0]) +
        '-'.repeat(columnWidths[1]) +
        '-'.repeat(columnWidths[2]) +
        '-'.repeat(columnWidths[3]),
    )

    // Process each entry
    for (const { hash, path: pathFromConfig } of config.managedPaths) {
      // Determine archive path
      const archiveName = pathFromConfig.replaceAll('/', '-')
      const archivePath = join(storageDir, `${archiveName}.tar.gz.gpg`)

      // Determine status
      let status = 'OK'
      let archiveSize = 'N/A'

      // Check if archive exists
      if (await exists(archivePath)) {
        // Get archive size
        const size = await getFileSizeMB(archivePath)
        archiveSize = `${size.toFixed(2)} MB`

        // Check if original file exists
        const originalPath = join(repoRoot, pathFromConfig)
        if (!await exists(originalPath)) {
          status = 'Missing file'
        }
      } else {
        status = 'Missing archive'
      }

      // Check password file or 1Password marker
      const passwordFile = join(gitVaultDir, `git-vault-${hash}.pw`)
      const passwordFile1p = `${passwordFile}.1p`

      if (config.storageMode === '1password' && !await exists(passwordFile1p)) {
        status = 'Missing 1P marker'
      } else if (config.storageMode === 'file' && !await exists(passwordFile)) {
        status = 'Missing password'
      }

      // Format path for display (trim if too long)
      let displayPath = pathFromConfig
      if (displayPath.length > columnWidths[0] - 3) {
        displayPath = `...${displayPath.substring(displayPath.length - (columnWidths[0] - 3))}`
      }

      // Status colors based on condition
      const getStatusColor = (status: string) => {
        if (status === 'OK') return cyan(status)
        return yellow(status)
      }

      // Print table row
      console.log(
        displayPath.padEnd(columnWidths[0]) +
          cyan(hash).padEnd(columnWidths[1]) +
          archiveSize.padEnd(columnWidths[2]) +
          getStatusColor(status),
      )
    }

    console.log(dedent`\n${bold('Total:')} ${cyan(`${config.managedPaths.length}`)} file(s)\n`)

    // Check LFS status
    const lfsAvailable = await isLfsAvailable()
    if (lfsAvailable) {
      console.log(
        `${bold('Git LFS')} is available (threshold: ${cyan(`${config.lfsThresholdMB} MB`)})`,
      )
    } else {
      console.log(`${bold('Git LFS')} is ${yellow('not available')}`)
    }
  } catch (error) {
    terminal.error(
      `Failed to list files: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const list: CommandHandler = { run: listCommand }

export default list
