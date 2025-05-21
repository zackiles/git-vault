/**
 * Git service for git-vault
 *
 * This file provides functions for interacting with the Git repository
 */

import * as path from '@std/path'

/**
 * Checks if a path is inside a Git repository
 *
 * @param dirPath The directory path to check
 * @returns Promise that resolves to true if the path is in a Git repository
 */
export async function isGitRepository(dirPath: string): Promise<boolean> {
  try {
    const command = new Deno.Command('git', {
      args: ['rev-parse', '--is-inside-work-tree'],
      cwd: dirPath,
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
 * Gets the repository root path
 *
 * @param workspace The workspace path to check (defaults to current working directory)
 * @returns Promise that resolves to the repository root path or null if not in a repository
 */
export async function getRepositoryRoot(workspace = Deno.cwd()): Promise<string | null> {
  try {
    const command = new Deno.Command('git', {
      args: ['rev-parse', '--show-toplevel'],
      cwd: workspace,
      stdout: 'piped',
      stderr: 'null',
    })

    const { success, stdout } = await command.output()

    if (!success) {
      return null
    }

    return new TextDecoder().decode(stdout).trim()
  } catch {
    return null
  }
}

/**
 * Gets the project name from the Git repository
 *
 * @param repoRoot The repository root path
 * @returns Promise that resolves to the project name
 */
export async function getProjectName(repoRoot: string): Promise<string> {
  try {
    // Try to get the name from origin remote
    const command = new Deno.Command('git', {
      args: ['remote', 'get-url', 'origin'],
      cwd: repoRoot,
      stdout: 'piped',
      stderr: 'null',
    })

    const { success, stdout } = await command.output()

    if (success) {
      const remoteUrl = new TextDecoder().decode(stdout).trim()

      // Extract project name from remote URL
      // Example formats:
      // - git@github.com:username/project-name.git
      // - https://github.com/username/project-name.git

      const match = remoteUrl.match(/\/([^/]+)(\.git)?$/)
      if (match?.[1]) {
        return match[1]
      }
    }

    // Fallback: use directory name
    return path.basename(repoRoot)
  } catch {
    // If anything fails, use directory name
    return path.basename(repoRoot)
  }
}

/**
 * Stages a file for commit
 *
 * @param filePath Path to the file to stage
 * @param force Whether to force add ignored files
 * @returns Promise that resolves to true if successful
 */
export async function stageFile(filePath: string, force = false): Promise<boolean> {
  try {
    const args = ['add']
    if (force) {
      args.push('--force')
    }
    args.push(filePath)

    const command = new Deno.Command('git', {
      args,
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
 * Checks if a path is tracked by Git
 *
 * @param filePath Path to check
 * @returns Promise that resolves to true if the path is tracked by Git
 */
export async function isTracked(filePath: string): Promise<boolean> {
  try {
    const command = new Deno.Command('git', {
      args: ['ls-files', '--error-unmatch', filePath],
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
 * Gets the list of files that are staged for commit
 *
 * @returns Promise that resolves to an array of staged file paths
 */
export async function getStagedFiles(): Promise<string[]> {
  try {
    const command = new Deno.Command('git', {
      args: ['diff', '--cached', '--name-only'],
      stdout: 'piped',
      stderr: 'null',
    })

    const { success, stdout } = await command.output()

    if (!success) {
      return []
    }

    const output = new TextDecoder().decode(stdout).trim()
    return output ? output.split('\n') : []
  } catch {
    return []
  }
}

/**
 * Installs Git hooks for git-vault
 *
 * @param repoRoot The repository root path
 * @param gitVaultDir The git-vault directory path
 * @returns Promise that resolves to true if successful
 */
export async function installHooks(repoRoot: string, gitVaultDir: string): Promise<boolean> {
  try {
    // Get the hooks path from git config
    const getHooksPathCmd = new Deno.Command('git', {
      args: ['config', 'core.hooksPath'],
      cwd: repoRoot,
      stdout: 'piped',
      stderr: 'null',
    })

    const { success, stdout } = await getHooksPathCmd.output()

    // Use custom hooks path or default to .git/hooks
    const gitDir = path.join(repoRoot, '.git')
    let hooksDir: string

    if (success && stdout.length > 0) {
      const customPath = new TextDecoder().decode(stdout).trim()
      hooksDir = path.isAbsolute(customPath) ? customPath : path.join(repoRoot, customPath)
    } else {
      hooksDir = path.join(gitDir, 'hooks')
    }

    // Make sure hooks directory exists
    const hooksInfo = await Deno.stat(hooksDir).catch(() => null)
    if (!hooksInfo?.isDirectory) {
      await Deno.mkdir(hooksDir, { recursive: true })
    }

    // Define hooks to install
    const hooks = [
      { name: 'pre-commit', script: 'encrypt' },
      { name: 'post-checkout', script: 'decrypt' },
      { name: 'post-merge', script: 'decrypt' },
    ]

    // Install each hook
    for (const hook of hooks) {
      const hookPath = path.join(hooksDir, hook.name)
      const scriptPath = path.relative(hooksDir, path.join(gitVaultDir, `${hook.script}.js`))

      const hookContent = `#!/usr/bin/env sh
# git-vault hook marker
exec "${scriptPath}" "$@"
`

      await Deno.writeTextFile(hookPath, hookContent)

      // Make hook executable
      await Deno.chmod(hookPath, 0o755)
    }

    return true
  } catch (error) {
    console.error(
      `Error installing Git hooks: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
}

/**
 * Updates the .gitignore file with patterns
 *
 * @param repoRoot The repository root path
 * @param patterns Array of patterns to add
 * @returns Promise that resolves to true if successful
 */
export async function updateGitignore(repoRoot: string, patterns: string[]): Promise<boolean> {
  try {
    const gitignorePath = path.join(repoRoot, '.gitignore')

    // Read existing content or create empty file
    let content = ''
    try {
      content = await Deno.readTextFile(gitignorePath)
    } catch {
      // File doesn't exist, will be created
    }

    const lines = content.split('\n')
    let modified = false

    // Add patterns that don't already exist
    for (const pattern of patterns) {
      if (!lines.includes(pattern)) {
        lines.push(pattern)
        modified = true
      }
    }

    // Only write file if changes were made
    if (modified) {
      await Deno.writeTextFile(gitignorePath, `${lines.join('\n')}\n`)
    }

    return true
  } catch (error) {
    console.error(
      `Error updating .gitignore: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
}

/**
 * Checks if Git LFS is installed and available
 *
 * @returns Promise that resolves to true if Git LFS is available
 */
export async function isLfsAvailable(): Promise<boolean> {
  try {
    const command = new Deno.Command('git', {
      args: ['lfs', 'version'],
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
 * Initializes Git LFS in the repository
 *
 * @param repoRoot The repository root path
 * @returns Promise that resolves to true if successful
 */
export async function initLfs(repoRoot: string): Promise<boolean> {
  if (!await isLfsAvailable()) {
    return false
  }

  try {
    const command = new Deno.Command('git', {
      args: ['lfs', 'install', '--local'],
      cwd: repoRoot,
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
 * Configures Git LFS for git-vault
 *
 * @param repoRoot The repository root path
 * @param pattern The pattern to track with LFS
 * @returns Promise that resolves to true if successful
 */
export async function configureLfs(repoRoot: string, pattern: string): Promise<boolean> {
  if (!await isLfsAvailable()) {
    return false
  }

  try {
    // Create or update .gitattributes file
    const gitattributesPath = path.join(repoRoot, '.gitattributes')
    const lfsPattern = `${pattern} filter=lfs diff=lfs merge=lfs -text`

    // Read existing content or create empty file
    let content = ''
    try {
      content = await Deno.readTextFile(gitattributesPath)
    } catch {
      // File doesn't exist, will be created
    }

    const lines = content.split('\n')

    // Add LFS pattern if it doesn't already exist
    if (!lines.includes(lfsPattern)) {
      if (!lines.some((line) => line.trim() === '# Git-Vault LFS tracking')) {
        lines.push('# Git-Vault LFS tracking for large encrypted archives')
      }
      lines.push(lfsPattern)

      await Deno.writeTextFile(gitattributesPath, `${lines.join('\n')}\n`)
    }

    // Track pattern with Git LFS
    const command = new Deno.Command('git', {
      args: ['lfs', 'track', pattern],
      cwd: repoRoot,
      stdout: 'null',
      stderr: 'null',
    })

    await command.output()

    return true
  } catch {
    return false
  }
}
