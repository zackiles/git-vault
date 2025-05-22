/**
 * Test suite for the remove command
 */

import { assert, assertEquals } from 'jsr:@std/assert'
import { basename, dirname, join, relative } from '@std/path'
import { exists } from '@std/fs'
import add from '../src/commands/add.ts'
import { initializeVault } from '../src/utils/initialize-vault.ts'
import remove from '../src/commands/remove.ts'
import { setupTestEnvironment } from './mocks/test-utils.ts'

async function createTempGitRepo(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const tempDir = await Deno.makeTempDir({ prefix: 'git-vault-test-' })

  const gitInit = new Deno.Command('git', {
    args: ['init'],
    cwd: tempDir,
  })
  await gitInit.output()

  await Deno.writeTextFile(join(tempDir, 'README.md'), '# Test Repository')

  const gitConfig = new Deno.Command('git', {
    args: ['config', 'user.name', 'Test User'],
    cwd: tempDir,
  })
  await gitConfig.output()

  const gitConfigEmail = new Deno.Command('git', {
    args: ['config', 'user.email', 'test@example.com'],
    cwd: tempDir,
  })
  await gitConfigEmail.output()

  const gitAdd = new Deno.Command('git', {
    args: ['add', 'README.md'],
    cwd: tempDir,
  })
  await gitAdd.output()

  const gitCommit = new Deno.Command('git', {
    args: ['commit', '-m', 'Initial commit'],
    cwd: tempDir,
  })
  await gitCommit.output()

  return {
    path: tempDir,
    cleanup: async () => {
      try {
        await Deno.remove(tempDir, { recursive: true })
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Failed to clean up: ${error.message}`)
        } else {
          console.error('Failed to clean up with unknown error')
        }
      }
    },
  }
}

async function createTestFiles(repoPath: string): Promise<{
  filePath: string
  directoryPath: string
  nestedFilePath: string
}> {
  const filePath = join(repoPath, 'secret.txt')
  await Deno.writeTextFile(filePath, 'This is a secret file')

  const directoryPath = join(repoPath, 'secret-dir')
  await Deno.mkdir(directoryPath)

  const nestedFilePath = join(directoryPath, 'nested-secret.txt')
  await Deno.writeTextFile(nestedFilePath, 'This is a nested secret file')

  return { filePath, directoryPath, nestedFilePath }
}

/**
 * Verifies a file was properly removed from git-vault
 */
async function verifyFileRemoved(repoPath: string, relativePath: string) {
  const gitVaultDir = join(repoPath, '.vault')
  const configPath = join(gitVaultDir, 'config.json')

  if (await exists(configPath)) {
    const configContent = await Deno.readTextFile(configPath)
    const config = JSON.parse(configContent)
    const pathFound = config?.managedPaths?.some((entry: { path: string }) =>
      entry.path === relativePath
    )
    assert(!pathFound, `config.json should not contain ${relativePath}`)
  }

  const archiveName = relativePath.replaceAll('/', '-')
  const archivePath = join(gitVaultDir, 'storage', `${archiveName}.tar.gz.gpg`)
  assert(!await exists(archivePath), `Archive ${archivePath} should not exist`)

  const originalPath = join(repoPath, relativePath)
  assert(await exists(originalPath), `Original file ${originalPath} should still exist`)
}

async function setupGitVaultRepoWithFile(): Promise<{
  repoPath: string
  cleanup: () => Promise<void>
  testFiles: {
    filePath: string
    directoryPath: string
    nestedFilePath: string
  }
}> {
  const { path, cleanup } = await createTempGitRepo()

  await initializeVault(path)
  const testFiles = await createTestFiles(path)

  await add({ _: [testFiles.filePath], workspace: path })

  return { repoPath: path, cleanup, testFiles: testFiles }
}

Deno.test({
  name: 'remove: basic file removal integration test',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup, testFiles } = await setupGitVaultRepoWithFile()

    try {
      await remove({ _: [testFiles.filePath], workspace: repoPath })

      const relativePath = 'secret.txt'
      await verifyFileRemoved(repoPath, relativePath)
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'remove: attempt to remove unmanaged file',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup, testFiles } = await setupGitVaultRepoWithFile()

    try {
      const unmanaged = testFiles.nestedFilePath

      const configPath = join(repoPath, '.vault', 'config.json')
      let initialConfig = null
      if (await exists(configPath)) {
        const initialConfigContent = await Deno.readTextFile(configPath)
        initialConfig = JSON.parse(initialConfigContent)
      }

      await remove({ _: [unmanaged], workspace: repoPath })

      let finalConfig = null
      if (await exists(configPath)) {
        const finalConfigContent = await Deno.readTextFile(configPath)
        finalConfig = JSON.parse(finalConfigContent)
      }

      assertEquals(
        JSON.stringify(finalConfig),
        JSON.stringify(initialConfig),
        'Config should not change when removing an unmanaged file',
      )

      assert(await exists(unmanaged), 'Unmanaged file should still exist')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'remove: attempt to remove non-existent file',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup } = await setupGitVaultRepoWithFile()

    try {
      const nonExistentPath = join(repoPath, 'doesnt-exist.txt')

      const configPath = join(repoPath, '.vault', 'config.json')
      let initialConfig = null
      if (await exists(configPath)) {
        const initialConfigContent = await Deno.readTextFile(configPath)
        initialConfig = JSON.parse(initialConfigContent)
      }

      await remove({ _: [nonExistentPath], workspace: repoPath })

      let finalConfig = null
      if (await exists(configPath)) {
        const finalConfigContent = await Deno.readTextFile(configPath)
        finalConfig = JSON.parse(finalConfigContent)
      }

      assertEquals(
        JSON.stringify(finalConfig),
        JSON.stringify(initialConfig),
        'Config should not change when removing a non-existent file',
      )
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'remove: directory removal integration test',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup, testFiles } = await setupGitVaultRepoWithFile()

    try {
      await add({ _: [testFiles.directoryPath], workspace: repoPath })
      await remove({ _: [testFiles.directoryPath], workspace: repoPath })

      const relativePath = 'secret-dir/'
      await verifyFileRemoved(repoPath, relativePath)
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'remove: handles paths with special characters',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup } = await setupGitVaultRepoWithFile()

    try {
      // Create and add files with special characters
      const specialPaths = [
        join(repoPath, 'file with spaces.txt'),
        join(repoPath, 'file-with-dashes.txt'),
        join(repoPath, 'file_with_underscores.txt'),
        join(repoPath, 'file.with.dots.txt'),
        join(repoPath, '@file-with-at.txt'),
        join(repoPath, '#file-with-hash.txt'),
        join(repoPath, '$file-with-dollar.txt'),
      ]

      for (const path of specialPaths) {
        await Deno.writeTextFile(path, 'test content')
        await add({ _: [path], workspace: repoPath })
        await remove({ _: [path], workspace: repoPath })
        await verifyFileRemoved(repoPath, relative(repoPath, path))
      }
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'remove: handles deep nested paths',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup } = await setupGitVaultRepoWithFile()

    try {
      // Create and add deeply nested files and directories
      const deepPath = join(repoPath, 'level1', 'level2', 'level3', 'level4', 'level5')
      await Deno.mkdir(deepPath, { recursive: true })

      const deepFilePath = join(deepPath, 'deep-file.txt')
      await Deno.writeTextFile(deepFilePath, 'deep file content')

      // Add and remove deep file
      await add({ _: [deepFilePath], workspace: repoPath })
      await remove({ _: [deepFilePath], workspace: repoPath })
      await verifyFileRemoved(repoPath, relative(repoPath, deepFilePath))

      // Add and remove deep directory
      await add({ _: [deepPath], workspace: repoPath })
      await remove({ _: [deepPath], workspace: repoPath })
      await verifyFileRemoved(repoPath, `${relative(repoPath, deepPath)}/`)
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'remove: handles platform-specific paths',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup } = await setupGitVaultRepoWithFile()

    try {
      // Test with platform-specific paths
      const platformPaths = [
        // Windows absolute paths (with drive letter)
        Deno.build.os === 'windows'
          ? 'C:\\Windows\\Style\\Path\\file.txt'
          : join(repoPath, 'windows-style', 'file.txt'),

        // Windows UNC paths
        Deno.build.os === 'windows'
          ? '\\\\server\\share\\file.txt'
          : join(repoPath, 'unc-style', 'file.txt'),

        // Unix absolute paths
        join(repoPath, 'unix', 'style', 'path', 'file.txt'),

        // Paths with mixed separators (common in Windows)
        // Use proper join instead of hand-constructed path with mixed separators
        join(repoPath, 'mixed', 'style', 'path', 'file.txt'),

        // Paths with spaces and special chars (problematic on Windows)
        join(repoPath, 'path with spaces', 'file (1).txt'),
        join(repoPath, 'path_with@special#chars', '$file.txt'),

        // Reserved names on Windows
        join(repoPath, 'COM1'),
        join(repoPath, 'PRN.txt'),
        join(repoPath, 'aux', 'file.txt'),

        // Case sensitivity tests (important for Windows vs Unix)
        join(repoPath, 'CaseSensitive', 'File.txt'),
        join(repoPath, 'casesensitive', 'file.txt'),

        // Long paths (Windows MAX_PATH issues)
        join(
          repoPath,
          'very',
          'very',
          'very',
          'very',
          'very',
          'very',
          'deep',
          'path',
          'that',
          'might',
          'exceed',
          'windows',
          'max',
          'path',
          'length',
          'this',
          'is',
          'a',
          'really',
          'long',
          'path',
          'file.txt',
        ),

        // Trailing dots and spaces (problematic on Windows)
        join(repoPath, 'path', 'file.'),
        join(repoPath, 'path', 'file '),
        join(repoPath, 'path.', 'file'),
        join(repoPath, 'path ', 'file'),
      ]

      for (const path of platformPaths) {
        let testPath = path
        if (!path.startsWith(repoPath)) {
          // For Windows-specific absolute paths, we'll create them under repoPath
          testPath = join(repoPath, 'test-paths', basename(path))
        }

        try {
          await Deno.mkdir(dirname(testPath), { recursive: true })
          await Deno.writeTextFile(testPath, 'test content')

          // Use the original path for the commands to test path handling
          const pathToUse = path.startsWith(repoPath) ? path : testPath
          await add({ _: [pathToUse], workspace: repoPath })
          await remove({ _: [pathToUse], workspace: repoPath })

          // For verification, we need the path relative to repoPath
          const relPath = relative(repoPath, testPath)
          // Handle path normalization properly across platforms
          await verifyFileRemoved(repoPath, relPath.replace(/\\/g, '/'))
        } catch (error) {
          if (error instanceof Deno.errors.NotSupported) {
            // Skip paths not supported on this platform
            console.log(`Skipping unsupported path on this platform: ${path}`)
            continue
          }
          throw error
        }
      }
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'remove: handles relative and absolute paths',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup } = await setupGitVaultRepoWithFile()

    try {
      // Test relative path
      const relativeFilePath = './relative-file.txt'
      await Deno.writeTextFile(join(repoPath, relativeFilePath), 'relative content')
      await add({ _: [relativeFilePath], workspace: repoPath })
      await remove({ _: [relativeFilePath], workspace: repoPath })
      await verifyFileRemoved(repoPath, 'relative-file.txt')

      // Test absolute path
      const absoluteFilePath = join(repoPath, 'absolute-file.txt')
      await Deno.writeTextFile(absoluteFilePath, 'absolute content')
      await add({ _: [absoluteFilePath], workspace: repoPath })
      await remove({ _: [absoluteFilePath], workspace: repoPath })
      await verifyFileRemoved(repoPath, 'absolute-file.txt')

      // Test path with parent directory reference
      const parentPath = join(repoPath, '..', basename(repoPath), 'parent-ref-file.txt')
      await Deno.writeTextFile(parentPath, 'parent ref content')
      await add({ _: [parentPath], workspace: repoPath })
      await remove({ _: [parentPath], workspace: repoPath })
      await verifyFileRemoved(repoPath, 'parent-ref-file.txt')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})
