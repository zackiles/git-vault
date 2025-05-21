/**
 * Test suite for the remove command
 *
 * These tests are primarily integration tests that interact with the real file system
 * and external commands like git, gpg, etc.
 *
 * To run these tests, you need to have the following installed:
 * - Git
 * - GPG
 *
 * Optional for specific tests:
 * - 1Password CLI (for 1Password integration tests)
 * - Git LFS (for LFS integration tests)
 *
 * Running the tests:
 * - Most tests are disabled by default to avoid unintentional side effects
 * - Enable integration tests: RUN_INTEGRATION_TESTS=true deno task test test/remove.test.ts
 * - Enable 1Password tests: HAS_1PASSWORD_CLI=true RUN_INTEGRATION_TESTS=true deno task test
 * - Enable Git LFS tests: HAS_GIT_LFS=true RUN_INTEGRATION_TESTS=true deno task test
 */

import { assert, assertEquals } from 'jsr:@std/assert'
import { join } from '@std/path'
import { exists } from '@std/fs'
import add from '../src/commands/add.ts'
import init from '../src/commands/init.ts'
import remove from '../src/commands/remove.ts'

// Reuse utility functions from add.test.ts
async function createTempGitRepo(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const tempDir = await Deno.makeTempDir({ prefix: 'git-vault-test-' })

  // Initialize git repository
  const gitInit = new Deno.Command('git', {
    args: ['init'],
    cwd: tempDir,
  })
  await gitInit.output()

  // Create a dummy file and commit it
  await Deno.writeTextFile(`${tempDir}/README.md`, '# Test Repository')

  // Set git user and email for the test repository
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

  // Initial commit
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
  // Create a test file
  const filePath = join(repoPath, 'secret.txt')
  await Deno.writeTextFile(filePath, 'This is a secret file')

  // Create a test directory with a nested file
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

  // Check config doesn't contain the path
  if (await exists(configPath)) {
    const configContent = await Deno.readTextFile(configPath)
    const config = JSON.parse(configContent)
    const pathFound = config?.managedPaths?.some((entry: { path: string }) =>
      entry.path === relativePath
    )
    assert(!pathFound, `config.json should not contain ${relativePath}`)
  }

  // Check that the archive was removed
  const archiveName = relativePath.replaceAll('/', '-')
  const archivePath = join(gitVaultDir, 'storage', `${archiveName}.tar.gz.gpg`)
  assert(!await exists(archivePath), `Archive ${archivePath} should not exist`)

  // Original file should still exist
  const originalPath = join(repoPath, relativePath)
  assert(await exists(originalPath), `Original file ${originalPath} should still exist`)
}

// Set up test environment before running remove tests
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

  // Install git-vault in the repo
  await init.run({ _: [], workspace: path })

  // Create test files
  const testFiles = await createTestFiles(path)

  // Add a file to git-vault
  console.log('Setting up test file - enter "testpassword" when prompted')
  await add.run({ _: [testFiles.filePath], workspace: path })

  return { repoPath: path, cleanup, testFiles: testFiles }
}

// Basic file removal test
Deno.test({
  name: 'remove: basic file removal integration test',
  ignore: Deno.env.get('RUN_INTEGRATION_TESTS') !== 'true', // Skip unless explicitly enabled
  async fn() {
    const { repoPath, cleanup, testFiles } = await setupGitVaultRepoWithFile()

    try {
      // Remove the file
      await remove.run({ _: [testFiles.filePath], workspace: repoPath })

      // Assert
      const relativePath = 'secret.txt' // Relative to repo root
      await verifyFileRemoved(repoPath, relativePath)
    } finally {
      await cleanup()
    }
  },
})

// Test removing file that isn't managed
Deno.test({
  name: 'remove: attempt to remove unmanaged file',
  ignore: Deno.env.get('RUN_INTEGRATION_TESTS') !== 'true', // Skip unless explicitly enabled
  async fn() {
    const { repoPath, cleanup, testFiles } = await setupGitVaultRepoWithFile()

    try {
      // Try to remove an unmanaged file - use the nested file since it wasn't added to git-vault
      const unmanaged = testFiles.nestedFilePath

      // Get initial config state
      const configPath = join(repoPath, '.vault', 'config.json')
      let initialConfig = null
      if (await exists(configPath)) {
        const initialConfigContent = await Deno.readTextFile(configPath)
        initialConfig = JSON.parse(initialConfigContent)
      }

      // Try to remove unmanaged file
      await remove.run({ _: [unmanaged], workspace: repoPath })

      // Verify config didn't change
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

      // Verify file still exists
      assert(await exists(unmanaged), 'Unmanaged file should still exist')
    } finally {
      await cleanup()
    }
  },
})

// Test removing file that doesn't exist
Deno.test({
  name: 'remove: attempt to remove non-existent file',
  ignore: Deno.env.get('RUN_INTEGRATION_TESTS') !== 'true', // Skip unless explicitly enabled
  async fn() {
    const { repoPath, cleanup } = await setupGitVaultRepoWithFile()

    try {
      // Try to remove a non-existent file
      const nonExistentPath = join(repoPath, 'doesnt-exist.txt')

      // Get initial config state
      const configPath = join(repoPath, '.vault', 'config.json')
      let initialConfig = null
      if (await exists(configPath)) {
        const initialConfigContent = await Deno.readTextFile(configPath)
        initialConfig = JSON.parse(initialConfigContent)
      }

      // Try to remove non-existent file
      await remove.run({ _: [nonExistentPath], workspace: repoPath })

      // Verify config didn't change
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
      await cleanup()
    }
  },
})

// Test removing a directory
Deno.test({
  name: 'remove: directory removal integration test',
  ignore: Deno.env.get('RUN_INTEGRATION_TESTS') !== 'true', // Skip unless explicitly enabled
  async fn() {
    const { repoPath, cleanup, testFiles } = await setupGitVaultRepoWithFile()

    try {
      // First add the directory
      console.log('Adding directory - enter "testpassword" when prompted')
      await add.run({ _: [testFiles.directoryPath], workspace: repoPath })

      // Then remove it
      await remove.run({ _: [testFiles.directoryPath], workspace: repoPath })

      // Assert
      const relativePath = 'secret-dir/' // Relative to repo root
      await verifyFileRemoved(repoPath, relativePath)
    } finally {
      await cleanup()
    }
  },
})
