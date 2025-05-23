/**
 * 1Password service for git-vault
 *
 * This file provides functions for interacting with the 1Password CLI
 */

import terminal from '../utils/terminal.ts'

/**
 * Checks if 1Password CLI is installed and available
 *
 * @returns Promise that resolves to true if 1Password CLI is available
 */
async function isOpAvailable(): Promise<boolean> {
  try {
    const command = new Deno.Command('op', {
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
 * Attempts to sign in to 1Password using the CLI
 *
 * @returns Promise that resolves to true if signin was successful
 */
async function signIn(): Promise<boolean> {
  try {
    const command = new Deno.Command('op', {
      args: ['signin'],
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })

    const { success } = await command.output()
    return success
  } catch {
    return false
  }
}

/**
 * Checks if the user is signed in to 1Password and attempts to sign in if not
 *
 * @returns Promise that resolves to true if the user is signed in
 */
async function isSignedIn(): Promise<boolean> {
  try {
    const command = new Deno.Command('op', {
      args: ['whoami'],
      stdout: 'null',
      stderr: 'null',
    })

    const { success } = await command.output()
    if (!success) {
      terminal.status('Not signed in to 1Password. Attempting to sign in...')
      return await signIn()
    }
    return success
  } catch {
    return false
  }
}

/**
 * Gets a list of available vaults
 *
 * @returns Promise that resolves to an array of vault names
 */
async function getVaults(): Promise<string[]> {
  try {
    const command = new Deno.Command('op', {
      args: ['vault', 'list', '--format=json'],
      stdout: 'piped',
      stderr: 'null',
    })

    const { success, stdout } = await command.output()

    if (!success) {
      return []
    }

    const output = new TextDecoder().decode(stdout)
    const vaults = JSON.parse(output)

    return vaults.map((vault: { name: string }) => vault.name)
  } catch {
    return []
  }
}

/**
 * Creates a password item in 1Password
 *
 * @param itemName Name of the item to create
 * @param vaultName Name of the vault to store the item in
 * @param password Password to store
 * @param fields Additional fields to store
 * @returns Promise that resolves to true if successful
 */
async function createPasswordItem(
  itemName: string,
  vaultName: string,
  password: string,
  fields: Record<string, string> = {},
): Promise<boolean> {
  try {
    // Prepare arguments for op item create
    const args = [
      'item',
      'create',
      '--category',
      'Secure Note',
      '--title',
      itemName,
      '--vault',
      vaultName,
    ]

    // Add password field
    args.push(`password=${password}`)

    // Add additional fields
    for (const [key, value] of Object.entries(fields)) {
      args.push(`${key}=${value}`)
    }

    const command = new Deno.Command('op', {
      args,
      stdout: 'null',
      stderr: 'piped',
    })

    const { success, stderr } = await command.output()

    if (!success) {
      terminal.error('Failed to create 1Password item:', new TextDecoder().decode(stderr))
      return false
    }

    return true
  } catch (error) {
    terminal.error('Error creating 1Password item:', error)
    return false
  }
}

/**
 * Gets a password from 1Password
 *
 * @param itemName Name of the item to get
 * @param vaultName Name of the vault where the item is stored
 * @returns Promise that resolves to the password if successful, or null if not
 */
async function getPassword(itemName: string, vaultName: string): Promise<string | null> {
  try {
    const command = new Deno.Command('op', {
      args: ['item', 'get', itemName, '--vault', vaultName, '--fields', 'password'],
      stdout: 'piped',
      stderr: 'piped',
    })

    const { success, stdout, stderr } = await command.output()

    if (!success) {
      terminal.error('Failed to get 1Password item:', new TextDecoder().decode(stderr))
      return null
    }

    const password = new TextDecoder().decode(stdout).trim()
    return password || null
  } catch (error) {
    terminal.error('Error getting 1Password item:', error)
    return null
  }
}

/**
 * Updates an existing item in 1Password
 *
 * @param itemName Name of the item to update
 * @param vaultName Name of the vault where the item is stored
 * @param fields Fields to update
 * @returns Promise that resolves to true if successful
 */
async function updateItem(
  itemName: string,
  vaultName: string,
  fields: Record<string, string>,
): Promise<boolean> {
  try {
    // Prepare arguments for op item edit
    const args = ['item', 'edit', itemName, '--vault', vaultName]

    // Add fields to update
    for (const [key, value] of Object.entries(fields)) {
      args.push(`${key}=${value}`)
    }

    const command = new Deno.Command('op', {
      args,
      stdout: 'null',
      stderr: 'piped',
    })

    const { success, stderr } = await command.output()

    if (!success) {
      terminal.error('Failed to update 1Password item:', new TextDecoder().decode(stderr))
      return false
    }

    return true
  } catch (error) {
    terminal.error('Error updating 1Password item:', error)
    return false
  }
}

/**
 * Marks an item as removed in 1Password
 *
 * @param itemName Name of the item to mark as removed
 * @param vaultName Name of the vault where the item is stored
 * @returns Promise that resolves to true if successful
 */
async function markItemRemoved(itemName: string, vaultName: string): Promise<boolean> {
  return await updateItem(itemName, vaultName, { status: 'removed' })
}

export {
  createPasswordItem,
  getPassword,
  getVaults,
  isOpAvailable,
  isSignedIn,
  markItemRemoved,
  signIn,
  updateItem,
}
