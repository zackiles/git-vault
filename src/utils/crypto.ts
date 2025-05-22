/**
 * Crypto utility functions for git-vault
 *
 * This file provides functions for symmetric encryption and decryption of files
 * using GPG-compatible encryption standards.
 */

import { encodeHex } from '@std/encoding/hex'
import { crypto } from '@std/crypto'
import * as path from '@std/path'
import * as fs from '@std/fs'

/**
 * Generates a SHA-1 hash for a given string
 * Used to generate unique IDs for managed paths
 */
async function generateHash(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-1', data)
  const hashHex = encodeHex(new Uint8Array(hashBuffer))
  return hashHex.slice(0, 8) // Return first 8 characters (4 bytes) as the hash
}

/**
 * Encrypts a file or directory using GPG
 *
 * @param sourceFilePath Path to the file or directory to encrypt
 * @param destFilePath Path where the encrypted file will be stored
 * @param password Password for encryption
 * @param isDirectory Whether the source is a directory
 */
async function encrypt(
  sourceFilePath: string,
  destFilePath: string,
  password: string,
  isDirectory: false,
): Promise<boolean> {
  try {
    const tempDir = await Deno.makeTempDir()
    let archivePath = destFilePath

    if (isDirectory) {
      archivePath = path.join(tempDir, `${path.basename(sourceFilePath)}.tar.gz`)

      const tarProcess = new Deno.Command('tar', {
        args: [
          'czf',
          archivePath,
          '-C',
          path.dirname(sourceFilePath),
          path.basename(sourceFilePath),
        ],
      })

      const tarStatus = await tarProcess.output()
      if (!tarStatus.success) {
        console.error('Failed to create archive for directory')
        return false
      }
    } else {
      archivePath = sourceFilePath
    }

    const gpgProcess = new Deno.Command('gpg', {
      args: [
        '--batch',
        '--yes',
        '--passphrase',
        password,
        '-c',
        '--output',
        destFilePath,
        archivePath,
      ],
    })

    const gpgStatus = await gpgProcess.output()

    if (isDirectory) {
      await Deno.remove(tempDir, { recursive: true })
    }

    return gpgStatus.success
  } catch (error) {
    console.error('Encryption error:', error)
    return false
  }
}

/**
 * Decrypts a GPG-encrypted file
 *
 * @param sourceFilePath Path to the encrypted file
 * @param destFilePath Path where the decrypted content will be extracted
 * @param password Password for decryption
 * @param isArchive Whether the decrypted content is a tar archive that should be extracted
 */
async function decrypt(
  sourceFilePath: string,
  destFilePath: string,
  password: string,
  isArchive: false,
): Promise<boolean> {
  try {
    const tempDir = await Deno.makeTempDir()
    let outputPath = destFilePath

    if (isArchive) {
      outputPath = path.join(tempDir, 'decrypted.tar.gz')
    }

    const gpgProcess = new Deno.Command('gpg', {
      args: [
        '--batch',
        '--yes',
        '--passphrase',
        password,
        '-d',
        '--output',
        outputPath,
        sourceFilePath,
      ],
    })

    const gpgStatus = await gpgProcess.output()
    if (!gpgStatus.success) {
      return false
    }

    if (isArchive) {
      const extractPath = path.dirname(destFilePath)
      await fs.ensureDir(extractPath)
      const tarProcess = new Deno.Command('tar', {
        args: ['xzf', outputPath, '-C', extractPath],
      })

      const tarStatus = await tarProcess.output()

      await Deno.remove(tempDir, { recursive: true })

      return tarStatus.success
    }

    return true
  } catch (error) {
    console.error('Decryption error:', error)
    return false
  }
}

/**
 * Verifies a password by attempting to decrypt a file without saving the output
 */
async function verifyPassword(
  filepath: string,
  password: string,
): Promise<boolean> {
  try {
    const gpgProcess = new Deno.Command('gpg', {
      args: [
        '--batch',
        '--yes',
        '--passphrase',
        password,
        '-d',
        '--output',
        '/dev/null',
        filepath,
      ],
    })

    const status = await gpgProcess.output()
    return status.success
  } catch (error) {
    console.error('Password verification error:', error)
    return false
  }
}

export { decrypt, encrypt, generateHash, verifyPassword }
