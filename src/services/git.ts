/**
 * Git service for gv
 *
 * This file provides functions for interacting with the Git repository
 */

import * as path from '@std/path'
import terminal from '../utils/terminal.ts'

/**
 * Checks if a path is inside a Git repository
 *
 * @param dirPath The directory path to check
 * @returns Promise that resolves to true if the path is in a Git repository
 */
async function isGitRepository(dirPath: string): Promise<boolean> {
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
async function getRepositoryRoot(workspace = Deno.cwd()): Promise<string | null> {
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
async function getProjectName(repoRoot: string): Promise<string> {
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
 * Stages a file or directory in Git
 *
 * @param target The target to stage
 * @param cwd The working directory (defaults to current working directory)
 * @returns Promise that resolves to true if successful
 */
async function stageFile(
  target: string,
  cwd: string = Deno.cwd(),
): Promise<boolean> {
  try {
    const command = new Deno.Command('git', {
      args: ['add', target],
      cwd,
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
async function isTracked(filePath: string): Promise<boolean> {
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
 * Updates the .gitignore file with patterns
 *
 * @param repoRoot The repository root path
 * @param patterns Array of patterns to add or remove
 * @param options Configuration options for the update
 * @returns Promise that resolves to true if successful
 */
async function updateGitignore(
  repoRoot: string,
  patterns: string[],
  options: {
    mode?: 'add' | 'remove' | 'set'
    removeCommentsMatching?: string[]
  } = { mode: 'add' },
): Promise<boolean> {
  try {
    const { mode = 'add', removeCommentsMatching = [] } = options
    const gitignorePath = path.join(repoRoot, '.gitignore')

    // Read existing content or create empty file
    let content = ''
    try {
      content = await Deno.readTextFile(gitignorePath)
    } catch {
      // File doesn't exist, will be created
      if (mode === 'remove') {
        // Nothing to remove from an empty file
        return true
      }
    }

    let lines = content.split('\n').map((line) => line.trim()).filter(Boolean)
    let modified = false

    if (mode === 'add') {
      // Add patterns that don't already exist
      for (const pattern of patterns) {
        if (!lines.includes(pattern)) {
          lines.push(pattern)
          modified = true
        }
      }
    } else if (mode === 'remove') {
      // Remove patterns that exist
      const initialLength = lines.length
      lines = lines.filter((line) => !patterns.includes(line))

      // Also remove any matching comment lines if specified
      if (removeCommentsMatching.length > 0) {
        lines = lines.filter((line) => {
          if (line.startsWith('#')) {
            return !removeCommentsMatching.some((comment) => line.includes(comment))
          }
          return true
        })
      }

      modified = lines.length !== initialLength
    } else if (mode === 'set') {
      // Replace the entire file with the provided patterns
      modified = true
      lines = [...patterns]
    }

    // Only write file if changes were made
    if (modified) {
      await Deno.writeTextFile(gitignorePath, `${lines.join('\n')}\n`)
    }

    return true
  } catch (error) {
    terminal.error('Error updating .gitignore', error)
    return false
  }
}

/**
 * Checks if Git LFS is installed and available
 *
 * @returns Promise that resolves to true if Git LFS is available
 */
async function isLfsAvailable(): Promise<boolean> {
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
async function initLfs(repoRoot: string): Promise<boolean> {
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
async function configureLfs(repoRoot: string, pattern: string): Promise<boolean> {
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
      if (!lines.some((line) => line.trim() === '# GV LFS tracking')) {
        lines.push('# GV LFS tracking for large encrypted archives')
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

export {
  configureLfs,
  getProjectName,
  getRepositoryRoot,
  initLfs,
  isGitRepository,
  isLfsAvailable,
  isTracked,
  stageFile,
  updateGitignore,
}
