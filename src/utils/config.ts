import { join } from '@std/path'
import { exists } from '@std/fs'
import type { GitVaultConfig } from '../types.ts'
import { DEFAULT_CONFIG_VERSION, DEFAULT_LFS_THRESHOLD_MB } from '../types.ts'

/**
 * Returns the path to the git-vault config file
 */
export function getGitVaultConfigPath(repoRoot: string): string {
  return join(repoRoot, '.vault', 'config.json')
}

/**
 * Reads and parses the git-vault config file
 * Returns null if not found or invalid
 */
export async function readGitVaultConfig(repoRoot: string): Promise<GitVaultConfig | null> {
  const configPath = getGitVaultConfigPath(repoRoot)

  if (!await exists(configPath)) {
    return null
  }

  try {
    const configContent = await Deno.readTextFile(configPath)
    return JSON.parse(configContent) as GitVaultConfig
  } catch (error) {
    console.error(
      `Failed to read config file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
    return null
  }
}

/**
 * Writes the git-vault config to the config file
 */
export async function writeGitVaultConfig(repoRoot: string, config: GitVaultConfig): Promise<void> {
  const configPath = getGitVaultConfigPath(repoRoot)

  try {
    await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2))
  } catch (error) {
    throw new Error(
      `Failed to write config file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Creates a new config with default values
 */
export function createDefaultConfig(): GitVaultConfig {
  return {
    version: DEFAULT_CONFIG_VERSION,
    storageMode: 'file',
    lfsThresholdMB: DEFAULT_LFS_THRESHOLD_MB,
    managedPaths: [],
  }
}
