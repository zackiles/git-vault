#!/usr/bin/env -S deno run --allow-all

/**
 * @module compile
 * @description Compiles git-vault into native binaries for all platforms
 *
 * This script uses the Deno compile command to create platform-specific binaries
 * and then compresses them into archives for distribution.
 *
 * bin-path - Specifies the output directory for compiled binaries and archives.
 *                      Defaults to 'bin' if not provided.
 *                      Alias: -o
 *                      Example: deno run -A scripts/build.ts --bin-path=./dist
 */

import { join } from '@std/path/join'
import { ensureDir } from '@std/fs'
import { parseArgs } from '@std/cli/parse-args'

// The target platforms supported by Deno compile
const TARGETS = [
  'x86_64-unknown-linux-gnu',
  'aarch64-unknown-linux-gnu',
  'x86_64-pc-windows-msvc',
  'x86_64-apple-darwin',
  'aarch64-apple-darwin',
]

// Additional files to include in the archive
const ADDITIONAL_FILES = [
  'README.md',
  'LICENSE',
  'install.sh',
]

interface CompileOptions {
  binPath: string
}

async function compress(files: string[], outputPath: string, isTarGz = false) {
  if (isTarGz) {
    // Create tar.gz archive
    const tempDir = await Deno.makeTempDir()

    // Copy all files to temp directory
    for (const file of files) {
      const destFile = join(tempDir, file.split('/').pop() || '')
      await Deno.copyFile(file, destFile)
    }

    // Create tar.gz
    const tarArgs = ['-czf', outputPath, '-C', tempDir, '.']
    const tarCmd = new Deno.Command('tar', { args: tarArgs })
    const tarOutput = await tarCmd.output()

    if (!tarOutput.success) {
      const errorMsg = new TextDecoder().decode(tarOutput.stderr)
      throw new Error(`Failed to create tar.gz archive: ${errorMsg}`)
    }

    // Clean up temp directory
    await Deno.remove(tempDir, { recursive: true })
    return
  }

  // Create zip archive
  const isWindows = Deno.build.os === 'windows'
  const zipCommand = isWindows ? 'powershell' : 'zip'
  const zipArgs = isWindows
    ? ['-Command', `Compress-Archive -Path ${files.join(',')} -DestinationPath ${outputPath}`]
    : ['-j', outputPath, ...files]

  const cmd = new Deno.Command(zipCommand, { args: zipArgs })
  const output = await cmd.output()

  if (!output.success) {
    const errorMsg = new TextDecoder().decode(output.stderr)
    throw new Error(`Failed to create archive: ${errorMsg}`)
  }
}

async function compile({ binPath }: CompileOptions) {
  // Ensure the output directory exists
  await ensureDir(binPath)

  const entryPoint = join(Deno.cwd(), 'src', 'cli.ts')
  const resources = ['deno.json']

  console.log('Compiling binaries for all platforms...')

  for (const target of TARGETS) {
    const isWindows = target.includes('windows')
    const binaryName = `gv-${target}${isWindows ? '.exe' : ''}`
    const outputFile = join(binPath, binaryName)

    try {
      await Deno.remove(outputFile)
      console.log(`Removed existing binary: ${outputFile}`)
    } catch (error: unknown) {
      // File doesn't exist, which is fine
      if (!(error instanceof Deno.errors.NotFound)) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.warn(`Warning when removing ${outputFile}: ${errorMessage}`)
      }
    }

    console.log(`Compiling for ${target}...`)

    const compileArgs = [
      'compile',
      '--target',
      target,
      '--output',
      outputFile,
      '--allow-all',
      ...resources.flatMap((resource) => ['--include', resource]),
    ]

    // Add icon only for Windows builds
    if (isWindows) {
      compileArgs.push('--icon', join(Deno.cwd(), 'logo.ico'))
    }

    // Add entry point at the end
    compileArgs.push(entryPoint)

    const cmd = new Deno.Command('deno', {
      args: compileArgs,
    })

    const output = await cmd.output()

    if (!output.success) {
      const errorMsg = new TextDecoder().decode(output.stderr)
      console.error(`Failed to compile for ${target}: ${errorMsg}`)
      continue
    }

    console.log(`Successfully compiled for ${target}: ${outputFile}`)

    const archivePath = `${outputFile}.zip`
    const tarGzPath = `${outputFile}.tar.gz`

    try {
      // Handle zip archive
      try {
        await Deno.remove(archivePath)
        console.log(`Removed existing archive: ${archivePath}`)
      } catch (error: unknown) {
        if (!(error instanceof Deno.errors.NotFound)) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          console.warn(`Warning when removing ${archivePath}: ${errorMessage}`)
        }
      }

      // Compress the binary with additional files
      const filesToCompress = [outputFile, ...ADDITIONAL_FILES]
      await compress(filesToCompress, archivePath)
      console.log(`Compressed binary and additional files to ${archivePath}`)

      // Also create tar.gz for Homebrew
      try {
        await Deno.remove(tarGzPath)
        console.log(`Removed existing tar.gz: ${tarGzPath}`)
      } catch (error: unknown) {
        if (!(error instanceof Deno.errors.NotFound)) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          console.warn(`Warning when removing ${tarGzPath}: ${errorMessage}`)
        }
      }

      await compress(filesToCompress, tarGzPath, true)
      console.log(`Created tar.gz archive at ${tarGzPath}`)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Failed to compress files: ${errorMessage}`)
    }
  }

  // Create symlinks for the latest versions
  try {
    await createLatestSymlinks(binPath)
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`Failed to create latest symlinks: ${errorMessage}`)
  }

  console.log('Compilation complete!')
}

async function createLatestSymlinks(binPath: string) {
  const platforms = {
    'linux': 'x86_64-unknown-linux-gnu',
    'linux-arm': 'aarch64-unknown-linux-gnu',
    'windows': 'x86_64-pc-windows-msvc',
    'macos': 'x86_64-apple-darwin',
    'macos-arm': 'aarch64-apple-darwin',
  }

  for (const [platform, target] of Object.entries(platforms)) {
    const isWindows = platform === 'windows'
    const originalBinary = `gv-${target}${isWindows ? '.exe' : ''}`
    const latestBinary = `gv-${platform}${isWindows ? '.exe' : ''}`
    const originalArchive = `${originalBinary}.zip`
    const latestArchive = `${latestBinary}.zip`
    const originalTarGz = `${originalBinary}.tar.gz`
    const latestTarGz = `${latestBinary}.tar.gz`

    // Create a copy of the latest binary and archive (symlinks may not work well cross-platform)
    const binarySource = join(binPath, originalBinary)
    const binaryDest = join(binPath, latestBinary)
    const archiveSource = join(binPath, originalArchive)
    const archiveDest = join(binPath, latestArchive)
    const tarGzSource = join(binPath, originalTarGz)
    const tarGzDest = join(binPath, latestTarGz)

    try {
      await Deno.copyFile(binarySource, binaryDest)
      await Deno.copyFile(archiveSource, archiveDest)
      await Deno.copyFile(tarGzSource, tarGzDest)
      console.log(`Created latest copies for ${platform}`)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.warn(`Warning when creating latest copy for ${platform}: ${errorMessage}`)
    }
  }
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: ['bin-path'],
    default: {
      'bin-path': join(Deno.cwd(), 'bin'),
    },
    alias: {
      o: 'bin-path',
    },
  })

  await compile({
    binPath: args['bin-path'],
  })
}
