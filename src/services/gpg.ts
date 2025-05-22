/**
 * GPG service for git-vault
 *
 * This file provides functions for GPG encryption and decryption
 */

import terminal from '../utils/terminal.ts'
/**
 * Checks if GPG is installed and available
 *
 * @returns Promise that resolves to true if GPG is available
 */
async function isGpgAvailable(): Promise<boolean> {
  try {
    const command = new Deno.Command('gpg', {
      args: ['--version'],
      stdout: 'null',
      stderr: 'null',
    })

    const { success } = await command.output()
    return success
  } catch {
    return false
  }
}

/**
 * Encrypts a file using GPG
 *
 * @param sourceFilePath Path to the file to encrypt
 * @param destFilePath Path where the encrypted file will be stored
 * @param password Password for encryption
 * @returns Promise that resolves to true if successful
 */
async function encryptFile(
  sourceFilePath: string,
  destFilePath: string,
  password: string,
): Promise<boolean> {
  try {
    // Check if gpg is available
    if (!await isGpgAvailable()) {
      terminal.error('GPG is not available')
      return false
    }

    // Encrypt the file
    const command = new Deno.Command('gpg', {
      args: [
        '--batch',
        '--yes',
        '--passphrase',
        password,
        '-c',
        '--output',
        destFilePath,
        sourceFilePath,
      ],
      stdout: 'null',
      stderr: 'piped',
    })

    const { success, stderr } = await command.output()

    if (!success) {
      terminal.error('GPG encryption failed:', new Error(new TextDecoder().decode(stderr)))
      return false
    }

    return true
  } catch (error) {
    terminal.error('Encryption error:', error)
    return false
  }
}

/**
 * Decrypts a file using GPG
 *
 * @param sourceFilePath Path to the encrypted file
 * @param destFilePath Path where the decrypted file will be stored
 * @param password Password for decryption
 * @returns Promise that resolves to true if successful
 */
async function decryptFile(
  sourceFilePath: string,
  destFilePath: string,
  password: string,
): Promise<boolean> {
  try {
    // Check if gpg is available
    if (!await isGpgAvailable()) {
      terminal.error('GPG is not available')
      return false
    }

    // Decrypt the file
    const command = new Deno.Command('gpg', {
      args: [
        '--batch',
        '--yes',
        '--passphrase',
        password,
        '-d',
        '--output',
        destFilePath,
        sourceFilePath,
      ],
      stdout: 'null',
      stderr: 'piped',
    })

    const { success, stderr } = await command.output()

    if (!success) {
      terminal.error('GPG decryption failed:', new TextDecoder().decode(stderr))
      return false
    }

    return true
  } catch (error) {
    terminal.error('Decryption error:', error)
    return false
  }
}

/**
 * Verifies a password by attempting to decrypt a file
 *
 * @param encryptedFilePath Path to the encrypted file
 * @param password Password to verify
 * @returns Promise that resolves to true if password is correct
 */
async function verifyPassword(
  encryptedFilePath: string,
  password: string,
): Promise<boolean> {
  try {
    // Check if gpg is available
    if (!await isGpgAvailable()) {
      terminal.error('GPG is not available')
      return false
    }

    // Try to decrypt the file to /dev/null
    const command = new Deno.Command('gpg', {
      args: [
        '--batch',
        '--yes',
        '--passphrase',
        password,
        '-d',
        '--output',
        '/dev/null',
        encryptedFilePath,
      ],
      stdout: 'null',
      stderr: 'null',
    })

    const { success } = await command.output()
    return success
  } catch {
    return false
  }
}

export { decryptFile, encryptFile, isGpgAvailable, verifyPassword }
