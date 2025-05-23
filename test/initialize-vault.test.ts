/**
 * Test suite for the initialize-vault utility
 */

import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { exists } from '@std/fs'
import { initializeVault, isVaultInitialized } from '../src/utils/initialize-vault.ts'
import { setupTestEnvironment } from './mocks/test-utils.ts'
import { getGitVaultConfigPath } from '../src/utils/config.ts'

/**
 * Creates a temporary Git repository for testing
 */
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

/**
 * Creates a temporary directory that's not a Git repository
 */
async function createTempNonGitDir(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const tempDir = await Deno.makeTempDir({ prefix: 'gv-test-non-git-' })
  await Deno.writeTextFile(join(tempDir, 'README.md'), '# Not a Git Repository')

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

/**
 * Verifies basic initialization files and configurations
 */
async function verifyBasicInitialization(repoPath: string) {
  assert(await exists(join(repoPath, '.vault')), '.vault directory should exist')
  assert(
    await exists(join(repoPath, '.vault', 'storage')),
    '.vault/storage directory should exist',
  )

  const configPath = getGitVaultConfigPath(repoPath)
  assert(await exists(configPath), '.vault/config.json file should exist')

  const configJson = await Deno.readTextFile(configPath)
  const config = JSON.parse(configJson)

  assert(typeof config.version === 'number', 'Config should have a version number')
  assertEquals(config.storageMode, 'file', 'Storage mode should be "file"')
  assert(typeof config.lfsThresholdMB === 'number', 'Config should have an LFS threshold')
  assert(Array.isArray(config.managedPaths), 'Config should have a managedPaths array')
  assertEquals(config.managedPaths.length, 0, 'managedPaths should be empty initially')
}

/**
 * Verifies Git LFS configurations
 */
async function verifyLfsConfiguration(repoPath: string) {
  const configPath = getGitVaultConfigPath(repoPath)
  assert(await exists(configPath), '.vault/config.json file should exist')

  const configJson = await Deno.readTextFile(configPath)
  const config = JSON.parse(configJson)

  assert(typeof config.lfsThresholdMB === 'number', 'Config should have an LFS threshold')
  assert(config.lfsThresholdMB > 0, 'LFS threshold should be positive')

  const gitattributes = await Deno.readTextFile(join(repoPath, '.gitattributes'))
  assert(
    gitattributes.includes('.vault/storage/*.tar.gz.gpg filter=lfs diff=lfs merge=lfs'),
    'Git LFS attributes should be configured',
  )
}

/**
 * Verifies Git hooks initialization
 */
async function verifyHooksInstallation(hooksPath: string) {
  assert(await exists(hooksPath), 'Hooks directory should exist')

  const requiredHooks = ['pre-commit', 'post-checkout', 'post-merge']
  for (const hook of requiredHooks) {
    const hookPath = join(hooksPath, hook)
    assert(await exists(hookPath), `${hook} hook should exist`)

    const stat = await Deno.stat(hookPath)
    assert(stat.mode !== null && (stat.mode & 0o111) !== 0, `${hook} hook should be executable`)

    const content = await Deno.readTextFile(hookPath)
    assert(content.includes('git-vault'), `${hook} hook should contain git-vault reference`)
  }
}

Deno.test({
  name: 'initialize-vault: basic initialization test',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { path, cleanup } = await createTempGitRepo()

    try {
      const initialized = await initializeVault(path, true)
      assert(initialized, 'Initialization should succeed')
      await verifyBasicInitialization(path)
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'initialize-vault: graceful failure if target is not a Git repository',
  async fn() {
    const { path, cleanup } = await createTempNonGitDir()
    // Explicitly indicate this is not a Git repo by passing null
    const testEnv = setupTestEnvironment({ gitRepoPath: null as any })

    try {
      const initialized = await initializeVault(path, true)
      assert(!initialized, 'Initialization should fail')
      assert(
        !(await exists(join(path, '.vault'))),
        '.vault directory should not exist in a non-Git repository',
      )
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'initialize-vault: Git LFS integration when available',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { path, cleanup } = await createTempGitRepo()

    try {
      const initialized = await initializeVault(path, true)
      assert(initialized, 'Initialization should succeed')
      await verifyLfsConfiguration(path)
      await verifyBasicInitialization(path)
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'initialize-vault: respects custom Git hooks path',
  async fn() {
    const { path, cleanup } = await createTempGitRepo()
    const testEnv = setupTestEnvironment({ gitRepoPath: path })

    try {
      const customHooksPath = join(path, '.githooks')
      await Deno.mkdir(customHooksPath)

      const gitConfig = new Deno.Command('git', {
        args: ['config', 'core.hooksPath', '.githooks'],
        cwd: path,
      })
      await gitConfig.output()

      const initialized = await initializeVault(path, true)
      assert(initialized, 'Initialization should succeed')
      await verifyHooksInstallation(customHooksPath)
      await verifyBasicInitialization(path)
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'initialize-vault: idempotent initialization',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { path, cleanup } = await createTempGitRepo()

    try {
      const firstInit = await initializeVault(path, true)
      assert(firstInit, 'First initialization should succeed')

      const gitVaultDir = join(path, '.vault')
      const firstInstallFiles = await Deno.readDir(gitVaultDir)
      const firstInstallState = new Set()
      for await (const entry of firstInstallFiles) {
        firstInstallState.add(entry.name)
      }

      const secondInit = await initializeVault(path, true)
      assert(secondInit, 'Second initialization should succeed')

      const secondInstallFiles = await Deno.readDir(gitVaultDir)
      const secondInstallState = new Set()
      for await (const entry of secondInstallFiles) {
        secondInstallState.add(entry.name)
      }

      assert(
        [...firstInstallState].every((file) => secondInstallState.has(file)) &&
          [...secondInstallState].every((file) => firstInstallState.has(file)),
        'Initialization should be idempotent',
      )

      await verifyBasicInitialization(path)
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'isVaultInitialized: correctly detects vault status',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { path, cleanup } = await createTempGitRepo()

    try {
      assert(
        !(await isVaultInitialized(path)),
        'Should return false before initialization',
      )

      const initialized = await initializeVault(path, true)
      assert(initialized, 'Initialization should succeed')

      assert(
        await isVaultInitialized(path),
        'Should return true after initialization',
      )
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})
