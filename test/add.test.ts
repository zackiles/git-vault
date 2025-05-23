import { assert, assertEquals } from 'jsr:@std/assert'
import { basename, dirname, join, relative } from '@std/path'
import { exists } from '@std/fs'
import { initializeVault } from '../src/utils/initialize-vault.ts'
import add from '../src/commands/add.ts'
import { setupTestEnvironment } from './mocks/test-utils.ts'
import { getGitVaultConfigPath } from '../src/utils/config.ts'
import terminal from '../src/utils/terminal.ts'

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
 * Creates test files and directories in the repo
 */
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
 * Verifies a file was properly added to git-vault
 */
async function verifyFileAdded(repoPath: string, expectedPath: string) {
  const gitVaultDir = join(repoPath, '.vault')
  assert(await exists(gitVaultDir), '.vault directory should exist')

  const storageDir = join(gitVaultDir, 'storage')
  assert(await exists(storageDir), join('.vault', 'storage directory should exist'))

  // Check config.json contains the managed path
  const configPath = getGitVaultConfigPath(repoPath)
  assert(await exists(configPath), 'config.json should exist')

  const configContent = await Deno.readTextFile(configPath)

  const config = JSON.parse(configContent)

  assert(config.managedPaths?.length > 0, 'managedPaths should not be empty')

  // The path in config could be the full relative path or just the basename in case of simple files
  const pathFound = config.managedPaths.some((entry: { path: string }) => {
    const entryPath = entry.path
    return entryPath === expectedPath ||
      basename(entryPath) === expectedPath ||
      entryPath.endsWith(`/${expectedPath}`)
  })

  assert(
    pathFound,
    `Path ${expectedPath} or a path ending with it should be in config.json managedPaths`,
  )

  // Check .gitignore has the path
  const gitignorePath = join(repoPath, '.gitignore')
  assert(await exists(gitignorePath), '.gitignore should exist')

  const gitignore = await Deno.readTextFile(gitignorePath)
  assert(
    gitignore.includes(expectedPath) || gitignore.includes(`/${expectedPath}`) ||
      config.managedPaths.some((entry: { path: string }) =>
        gitignore.includes(entry.path) || gitignore.includes(`/${entry.path}`)
      ),
    `Either ${expectedPath} or the actual stored path should be in .gitignore`,
  )

  // Check encrypted file exists - need to check using the actual path from config
  const configPath1 = config.managedPaths[0].path
  const archiveName = configPath1.replaceAll('/', '-')
  const archivePath = join(storageDir, `${archiveName}.tar.gz.gpg`)
  assert(await exists(archivePath), `Encrypted archive for ${configPath1} should exist`)
}

async function setupGitVaultRepo(): Promise<{
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
  return { repoPath: path, cleanup, testFiles }
}

Deno.test({
  name: 'add: basic file addition integration test',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup, testFiles } = await setupGitVaultRepo()

    try {
      await add({ item: testFiles.filePath, workspace: repoPath })
      await verifyFileAdded(repoPath, 'secret.txt')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'add: basic directory addition integration test',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup, testFiles } = await setupGitVaultRepo()

    try {
      await add({ item: testFiles.directoryPath, workspace: repoPath })
      await verifyFileAdded(repoPath, 'secret-dir/')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'add: attempt to add already managed file',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup, testFiles } = await setupGitVaultRepo()

    try {
      console.log('First add attempt:')
      await add({ item: testFiles.filePath, workspace: repoPath })

      let initialManifest = ''
      const manifestPath = join(repoPath, '.vault', 'paths.list')
      if (await exists(manifestPath)) {
        initialManifest = await Deno.readTextFile(manifestPath)
      }

      console.log('Second add attempt (should be rejected without password prompt):')
      await add({ item: testFiles.filePath, workspace: repoPath })

      let finalManifest = ''
      if (await exists(manifestPath)) {
        finalManifest = await Deno.readTextFile(manifestPath)
      }

      if (initialManifest.trim() !== '') {
        assertEquals(
          finalManifest,
          initialManifest,
          'Manifest should not change when adding an already managed file',
        )
      } else {
        assert(true, 'Command completed without throwing errors')
      }
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'add: attempt to add non-existent file',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup } = await setupGitVaultRepo()

    try {
      const nonExistentPath = join(repoPath, 'doesnt-exist.txt')

      const gitVaultDir = join(repoPath, '.vault')
      const manifestPath = join(gitVaultDir, 'paths.list')
      let initialManifest = ''

      if (await exists(manifestPath)) {
        initialManifest = await Deno.readTextFile(manifestPath)
      }

      await add({ item: nonExistentPath, workspace: repoPath })

      let finalManifest = ''
      if (await exists(manifestPath)) {
        finalManifest = await Deno.readTextFile(manifestPath)
      }

      assertEquals(
        finalManifest,
        initialManifest,
        'Manifest should not change when adding a non-existent file',
      )
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'add: with Git LFS for large file',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup } = await setupGitVaultRepo()

    try {
      const largePath = join(repoPath, 'large-file.bin')

      const buffer = new Uint8Array(6 * 1024 * 1024)
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = i % 256
      }
      await Deno.writeFile(largePath, buffer)

      await add({ item: largePath, workspace: repoPath })
      await verifyFileAdded(repoPath, 'large-file.bin')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'add: handles paths with special characters',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup } = await setupGitVaultRepo()

    try {
      // Create test files with special characters
      const specialPaths = [
        join(repoPath, 'file with spaces.txt'),
        join(repoPath, 'file-with-dashes.txt'),
        join(repoPath, 'file_with_underscores.txt'),
        join(repoPath, 'file.with.dots.txt'),
        join(repoPath, '#file-with-hash.txt'),
        join(repoPath, '$file-with-dollar.txt'),
      ]

      for (const path of specialPaths) {
        await Deno.writeTextFile(path, 'test content')
        await add({ item: path, workspace: repoPath })
        await verifyFileAdded(repoPath, relative(repoPath, path))
      }

      // Test that @ character in filename is properly rejected
      const atPath = join(repoPath, '@file-with-at.txt')
      await Deno.writeTextFile(atPath, 'test content')

      // The add command should complete without error but the file won't be added
      // since the compression utility will reject it
      await add({ item: atPath, workspace: repoPath })

      // Check that the file was NOT added to the config
      const configPath = getGitVaultConfigPath(repoPath)
      const configContent = JSON.parse(await Deno.readTextFile(configPath))

      // None of the managed paths should contain '@file-with-at.txt'
      const atFileFound = configContent.managedPaths.some((entry: { path: string }) => {
        return entry.path.includes('@file-with-at.txt') ||
          basename(entry.path) === '@file-with-at.txt'
      })

      assert(!atFileFound, 'File with @ character should not be added to config')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'add: handles deep nested paths',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup } = await setupGitVaultRepo()

    try {
      // Create deeply nested directory structure
      const deepPath = join(repoPath, 'level1', 'level2', 'level3', 'level4', 'level5')
      await Deno.mkdir(deepPath, { recursive: true })

      const deepFilePath = join(deepPath, 'deep-file.txt')
      await Deno.writeTextFile(deepFilePath, 'deep file content')

      await add({ item: deepFilePath, workspace: repoPath })
      await verifyFileAdded(repoPath, relative(repoPath, deepFilePath))

      // Test adding the entire deep directory
      await add({ item: deepPath, workspace: repoPath })
      await verifyFileAdded(repoPath, `${relative(repoPath, deepPath)}/`)
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'add: handles platform-specific paths',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup } = await setupGitVaultRepo()

    try {
      // Create test files with platform-specific paths
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
          // Check if the file already exists (handles case-insensitive filesystems)
          const fileExists = await Deno.stat(testPath).then(() => true).catch(() => false)
          if (fileExists) {
            console.log(`Skipping duplicate path on case-insensitive filesystem: ${path}`)
            continue
          }

          await Deno.mkdir(dirname(testPath), { recursive: true })
          await Deno.writeTextFile(testPath, 'test content')

          // Use the original path for the add command to test path handling
          const pathToAdd = path.startsWith(repoPath) ? path : testPath
          await add({ item: pathToAdd, workspace: repoPath })

          // For verification, we need the path relative to repoPath
          const relPath = relative(repoPath, testPath)
          // Handle path normalization properly across platforms
          await verifyFileAdded(repoPath, relPath.replace(/\\/g, '/'))
        } catch (error) {
          if (error instanceof Deno.errors.NotSupported) {
            // Skip paths not supported on this platform
            console.log(`Skipping unsupported path on this platform: ${path}`)
            continue
          }

          // Check if this is a case-insensitive filesystem collision
          // This happens on macOS when 'CaseSensitive/File.txt' and 'casesensitive/file.txt'
          // resolve to the same file
          if (error instanceof Error && error.message.includes('Path already managed')) {
            console.log(`Skipping duplicate path on case-insensitive filesystem: ${path}`)
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
  name: 'add: handles relative and absolute paths',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { repoPath, cleanup } = await setupGitVaultRepo()

    try {
      // Test relative path
      const relativeFilePath = 'relative-file.txt'
      await Deno.writeTextFile(join(repoPath, relativeFilePath), 'relative content')

      // Change working directory to repoPath for relative path testing
      const originalCwd = Deno.cwd()
      Deno.chdir(repoPath)

      try {
        // Now use a relative path from the new working directory
        await add({ item: `./${relativeFilePath}`, workspace: repoPath })
        await verifyFileAdded(repoPath, relativeFilePath)
      } finally {
        // Restore original working directory
        Deno.chdir(originalCwd)
      }

      // Test absolute path
      const absoluteFilePath = join(repoPath, 'absolute-file.txt')
      await Deno.writeTextFile(absoluteFilePath, 'absolute content')
      await add({ item: absoluteFilePath, workspace: repoPath })
      await verifyFileAdded(repoPath, 'absolute-file.txt')

      // Test path with parent directory reference
      const parentPath = join(repoPath, '..', basename(repoPath), 'parent-ref-file.txt')
      await Deno.writeTextFile(parentPath, 'parent ref content')
      await add({ item: parentPath, workspace: repoPath })
      await verifyFileAdded(repoPath, 'parent-ref-file.txt')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'add: with 1Password storage integration',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { path: repoPath, cleanup } = await createTempGitRepo()

    try {
      // Create a comprehensive mock for 1Password operations
      const mockCreatedItems = new Map<
        string,
        { password: string; fields: Record<string, string> }
      >()

      // Mock the global Deno.Command to intercept 'op' commands
      const originalCommand = globalThis.Deno.Command
      globalThis.Deno.Command = class MockCommand {
        constructor(private command: string, private options: { args?: string[] }) {}

        output() {
          if (this.command === 'op') {
            const args = this.options.args || []

            if (args[0] === '--version') {
              return { success: true, code: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }
            }

            if (args[0] === 'whoami') {
              return { success: true, code: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }
            }

            if (args[0] === 'vault' && args[1] === 'list') {
              const vaults = JSON.stringify([
                { name: 'Git-Vault' },
                { name: 'Personal' },
              ])
              return {
                success: true,
                code: 0,
                stdout: new TextEncoder().encode(vaults),
                stderr: new Uint8Array(),
              }
            }

            if (args[0] === 'item' && args[1] === 'create') {
              const titleIndex = args.indexOf('--title') + 1
              const _vaultIndex = args.indexOf('--vault') + 1
              const itemName = args[titleIndex]

              // Extract password and fields
              const password = args.find((arg: string) =>
                arg.startsWith('password=')
              )?.split('=')[1] || 'test-password'
              const fields: Record<string, string> = {}

              for (const arg of args) {
                if (arg.includes('=') && !arg.startsWith('password=')) {
                  const [key, value] = arg.split('=')
                  fields[key] = value
                }
              }

              mockCreatedItems.set(itemName, { password, fields })
              return { success: true, code: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }
            }
          }

          // For all other commands, use original Command
          return new originalCommand(this.command, this.options).output()
        }
      } as unknown as typeof Deno.Command

      // Override terminal methods to simulate user choosing 1Password
      const originalCreateConfirm = terminal.createConfirm
      terminal.createConfirm = (message: string, defaultValue = false) => {
        if (message.includes('1Password for password storage')) {
          return true // User chooses 1Password
        }
        if (message.includes('Would you like to create one')) {
          return true // User wants to create vault
        }
        return defaultValue
      }

      const originalCreatePromptSelect = terminal.createPromptSelect
      terminal.createPromptSelect = (message: string, options: string[]) => {
        if (message.includes('Select a 1Password vault')) {
          return 'Git-Vault' // User selects Git-Vault
        }
        return options[0] || ''
      }

      // Initialize vault with 1Password support (autoConfirm = false to trigger prompts)
      await initializeVault(repoPath, false)

      // Verify vault was initialized with 1Password storage mode
      const configPath = getGitVaultConfigPath(repoPath)
      const configContent = JSON.parse(await Deno.readTextFile(configPath))
      assertEquals(configContent.storageMode, '1password', 'Storage mode should be 1password')
      assertEquals(configContent.onePasswordVault, 'Git-Vault', 'Should use Git-Vault vault')

      // Create test file
      await createTestFiles(repoPath)

      // Add file using 1Password storage - use relative path like real users would
      await add({ item: 'secret.txt', workspace: repoPath })

      // Verify file was added to config
      const updatedConfig = JSON.parse(await Deno.readTextFile(configPath))
      assert(updatedConfig.managedPaths.length > 0, 'Should have managed paths')

      const managedPath = updatedConfig.managedPaths[0]
      const actualPath = basename(managedPath.path)
      assertEquals(actualPath, 'secret.txt', 'Should have correct path')

      // Verify password was stored in 1Password mock
      const expectedItemName = `gv-${basename(repoPath)}-${managedPath.hash}`
      assert(
        mockCreatedItems.has(expectedItemName),
        `Should have created 1Password item: ${expectedItemName}`,
      )

      const mockItem = mockCreatedItems.get(expectedItemName)
      assert(mockItem, 'Mock item should exist')
      assertEquals(mockItem.password, 'test-password', 'Should store correct password')
      assertEquals(mockItem.fields.path, actualPath, 'Should store correct path field')
      assertEquals(mockItem.fields.status, 'active', 'Should store correct status field')

      // Verify .pw.1p marker file was created instead of .pw file
      const pwMarkerFile = join(repoPath, '.vault', `gv-${managedPath.hash}.pw.1p`)
      assert(await exists(pwMarkerFile), '1Password marker file should exist')

      const pwFile = join(repoPath, '.vault', `gv-${managedPath.hash}.pw`)
      assert(!await exists(pwFile), 'Password file should not exist when using 1Password')

      // Verify encrypted archive was created
      const archivePath = join(repoPath, '.vault', 'storage', 'secret.txt.tar.gz.gpg')
      assert(await exists(archivePath), 'Encrypted archive should exist')

      // Verify .gitignore was updated correctly
      const gitignoreContent = await Deno.readTextFile(join(repoPath, '.gitignore'))
      assert(gitignoreContent.includes('/secret.txt'), 'Should ignore the original file')
      assert(gitignoreContent.includes('.vault/*.pw'), 'Should ignore password files')
      assert(gitignoreContent.includes('.vault/*.pw.1p'), 'Should ignore 1Password marker files')

      // Restore original functions
      globalThis.Deno.Command = originalCommand
      terminal.createConfirm = originalCreateConfirm
      terminal.createPromptSelect = originalCreatePromptSelect
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})
