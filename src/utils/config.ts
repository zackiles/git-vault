import { join } from '@std/path'
import { exists } from '@std/fs'
import type { GitVaultConfig } from '../types.ts'
import { DEFAULT_CONFIG_VERSION, DEFAULT_LFS_THRESHOLD_MB } from '../constants.ts'

/**
 * Returns the path to the gv config file
 */
function getGitVaultConfigPath(repoRoot: string): string {
  return join(repoRoot, '.vault', 'config.json')
}

/**
 * Reads and parses the gv config file
 * Returns null if not found or invalid
 */
async function readGitVaultConfig(repoRoot: string): Promise<GitVaultConfig | null> {
  const configPath = getGitVaultConfigPath(repoRoot)

  if (!await exists(configPath)) {
    return null
  }

  try {
    const configContent = await Deno.readTextFile(configPath)
    return JSON.parse(configContent) as GitVaultConfig
  } catch (error) {
    throw new Error(
      `Failed to read config file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Writes the gv config to the config file
 */
async function writeGitVaultConfig(repoRoot: string, config: GitVaultConfig): Promise<void> {
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
function createDefaultConfig(): GitVaultConfig {
  return {
    version: DEFAULT_CONFIG_VERSION,
    storageMode: 'file',
    lfsThresholdMB: DEFAULT_LFS_THRESHOLD_MB,
    managedPaths: [],
  }
}

export { createDefaultConfig, getGitVaultConfigPath, readGitVaultConfig, writeGitVaultConfig }
