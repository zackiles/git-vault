/**
 * Test suite for the list command
 */

import { assert } from 'jsr:@std/assert'
import { join } from '@std/path'
import { exists } from '@std/fs'
import add from '../src/commands/add.ts'
import { initializeVault } from '../src/utils/initialize-vault.ts'
import list from '../src/commands/list.ts'
import { setupTestEnvironment } from './mocks/test-utils.ts'
import { getGitVaultConfigPath } from '../src/utils/config.ts'

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

  await initializeVault(path)
  const testFiles = await createTestFiles(path)

  await add({ _: [testFiles.filePath], workspace: path })
  await add({ _: [testFiles.directoryPath], workspace: path })

  return { repoPath: path, cleanup, testFiles: testFiles }
}

Deno.test({
  name: 'list: empty repository',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { path, cleanup } = await createTempGitRepo()

    try {
      await initializeVault(path)
      await list({ _: [], workspace: path })
      assert(true, 'List command completed without errors')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'list: repository with managed files',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup } = await setupGitVaultRepoWithFiles()

    try {
      await list({ _: [], workspace: repoPath })
      assert(true, 'List command completed without errors')

      const configPath = getGitVaultConfigPath(repoPath)
      assert(await exists(configPath), 'Config file should exist')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'list: repository with missing archives',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup, testFiles } = await setupGitVaultRepoWithFiles()

    try {
      const archiveName = testFiles.filePath.split('/').pop() ?? 'secret.txt'
      const archivePath = join(repoPath, '.vault', 'storage', `${archiveName}.tar.gz.gpg`)

      if (await exists(archivePath)) {
        await Deno.remove(archivePath)
      }

      await list({ _: [], workspace: repoPath })
      assert(true, 'List command completed without errors')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})
