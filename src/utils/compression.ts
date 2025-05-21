/**
 * Compression utility functions for git-vault
 *
 * This file provides functions for creating and extracting compressed archives.
 */

import * as path from '@std/path'
import * as fs from '@std/fs'

/**
 * Creates a tar.gz archive from a file or directory
 *
 * @param sourcePath Path to the file or directory to archive
 * @param destPath Path where the archive will be stored
 * @returns Promise that resolves to true if successful, false otherwise
 */
export async function createArchive(sourcePath: string, destPath: string): Promise<boolean> {
  try {
    // Ensure the destination directory exists
    await fs.ensureDir(path.dirname(destPath))

    // Create tar.gz archive using the tar command
    const tarProcess = new Deno.Command('tar', {
      args: [
        'czf',
        destPath,
        '-C',
        path.dirname(sourcePath),
        path.basename(sourcePath),
      ],
      stdout: 'piped',
      stderr: 'piped',
    })

    const { success, stderr } = await tarProcess.output()

    if (!success) {
      console.error('Archive creation failed:', new TextDecoder().decode(stderr))
    }

    return success
  } catch (error) {
    console.error('Archive creation error:', error instanceof Error ? error.message : String(error))
    return false
  }
}

/**
 * Extracts a tar.gz archive
 *
 * @param archivePath Path to the archive
 * @param extractPath Path where the contents should be extracted
 * @returns Promise that resolves to true if successful, false otherwise
 */
export async function extractArchive(archivePath: string, extractPath: string): Promise<boolean> {
  try {
    // Ensure the extraction directory exists
    await fs.ensureDir(extractPath)

    // Extract the archive using the tar command
    const tarProcess = new Deno.Command('tar', {
      args: [
        'xzf',
        archivePath,
        '-C',
        extractPath,
      ],
      stdout: 'piped',
      stderr: 'piped',
    })

    const { success, stderr } = await tarProcess.output()

    if (!success) {
      console.error('Archive extraction failed:', new TextDecoder().decode(stderr))
    }

    return success
  } catch (error) {
    console.error(
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
export async function getFileSizeMB(filePath: string): Promise<number> {
  try {
    const fileInfo = await Deno.stat(filePath)
    return fileInfo.size / (1024 * 1024) // Convert bytes to MB
  } catch (error) {
    console.error(
      'Error getting file size:',
      error instanceof Error ? error.message : String(error),
    )
    return 0
  }
}
