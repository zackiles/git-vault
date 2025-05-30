import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { exists } from '@std/fs'
import { initializeVault } from '../src/utils/initialize-vault.ts'
import add from '../src/commands/add.ts'
import encrypt from '../src/commands/encrypt.ts'
import decrypt from '../src/commands/decrypt.ts'
import { setupTestEnvironment } from './mocks/test-utils.ts'
import { readGitVaultConfig } from '../src/utils/config.ts'

/**
 * Creates a temporary Git repository for testing
 */
async function createTempGitRepo(): Promise<
  { path: string; cleanup: () => Promise<void> }
> {
  const tempDir = await Deno.makeTempDir({ prefix: 'git-vault-crypto-test-' })

  // Don't mock git commands for this test since we need real git functionality
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

Deno.test({
  name: 'encrypt/decrypt: basic file encryption and decryption',
  async fn() {
    // Only mock terminal interactions, not commands since we need real gpg/tar
    const testEnv = setupTestEnvironment({
      mockCommands: false,
      mockTerminal: true,
    })
    const { path: repoPath, cleanup } = await createTempGitRepo()

    try {
      // Initialize vault
      await initializeVault(repoPath, true)

      // Create test files
      const testFile1 = join(repoPath, 'secret1.txt')
      const testFile2 = join(repoPath, 'secret2.txt')
      const testContent1 = 'This is secret content 1'
      const testContent2 = 'This is secret content 2'

      await Deno.writeTextFile(testFile1, testContent1)
      await Deno.writeTextFile(testFile2, testContent2)

      // Add files to vault
      await add({ item: testFile1, workspace: repoPath })
      await add({ item: testFile2, workspace: repoPath })

      // Verify files were added
      const config = await readGitVaultConfig(repoPath)
      assert(config, 'Config should exist')
      assertEquals(config.managedPaths.length, 2, 'Should have 2 managed paths')

      // Verify encrypted archives exist
      const storageDir = join(repoPath, '.vault', 'storage')
      const archive1 = join(storageDir, 'secret1.txt.tar.gz.gpg')
      const archive2 = join(storageDir, 'secret2.txt.tar.gz.gpg')

      assert(await exists(archive1), 'First encrypted archive should exist')
      assert(await exists(archive2), 'Second encrypted archive should exist')

      // Delete original files to simulate them being removed
      await Deno.remove(testFile1)
      await Deno.remove(testFile2)

      assert(!await exists(testFile1), 'First file should be deleted')
      assert(!await exists(testFile2), 'Second file should be deleted')

      // Run decrypt command to restore files
      await decrypt({ workspace: repoPath, quiet: true })

      // Verify files were restored
      assert(await exists(testFile1), 'First file should be restored')
      assert(await exists(testFile2), 'Second file should be restored')

      // Verify content is correct
      const restoredContent1 = await Deno.readTextFile(testFile1)
      const restoredContent2 = await Deno.readTextFile(testFile2)

      assertEquals(
        restoredContent1,
        testContent1,
        'First file content should match',
      )
      assertEquals(
        restoredContent2,
        testContent2,
        'Second file content should match',
      )
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'encrypt/decrypt: handles directories',
  async fn() {
    // Only mock terminal interactions, not commands
    const testEnv = setupTestEnvironment({
      mockCommands: false,
      mockTerminal: true,
    })
    const { path: repoPath, cleanup } = await createTempGitRepo()

    try {
      // Initialize vault
      await initializeVault(repoPath, true)

      // Create test directory with files
      const testDir = join(repoPath, 'secret-dir')
      await Deno.mkdir(testDir)

      const file1 = join(testDir, 'file1.txt')
      const file2 = join(testDir, 'file2.txt')
      const subDir = join(testDir, 'subdir')
      await Deno.mkdir(subDir)
      const file3 = join(subDir, 'file3.txt')

      const content1 = 'Content of file 1'
      const content2 = 'Content of file 2'
      const content3 = 'Content of file 3'

      await Deno.writeTextFile(file1, content1)
      await Deno.writeTextFile(file2, content2)
      await Deno.writeTextFile(file3, content3)

      // Add directory to vault
      await add({ item: testDir, workspace: repoPath })

      // Verify directory was added
      const config = await readGitVaultConfig(repoPath)
      assert(config, 'Config should exist')
      assertEquals(config.managedPaths.length, 1, 'Should have 1 managed path')
      assert(
        config.managedPaths[0].path.endsWith('/'),
        'Directory path should end with /',
      )

      // Delete original directory
      await Deno.remove(testDir, { recursive: true })
      assert(!await exists(testDir), 'Directory should be deleted')

      // Run decrypt command to restore directory
      await decrypt({ workspace: repoPath, quiet: true })

      // Verify directory and all files were restored
      assert(await exists(testDir), 'Directory should be restored')
      assert(await exists(file1), 'File 1 should be restored')
      assert(await exists(file2), 'File 2 should be restored')
      assert(await exists(subDir), 'Subdirectory should be restored')
      assert(await exists(file3), 'File 3 should be restored')

      // Verify content is correct
      assertEquals(
        await Deno.readTextFile(file1),
        content1,
        'File 1 content should match',
      )
      assertEquals(
        await Deno.readTextFile(file2),
        content2,
        'File 2 content should match',
      )
      assertEquals(
        await Deno.readTextFile(file3),
        content3,
        'File 3 content should match',
      )
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'encrypt: handles missing source files gracefully',
  async fn() {
    const testEnv = setupTestEnvironment({
      mockCommands: false,
      mockTerminal: true,
    })
    const { path: repoPath, cleanup } = await createTempGitRepo()

    try {
      // Initialize vault
      await initializeVault(repoPath, true)

      // Create and add a test file
      const testFile = join(repoPath, 'test.txt')
      await Deno.writeTextFile(testFile, 'test content')
      await add({ item: testFile, workspace: repoPath })

      // Delete the file before encryption
      await Deno.remove(testFile)

      // Run encrypt command - should handle missing file gracefully
      await encrypt({ workspace: repoPath, quiet: true })

      // Command should complete without throwing
      assert(true, 'Encrypt command completed without throwing')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'decrypt: handles missing archive files gracefully',
  async fn() {
    const testEnv = setupTestEnvironment({
      mockCommands: false,
      mockTerminal: true,
    })
    const { path: repoPath, cleanup } = await createTempGitRepo()

    try {
      // Initialize vault
      await initializeVault(repoPath, true)

      // Create and add a test file
      const testFile = join(repoPath, 'test.txt')
      await Deno.writeTextFile(testFile, 'test content')
      await add({ item: testFile, workspace: repoPath })

      // Delete the encrypted archive
      const archivePath = join(
        repoPath,
        '.vault',
        'storage',
        'test.txt.tar.gz.gpg',
      )
      await Deno.remove(archivePath)

      // Delete original file
      await Deno.remove(testFile)

      // Run decrypt command - should handle missing archive gracefully
      await decrypt({ workspace: repoPath, quiet: true })

      // File should not be restored
      assert(
        !await exists(testFile),
        'File should not be restored when archive is missing',
      )
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'encrypt/decrypt: cycles without re-adding',
  async fn() {
    const testEnv = setupTestEnvironment({
      mockCommands: false,
      mockTerminal: true,
    })
    const { path: repoPath, cleanup } = await createTempGitRepo()

    try {
      // Initialize vault
      await initializeVault(repoPath, true)

      // Create test file
      const testFile = join(repoPath, 'cycle-test.txt')
      const testContent = 'Content for cycle test'
      await Deno.writeTextFile(testFile, testContent)

      // Add file to vault
      await add({ item: testFile, workspace: repoPath })

      // Cycle 1: encrypt (happens automatically during add)
      // Modify the file
      const modifiedContent = 'Modified content for cycle test'
      await Deno.writeTextFile(testFile, modifiedContent)

      // Re-encrypt with the modified content
      await encrypt({ workspace: repoPath, quiet: true })

      // Delete and decrypt
      await Deno.remove(testFile)
      await decrypt({ workspace: repoPath, quiet: true })

      // Verify the decrypted content is the modified version
      assert(await exists(testFile), 'File should be restored')
      assertEquals(
        await Deno.readTextFile(testFile),
        modifiedContent,
        'Content should be the modified version',
      )

      // Cycle 2: modify again, encrypt, delete, decrypt
      const secondModifiedContent = 'Second modification for cycle test'
      await Deno.writeTextFile(testFile, secondModifiedContent)
      await encrypt({ workspace: repoPath, quiet: true })
      await Deno.remove(testFile)
      await decrypt({ workspace: repoPath, quiet: true })

      // Verify
      assert(
        await exists(testFile),
        'File should be restored after second cycle',
      )
      assertEquals(
        await Deno.readTextFile(testFile),
        secondModifiedContent,
        'Content should be the second modified version',
      )
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'encrypt/decrypt: handles empty vault gracefully',
  async fn() {
    const testEnv = setupTestEnvironment({
      mockCommands: false,
      mockTerminal: true,
    })
    const { path: repoPath, cleanup } = await createTempGitRepo()

    try {
      // Initialize vault but don't add any files
      await initializeVault(repoPath, true)

      // Run encrypt on empty vault - should complete without error
      await encrypt({ workspace: repoPath, quiet: true })

      // Run decrypt on empty vault - should complete without error
      await decrypt({ workspace: repoPath, quiet: true })

      // Commands should complete without throwing
      assert(true, 'Commands completed without throwing')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})
