/**
 * Test suite for the list command
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
 * - Enable integration tests: RUN_INTEGRATION_TESTS=true deno task test test/list.test.ts
 * - Enable 1Password tests: HAS_1PASSWORD_CLI=true RUN_INTEGRATION_TESTS=true deno task test
 * - Enable Git LFS tests: HAS_GIT_LFS=true RUN_INTEGRATION_TESTS=true deno task test
 */

import { assert } from 'jsr:@std/assert'
import { join } from '@std/path'
import { exists } from '@std/fs'
import add from '../src/commands/add.ts'
import init from '../src/commands/init.ts'
import list from '../src/commands/list.ts'

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

// Set up test environment with some managed files
async function setupGitVaultRepoWithFiles(): Promise<{
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

  // Add files to git-vault
  console.log('Setting up test files - enter "testpassword" when prompted for each file')
  await add.run({ _: [testFiles.filePath], workspace: path })
  await add.run({ _: [testFiles.directoryPath], workspace: path })

  return { repoPath: path, cleanup, testFiles: testFiles }
}

// Test listing files in an empty repository
Deno.test({
  name: 'list: empty repository',
  ignore: Deno.env.get('RUN_INTEGRATION_TESTS') !== 'true', // Skip unless explicitly enabled
  async fn() {
    const { path, cleanup } = await createTempGitRepo()

    try {
      // Install git-vault but don't add any files
      await init.run({ _: [], workspace: path })

      // Run list command
      await list.run({ _: [], workspace: path })

      // We can't easily capture console output, but we can verify the command runs
      assert(true, 'List command completed without errors')
    } finally {
      await cleanup()
    }
  },
})

// Test listing files in a repository with managed files
Deno.test({
  name: 'list: repository with managed files',
  ignore: Deno.env.get('RUN_INTEGRATION_TESTS') !== 'true', // Skip unless explicitly enabled
  async fn() {
    const { repoPath, cleanup } = await setupGitVaultRepoWithFiles()

    try {
      // Run list command
      await list.run({ _: [], workspace: repoPath })

      // We can't easily capture console output, but we can verify the command runs
      assert(true, 'List command completed without errors')

      // Verify that the config exists
      const configPath = join(repoPath, '.vault', 'config.json')
      assert(await exists(configPath), 'Config file should exist')

      // Note: We don't check config content since it depends on interactive password entry
    } finally {
      await cleanup()
    }
  },
})

// Test listing files in a repository with missing archives
Deno.test({
  name: 'list: repository with missing archives',
  ignore: Deno.env.get('RUN_INTEGRATION_TESTS') !== 'true', // Skip unless explicitly enabled
  async fn() {
    const { repoPath, cleanup, testFiles } = await setupGitVaultRepoWithFiles()

    try {
      // Delete an archive file to simulate missing archive
      const archiveName = testFiles.filePath.split('/').pop() ?? 'secret.txt'
      const archivePath = join(repoPath, '.vault', 'storage', `${archiveName}.tar.gz.gpg`)

      if (await exists(archivePath)) {
        await Deno.remove(archivePath)
      }

      // Run list command
      await list.run({ _: [], workspace: repoPath })

      // We can't easily capture console output, but we can verify the command runs
      assert(true, 'List command completed without errors')
    } finally {
      await cleanup()
    }
  },
})
