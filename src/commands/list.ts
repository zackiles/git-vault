import { join } from '@std/path'
import { exists } from '@std/fs'
import { bold, cyan, yellow } from '@std/fmt/colors'
import terminal from '../utils/terminal.ts'
import type { CommandArgs, CommandHandler } from '../types.ts'
import { getRepositoryRoot, isLfsAvailable } from '../services/git.ts'
import { getFileSizeMB } from '../utils/compression.ts'
import { readGitVaultConfig } from '../utils/config.ts'
import { PATHS } from '../paths.ts'

/**
 * Lists all files and directories managed by gv
 */
async function run(args: CommandArgs): Promise<void> {
  try {
    const repoRoot = await getRepositoryRoot(args.workspace as string)
    if (!repoRoot) {
      terminal.error(`Not a Git repository: ${args.workspace}`)
      return
    }

    const gitVaultDir = join(repoRoot, '.vault')
    const storageDir = join(gitVaultDir, 'storage')

    const config = await readGitVaultConfig(repoRoot)

    if (!config) {
      console.log('No files are currently managed by gv.')
      console.log(`Configuration file '.vault/config.json' not found.`)
      return
    }

    if (config.managedPaths.length === 0) {
      console.log('No files are currently managed by gv.')
      return
    }

    terminal.section('Files managed by gv:')
    terminal.info('Storage mode:', config.storageMode)
    console.log('')

    // Get console dimensions
    const { columns } = Deno.consoleSize()

    // Calculate column widths as percentages of the console width
    // Ensure we leave some padding for visual separation
    const pathWidth = Math.floor(columns * 0.4)
    const hashWidth = Math.floor(columns * 0.2)
    const sizeWidth = Math.floor(columns * 0.15)
    const statusWidth = Math.floor(columns * 0.15)

    // Define column headers
    const path = bold('Path')
    const hashArchive = bold('HashArchive')
    const size = bold('Size')
    const status = bold('Status')

    // Print headers with dynamic spacing
    console.log(
      `${path}${' '.repeat(pathWidth - path.length)}` +
        `${hashArchive}${' '.repeat(hashWidth - hashArchive.length)}` +
        `${size}${' '.repeat(sizeWidth - size.length)}` +
        `${status}`,
    )

    // Adjusted divider line to match the actual content width
    const totalWidth = pathWidth + hashWidth + sizeWidth + statusWidth
    console.log('-'.repeat(Math.min(columns, totalWidth)))

    for (const { hash, path: pathFromConfig } of config.managedPaths) {
      const archiveName = pathFromConfig.replaceAll('/', '-')
      const archivePath = join(storageDir, `${archiveName}.tar.gz.gpg`)

      let status = 'OK'
      let archiveSize = 'N/A'

      if (await exists(archivePath)) {
        const size = await getFileSizeMB(archivePath)
        archiveSize = `${size.toFixed(2)} MB`

        const originalPath = join(repoRoot, pathFromConfig)
        if (!await exists(originalPath)) {
          status = 'Missing file'
        }
      } else {
        status = 'Missing archive'
      }

      const passwordFile = join(gitVaultDir, `${PATHS.BASE_NAME}-${hash}.pw`)
      const passwordFile1p = `${passwordFile}.1p`

      if (config.storageMode === '1password' && !await exists(passwordFile1p)) {
        status = 'Missing 1P marker'
      } else if (config.storageMode === 'file' && !await exists(passwordFile)) {
        status = 'Missing password'
      }

      // Truncate long paths with ellipsis
      let displayPath = pathFromConfig
      if (displayPath.length > pathWidth - 3) {
        displayPath = `...${displayPath.substring(displayPath.length - (pathWidth - 6))}`
      }

      const getStatusColor = (status: string) => {
        if (status === 'OK') return cyan(status)
        return yellow(status)
      }

      // Print row with dynamic spacing matching the headers
      console.log(
        `${displayPath}${' '.repeat(Math.max(0, pathWidth - displayPath.length))}` +
          `${cyan(hash)}${' '.repeat(Math.max(0, hashWidth - hash.length))}` +
          `${archiveSize}${' '.repeat(Math.max(0, sizeWidth - archiveSize.length))}` +
          `${getStatusColor(status)}`,
      )
    }

    console.log('')
    terminal.info('Total:', `${config.managedPaths.length} file(s)`)
    console.log('')

    const lfsAvailable = await isLfsAvailable()
    if (lfsAvailable) {
      terminal.info('Git LFS', `is available (threshold: ${config.lfsThresholdMB} MB)`)
    } else {
      terminal.warn('Git LFS is not available')
    }
  } catch (error) {
    terminal.error('Failed to list files', error)
  }
}

export default run satisfies CommandHandler
