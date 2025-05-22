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
 * Lists all files and directories managed by gv
 */
async function run(args: BaseCommandArgs): Promise<void> {
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

    console.log(dedent`\n${bold('Files managed by gv:')}\n`)
    console.log(dedent`${bold('Storage mode:')} ${cyan(config.storageMode)}\n`)

    const headers = [bold('Path'), bold('Hash'), bold('Archive Size'), bold('Status')]
    const columnWidths = [40, 10, 15, 15]

    console.log(
      headers[0].padEnd(columnWidths[0]) +
        headers[1].padEnd(columnWidths[1]) +
        headers[2].padEnd(columnWidths[2]) +
        headers[3],
    )

    console.log(
      '-'.repeat(columnWidths[0]) +
        '-'.repeat(columnWidths[1]) +
        '-'.repeat(columnWidths[2]) +
        '-'.repeat(columnWidths[3]),
    )

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

      const passwordFile = join(gitVaultDir, `gv-${hash}.pw`)
      const passwordFile1p = `${passwordFile}.1p`

      if (config.storageMode === '1password' && !await exists(passwordFile1p)) {
        status = 'Missing 1P marker'
      } else if (config.storageMode === 'file' && !await exists(passwordFile)) {
        status = 'Missing password'
      }

      let displayPath = pathFromConfig
      if (displayPath.length > columnWidths[0] - 3) {
        displayPath = `...${displayPath.substring(displayPath.length - (columnWidths[0] - 3))}`
      }

      const getStatusColor = (status: string) => {
        if (status === 'OK') return cyan(status)
        return yellow(status)
      }

      console.log(
        displayPath.padEnd(columnWidths[0]) +
          cyan(hash).padEnd(columnWidths[1]) +
          archiveSize.padEnd(columnWidths[2]) +
          getStatusColor(status),
      )
    }

    console.log(dedent`\n${bold('Total:')} ${cyan(`${config.managedPaths.length}`)} file(s)\n`)

    const lfsAvailable = await isLfsAvailable()
    if (lfsAvailable) {
      console.log(
        `${bold('Git LFS')} is available (threshold: ${cyan(`${config.lfsThresholdMB} MB`)})`,
      )
    } else {
      console.log(`${bold('Git LFS')} is ${yellow('not available')}`)
    }
  } catch (error) {
    terminal.error('Failed to list files', error)
  }
}

export default run satisfies CommandHandler
