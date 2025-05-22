/**
 * Compression utility functions for git-vault
 */

import { basename, dirname, join } from '@std/path'
import { ensureDir } from '@std/fs'
import terminal from '../utils/terminal.ts'
import {
  configure as configureZipJs,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from '@zip-js/zip-js'
import type { Entry } from '@zip-js/zip-js'

// Configure zip-js to terminate workers immediately to avoid timer leaks
configureZipJs({
  useWebWorkers: false,
  terminateWorkerTimeout: 0,
})

/**
 * Helper function to add files to a zip archive recursively
 */
async function addFilesToZip(
  zipWriter: ZipWriter<unknown>,
  dir: string,
  baseDir: string,
): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    const entryPath = join(dir, entry.name)
    const relativePath = entryPath.slice(baseDir.length + 1)

    if (entry.isDirectory) {
      await addFilesToZip(zipWriter, entryPath, baseDir)
    } else {
      const fileData = await Deno.readFile(entryPath)
      await zipWriter.add(relativePath, new Uint8ArrayReader(fileData))
    }
  }
}

/**
 * Compresses files into a zip archive
 *
 * @param sourcePath Path to the file or directory to compress, or array of paths
 * @param targetPath Path where the zip file will be created
 */
async function compressToZip(
  sourcePath: string | string[],
  targetPath: string,
): Promise<void> {
  const zipWriter = new ZipWriter(new Uint8ArrayWriter())

  try {
    // If sourcePath is an array, add each file to the zip
    if (Array.isArray(sourcePath)) {
      for (const path of sourcePath) {
        const sourceInfo = await Deno.stat(path)
        const fileName = path.split(/[\\/]/).pop() || 'binary'

        if (sourceInfo.isFile) {
          const fileData = await Deno.readFile(path)
          await zipWriter.add(fileName, new Uint8ArrayReader(fileData))
        } else if (sourceInfo.isDirectory) {
          await addFilesToZip(zipWriter, path, path)
        } else {
          throw new Error(`Source path ${path} is neither a file nor a directory`)
        }
      }
    } else {
      // Single file/directory logic
      const sourceInfo = await Deno.stat(sourcePath)

      if (sourceInfo.isFile) {
        const [fileData, fileName] = await Promise.all([
          Deno.readFile(sourcePath),
          Promise.resolve(join(sourcePath).split(/[\\/]/).pop() || 'binary'),
        ])

        await zipWriter.add(fileName, new Uint8ArrayReader(fileData))
      } else if (sourceInfo.isDirectory) {
        await addFilesToZip(zipWriter, sourcePath, sourcePath)
      } else {
        throw new Error(`Source path ${sourcePath} is neither a file nor a directory`)
      }
    }

    const zipData = await zipWriter.close()
    await Deno.writeFile(targetPath, zipData)
  } finally {
    await zipWriter.close().catch(() => {})
  }
}

/**
 * Extracts a zip archive
 *
 * @param source Source file path or URL
 * @param targetDir Directory to extract contents to
 * @param options Additional options for extraction
 */
async function extractZip(
  source: string | URL,
  targetDir: string,
  options: {
    isUrl?: boolean
    filter?: (entry: Entry) => boolean
    transformPath?: (path: string) => string
  } = {},
): Promise<void> {
  const { isUrl = false, filter, transformPath } = options

  try {
    const zipData = isUrl
      ? new Uint8Array(await (await fetch(source.toString())).arrayBuffer())
      : await Deno.readFile(source.toString())

    const zipReader = new ZipReader(new Uint8ArrayReader(zipData))

    try {
      const entries = await zipReader.getEntries()
      await ensureDir(targetDir)

      for (const entry of entries) {
        if (entry.directory || !entry.getData) continue
        if (filter && !filter(entry)) continue

        let targetPath = join(targetDir, entry.filename)
        if (transformPath) {
          targetPath = join(targetDir, transformPath(entry.filename))
        }

        await ensureDir(dirname(targetPath))
        const fileData = await entry.getData(new Uint8ArrayWriter())
        await Deno.writeFile(targetPath, fileData)
      }
    } finally {
      await zipReader.close().catch(() => {})
    }
  } catch (error) {
    const errorType = isUrl ? 'download' : 'read'
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to ${errorType} or extract from ${source}: ${message}`)
  }
}

/**
 * Creates a compressed archive from a file or directory
 *
 * @param sourcePath Path to the file or directory to archive
 * @param destPath Path where the archive will be stored
 * @returns Promise that resolves to true if successful, false otherwise
 */
async function createArchive(sourcePath: string, destPath: string): Promise<boolean> {
  try {
    // Check for unsupported characters in the filename
    const fileName = basename(sourcePath)
    if (fileName.includes('@')) {
      throw new Error('Filenames containing @ character are not supported')
    }

    const isTarGz = destPath.endsWith('.tar.gz')

    if (isTarGz) {
      // For tar.gz, first create a temporary directory
      const tempDir = await Deno.makeTempDir()
      try {
        // Copy the source to temp directory
        const tempPath = join(tempDir, fileName)

        const sourceInfo = await Deno.stat(sourcePath)
        if (sourceInfo.isDirectory) {
          // For directories, copy the entire contents
          const copyCmd = new Deno.Command('cp', {
            args: ['-r', sourcePath, tempPath],
          })
          const { success: copySuccess } = await copyCmd.output()
          if (!copySuccess) throw new Error('Failed to copy directory')
        } else {
          // For files, just copy the file
          await Deno.copyFile(sourcePath, tempPath)
        }

        // Create tar.gz using platform-independent commands
        // Use -- to separate options from filenames with special characters like @
        const tarArgs = ['czf', destPath, '-C', tempDir, '--', fileName]
        const tarCmd = new Deno.Command('tar', {
          args: tarArgs,
        })
        const { success } = await tarCmd.output()

        if (!success) {
          throw new Error('Failed to create tar.gz archive')
        }

        return true
      } finally {
        // Clean up temp directory
        await Deno.remove(tempDir, { recursive: true })
      }
    } else {
      // For zip files, use our platform-independent zip implementation
      await compressToZip(sourcePath, destPath)
      return true
    }
  } catch (error) {
    terminal.error(
      'Archive creation error:',
      error instanceof Error ? error.message : String(error),
    )
    return false
  }
}

/**
 * Extracts a compressed archive
 *
 * @param archivePath Path to the archive
 * @param extractPath Path where the contents should be extracted
 * @returns Promise that resolves to true if successful, false otherwise
 */
async function extractArchive(archivePath: string, extractPath: string): Promise<boolean> {
  try {
    const isTarGz = archivePath.endsWith('.tar.gz')

    if (isTarGz) {
      await ensureDir(extractPath)

      // Extract tar.gz using platform-independent command
      // Use -- to separate options from filenames with special characters like @
      const tarArgs = ['xzf', archivePath, '-C', extractPath, '--']
      const tarCmd = new Deno.Command('tar', {
        args: tarArgs,
      })
      const { success } = await tarCmd.output()

      if (!success) {
        throw new Error('Failed to extract tar.gz archive')
      }

      return true
    } else {
      // For zip files, use our platform-independent zip implementation
      await extractZip(archivePath, extractPath)
      return true
    }
  } catch (error) {
    terminal.error(
      'Archive extraction error:',
      error instanceof Error ? error.message : String(error),
    )
    return false
  }
}

/**
 * Gets the size of a file in megabytes
 *
 * @param filePath Path to the file
 * @returns Size in megabytes
 */
async function getFileSizeMB(filePath: string): Promise<number> {
  try {
    const fileInfo = await Deno.stat(filePath)
    return fileInfo.size / (1024 * 1024) // Convert bytes to MB
  } catch (error) {
    console.warn(
      'Error getting file size:',
      error instanceof Error ? error.message : String(error),
    )
    return 0
  }
}

export { createArchive, extractArchive, getFileSizeMB }
