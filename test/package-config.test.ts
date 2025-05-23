import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { exists } from '@std/fs'
import { initializeVault } from '../src/utils/initialize-vault.ts'
import add from '../src/commands/add.ts'
import remove from '../src/commands/remove.ts'
import { setupTestEnvironment } from './mocks/test-utils.ts'
import { readGitVaultConfig } from '../src/utils/config.ts'
import {
  addTasksToProjectConfig,
  detectProjectConfigFile,
  getTaskDefinitions,
  removeTasksFromProjectConfig,
} from '../src/utils/project-config.ts'
import type { ProjectConfigFile } from '../src/utils/project-config.ts'
import terminal from '../src/utils/terminal.ts'

/**
 * Creates a temporary Git repository for testing
 */
async function createTempGitRepo(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const tempDir = await Deno.makeTempDir({ prefix: 'git-vault-test-package-helpers-' })

  const gitInit = new Deno.Command('git', {
    args: ['init'],
    cwd: tempDir,
    stdout: 'null',
    stderr: 'null',
  })
  await gitInit.output()

  await Deno.writeTextFile(join(tempDir, 'README.md'), '# Test Repository')

  const gitConfig = new Deno.Command('git', {
    args: ['config', 'user.name', 'Test User'],
    cwd: tempDir,
    stdout: 'null',
    stderr: 'null',
  })
  await gitConfig.output()

  const gitConfigEmail = new Deno.Command('git', {
    args: ['config', 'user.email', 'test@example.com'],
    cwd: tempDir,
    stdout: 'null',
    stderr: 'null',
  })
  await gitConfigEmail.output()

  const gitAdd = new Deno.Command('git', {
    args: ['add', 'README.md'],
    cwd: tempDir,
    stdout: 'null',
    stderr: 'null',
  })
  await gitAdd.output()

  const gitCommit = new Deno.Command('git', {
    args: ['commit', '-m', 'Initial commit'],
    cwd: tempDir,
    stdout: 'null',
    stderr: 'null',
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
        }
      }
    },
  }
}

/**
 * Creates a test project with specified config file
 */
async function createProjectWithConfig(
  repoPath: string,
  configType: ProjectConfigFile,
): Promise<void> {
  const configPath = join(repoPath, configType)

  switch (configType) {
    case 'package.json':
      await Deno.writeTextFile(
        configPath,
        JSON.stringify(
          {
            name: 'test-project',
            version: '1.0.0',
            scripts: {
              test: 'echo "test"',
              build: 'echo "build"',
            },
          },
          null,
          2,
        ),
      )
      break

    case 'deno.json':
      await Deno.writeTextFile(
        configPath,
        JSON.stringify(
          {
            tasks: {
              test: 'deno test',
              dev: 'deno run --watch main.ts',
            },
          },
          null,
          2,
        ),
      )
      break

    case 'deno.jsonc':
      await Deno.writeTextFile(
        configPath,
        `{
  // Deno configuration
  "tasks": {
    "test": "deno test",
    "dev": "deno run --watch main.ts"
  }
}`,
      )
      break

    case 'Makefile':
      await Deno.writeTextFile(
        configPath,
        `# Test Makefile
.PHONY: test build

test:
\techo "Running tests"

build:
\techo "Building project"
`,
      )
      break
  }
}

/**
 * Creates test files
 */
async function createTestFile(repoPath: string): Promise<string> {
  const filePath = join(repoPath, 'secret.txt')
  await Deno.writeTextFile(filePath, 'This is a secret file')
  return filePath
}

/**
 * Verifies that project config contains Git-Vault tasks
 */
async function verifyTasksAdded(repoPath: string, configType: ProjectConfigFile): Promise<void> {
  const configPath = join(repoPath, configType)
  assert(await exists(configPath), `${configType} should exist`)

  const content = await Deno.readTextFile(configPath)

  switch (configType) {
    case 'package.json': {
      const config = JSON.parse(content)
      assert(config.scripts?.['vault:add'], 'package.json should have vault:add script')
      assert(config.scripts?.['vault:remove'], 'package.json should have vault:remove script')
      assert(config.scripts?.['vault:list'], 'package.json should have vault:list script')
      assertEquals(config.scripts['vault:add'], 'gv add')
      assertEquals(config.scripts['vault:remove'], 'gv remove')
      assertEquals(config.scripts['vault:list'], 'gv list')
      break
    }

    case 'deno.json':
    case 'deno.jsonc': {
      const config = JSON.parse(content)
      assert(config.tasks?.['vault:add'], 'deno.json should have vault:add task')
      assert(config.tasks?.['vault:remove'], 'deno.json should have vault:remove task')
      assert(config.tasks?.['vault:list'], 'deno.json should have vault:list task')
      assertEquals(config.tasks['vault:add'], 'gv add $@')
      assertEquals(config.tasks['vault:remove'], 'gv remove $@')
      assertEquals(config.tasks['vault:list'], 'gv list')
      break
    }

    case 'Makefile': {
      assert(content.includes('# Git-Vault tasks'), 'Makefile should have Git-Vault section')
      assert(content.includes('vault-add:'), 'Makefile should have vault-add target')
      assert(content.includes('vault-remove:'), 'Makefile should have vault-remove target')
      assert(content.includes('vault-list:'), 'Makefile should have vault-list target')
      break
    }
  }
}

/**
 * Verifies that Git-Vault tasks were removed from project config
 */
async function verifyTasksRemoved(repoPath: string, configType: ProjectConfigFile): Promise<void> {
  const configPath = join(repoPath, configType)
  assert(await exists(configPath), `${configType} should still exist`)

  const content = await Deno.readTextFile(configPath)

  switch (configType) {
    case 'package.json': {
      const config = JSON.parse(content)
      assert(!config.scripts?.['vault:add'], 'package.json should not have vault:add script')
      assert(!config.scripts?.['vault:remove'], 'package.json should not have vault:remove script')
      assert(!config.scripts?.['vault:list'], 'package.json should not have vault:list script')
      break
    }

    case 'deno.json':
    case 'deno.jsonc': {
      const config = JSON.parse(content)
      assert(!config.tasks?.['vault:add'], 'deno.json should not have vault:add task')
      assert(!config.tasks?.['vault:remove'], 'deno.json should not have vault:remove task')
      assert(!config.tasks?.['vault:list'], 'deno.json should not have vault:list task')
      break
    }

    case 'Makefile': {
      assert(!content.includes('# Git-Vault tasks'), 'Makefile should not have Git-Vault section')
      assert(!content.includes('vault-add:'), 'Makefile should not have vault-add target')
      break
    }
  }
}

Deno.test({
  name: 'project-config: detectProjectConfigFile detects package.json',
  async fn() {
    const { path, cleanup } = await createTempGitRepo()

    try {
      await createProjectWithConfig(path, 'package.json')
      const detected = await detectProjectConfigFile(path)
      assertEquals(detected, 'package.json')
    } finally {
      await cleanup()
    }
  },
})

Deno.test({
  name: 'project-config: detectProjectConfigFile detects deno.json',
  async fn() {
    const { path, cleanup } = await createTempGitRepo()

    try {
      await createProjectWithConfig(path, 'deno.json')
      const detected = await detectProjectConfigFile(path)
      assertEquals(detected, 'deno.json')
    } finally {
      await cleanup()
    }
  },
})

Deno.test({
  name: 'project-config: detectProjectConfigFile returns null when no config found',
  async fn() {
    const { path, cleanup } = await createTempGitRepo()

    try {
      const detected = await detectProjectConfigFile(path)
      assertEquals(detected, null)
    } finally {
      await cleanup()
    }
  },
})

Deno.test({
  name: 'project-config: detectProjectConfigFile respects priority order',
  async fn() {
    const { path, cleanup } = await createTempGitRepo()

    try {
      // Create multiple config files - package.json should be detected first
      await createProjectWithConfig(path, 'package.json')
      await createProjectWithConfig(path, 'deno.json')
      await createProjectWithConfig(path, 'Makefile')

      const detected = await detectProjectConfigFile(path)
      assertEquals(detected, 'package.json')
    } finally {
      await cleanup()
    }
  },
})

Deno.test({
  name: 'project-config: addTasksToProjectConfig works with package.json',
  async fn() {
    const { path, cleanup } = await createTempGitRepo()

    try {
      await createProjectWithConfig(path, 'package.json')
      const tasks = getTaskDefinitions('package.json')
      const success = await addTasksToProjectConfig(path, 'package.json', tasks)
      assert(success, 'Should successfully add tasks to package.json')
      await verifyTasksAdded(path, 'package.json')
    } finally {
      await cleanup()
    }
  },
})

Deno.test({
  name: 'project-config: addTasksToProjectConfig works with deno.json',
  async fn() {
    const { path, cleanup } = await createTempGitRepo()

    try {
      await createProjectWithConfig(path, 'deno.json')
      const tasks = getTaskDefinitions('deno.json')
      const success = await addTasksToProjectConfig(path, 'deno.json', tasks)
      assert(success, 'Should successfully add tasks to deno.json')
      await verifyTasksAdded(path, 'deno.json')
    } finally {
      await cleanup()
    }
  },
})

Deno.test({
  name: 'project-config: addTasksToProjectConfig works with Makefile',
  async fn() {
    const { path, cleanup } = await createTempGitRepo()

    try {
      await createProjectWithConfig(path, 'Makefile')
      const tasks = getTaskDefinitions('Makefile')
      const success = await addTasksToProjectConfig(path, 'Makefile', tasks)
      assert(success, 'Should successfully add tasks to Makefile')
      await verifyTasksAdded(path, 'Makefile')
    } finally {
      await cleanup()
    }
  },
})

Deno.test({
  name: 'project-config: removeTasksFromProjectConfig works with package.json',
  async fn() {
    const { path, cleanup } = await createTempGitRepo()

    try {
      await createProjectWithConfig(path, 'package.json')
      const tasks = getTaskDefinitions('package.json')

      // First add tasks
      await addTasksToProjectConfig(path, 'package.json', tasks)
      await verifyTasksAdded(path, 'package.json')

      // Then remove them
      const success = await removeTasksFromProjectConfig(path, 'package.json')
      assert(success, 'Should successfully remove tasks from package.json')
      await verifyTasksRemoved(path, 'package.json')
    } finally {
      await cleanup()
    }
  },
})

Deno.test({
  name: 'project-config: removeTasksFromProjectConfig works with deno.json',
  async fn() {
    const { path, cleanup } = await createTempGitRepo()

    try {
      await createProjectWithConfig(path, 'deno.json')
      const tasks = getTaskDefinitions('deno.json')

      // First add tasks
      await addTasksToProjectConfig(path, 'deno.json', tasks)
      await verifyTasksAdded(path, 'deno.json')

      // Then remove them
      const success = await removeTasksFromProjectConfig(path, 'deno.json')
      assert(success, 'Should successfully remove tasks from deno.json')
      await verifyTasksRemoved(path, 'deno.json')
    } finally {
      await cleanup()
    }
  },
})

Deno.test({
  name: 'project-config: removeTasksFromProjectConfig works with Makefile',
  async fn() {
    const { path, cleanup } = await createTempGitRepo()

    try {
      await createProjectWithConfig(path, 'Makefile')
      const tasks = getTaskDefinitions('Makefile')

      // First add tasks
      await addTasksToProjectConfig(path, 'Makefile', tasks)
      await verifyTasksAdded(path, 'Makefile')

      // Then remove them
      const success = await removeTasksFromProjectConfig(path, 'Makefile')
      assert(success, 'Should successfully remove tasks from Makefile')
      await verifyTasksRemoved(path, 'Makefile')
    } finally {
      await cleanup()
    }
  },
})

Deno.test({
  name: 'integration: add command with package.json project config',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { path, cleanup } = await createTempGitRepo()

    // Mock user responses consistently
    terminal.createConfirm = (message: string) => {
      if (/1password|op\s+cli/i.test(message)) {
        return false // Use file storage
      }
      if (/re-?configure|reconfigure/i.test(message)) {
        return true // Allow re-configuration of existing vault
      }
      if (/git-?vault tasks/i.test(message)) {
        return true // Confirm adding tasks
      }
      return true // Default to true for other prompts
    }

    terminal.createPromptPassword = () => 'test-password-123'

    try {
      await initializeVault(path)
      await createProjectWithConfig(path, 'package.json')
      const testFile = await createTestFile(path)

      await add({ item: testFile, workspace: path })

      // Verify the config was updated with addedTasks
      const config = await readGitVaultConfig(path)
      assert(config, 'Config should exist')
      assert(config.managedPaths.length === 1, 'Should have one managed path')
      assert(config.managedPaths[0].addedTasks, 'Should have addedTasks')
      assertEquals(config.managedPaths[0].addedTasks?.[0].file, 'package.json')

      // Verify tasks were added to package.json
      await verifyTasksAdded(path, 'package.json')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'integration: add command with deno.json project config',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { path, cleanup } = await createTempGitRepo()

    // Mock user responses consistently
    terminal.createConfirm = (message: string) => {
      if (/1password|op\s+cli/i.test(message)) {
        return false // Use file storage
      }
      if (/re-?configure|reconfigure/i.test(message)) {
        return true // Allow re-configuration of existing vault
      }
      if (/git-?vault tasks/i.test(message)) {
        return true // Confirm adding tasks
      }
      return true // Default to true for other prompts
    }

    terminal.createPromptPassword = () => 'test-password-123'

    try {
      await initializeVault(path)
      await createProjectWithConfig(path, 'deno.json')
      const testFile = await createTestFile(path)

      await add({ item: testFile, workspace: path })

      // Verify the config was updated with addedTasks
      const config = await readGitVaultConfig(path)
      assert(config, 'Config should exist')
      assert(config.managedPaths.length === 1, 'Should have one managed path')
      assert(config.managedPaths[0].addedTasks, 'Should have addedTasks')
      assertEquals(config.managedPaths[0].addedTasks?.[0].file, 'deno.json')

      // Verify tasks were added to deno.json
      await verifyTasksAdded(path, 'deno.json')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'integration: add command without project config file',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { path, cleanup } = await createTempGitRepo()

    // Mock user responses consistently
    terminal.createConfirm = (message: string) => {
      if (/1password|op\s+cli/i.test(message)) {
        return false // Use file storage
      }
      if (/re-?configure|reconfigure/i.test(message)) {
        return true // Allow re-configuration of existing vault
      }
      return true // Default to true for other prompts
    }

    terminal.createPromptPassword = () => 'test-password-123'

    try {
      await initializeVault(path)
      const testFile = await createTestFile(path)

      await add({ item: testFile, workspace: path })

      // Verify no addedTasks in config
      const config = await readGitVaultConfig(path)
      assert(config, 'Config should exist')
      assert(config.managedPaths.length === 1, 'Should have one managed path')
      assert(!config.managedPaths[0].addedTasks, 'Should not have addedTasks')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'integration: add command declining to add project config tasks',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { path, cleanup } = await createTempGitRepo()

    // Mock user responses - decline adding tasks
    terminal.createConfirm = (message: string) => {
      if (/1password|op\s+cli/i.test(message)) {
        return false // Use file storage
      }
      if (/re-?configure|reconfigure/i.test(message)) {
        return true // Allow re-configuration of existing vault
      }
      if (/git-?vault tasks/i.test(message)) {
        return false // Decline adding tasks
      }
      return true // Default to true for other prompts
    }

    terminal.createPromptPassword = () => 'test-password-123'

    try {
      await initializeVault(path)
      await createProjectWithConfig(path, 'package.json')
      const testFile = await createTestFile(path)

      await add({ item: testFile, workspace: path })

      // Verify no addedTasks in config
      const config = await readGitVaultConfig(path)
      assert(config, 'Config should exist')
      assert(config.managedPaths.length === 1, 'Should have one managed path')
      assert(!config.managedPaths[0].addedTasks, 'Should not have addedTasks')

      // Verify tasks were not added to package.json
      const packagePath = join(path, 'package.json')
      const content = JSON.parse(await Deno.readTextFile(packagePath))
      assert(!content.scripts?.['vault:add'], 'Should not have vault:add script')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'integration: remove command with project config cleanup',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { path, cleanup } = await createTempGitRepo()

    // Mock user responses consistently
    terminal.createConfirm = (message: string) => {
      if (/1password|op\s+cli/i.test(message)) {
        return false // Use file storage
      }
      if (/re-?configure|reconfigure/i.test(message)) {
        return true // Allow re-configuration of existing vault
      }
      return true // Confirm all actions (add tasks, remove tasks, cleanup)
    }

    terminal.createPromptPassword = () => 'test-password-123'

    try {
      await initializeVault(path)
      await createProjectWithConfig(path, 'package.json')
      const testFile = await createTestFile(path)

      // First add the file with project config
      await add({ item: testFile, workspace: path })
      await verifyTasksAdded(path, 'package.json')

      // Then remove it
      await remove({ item: testFile, workspace: path })

      // Verify tasks were removed from package.json
      await verifyTasksRemoved(path, 'package.json')

      // Verify config no longer has managed paths
      const config = await readGitVaultConfig(path)
      assert(config, 'Config should exist')
      assertEquals(config.managedPaths.length, 0, 'Should have no managed paths')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})

Deno.test({
  name: 'integration: remove command declining project config cleanup',
  async fn() {
    const testEnv = setupTestEnvironment()
    const { path, cleanup } = await createTempGitRepo()

    // Mock user responses - decline project config cleanup
    terminal.createConfirm = (message: string) => {
      if (/1password|op\s+cli/i.test(message)) {
        return false // Use file storage
      }
      if (/re-?configure|reconfigure/i.test(message)) {
        return true // Allow re-configuration of existing vault
      }
      if (/remove.*git-?vault tasks/i.test(message)) {
        return false // Decline removing tasks during remove
      }
      if (/add.*git-?vault tasks/i.test(message)) {
        return true // Confirm adding tasks during add
      }
      if (/\.gitignore/i.test(message)) {
        return false // Decline gitignore cleanup
      }
      return true // Default to true for other prompts
    }

    terminal.createPromptPassword = () => 'test-password-123'

    try {
      await initializeVault(path)
      await createProjectWithConfig(path, 'package.json')
      const testFile = await createTestFile(path)

      console.log('AFTER ADD:')
      // First add the file with project config
      await add({ item: testFile, workspace: path })

      // Check package.json content after add
      const packagePathAfterAdd = join(path, 'package.json')
      const contentAfterAdd = await Deno.readTextFile(packagePathAfterAdd)
      console.log('Package.json after add:', JSON.parse(contentAfterAdd))

      await verifyTasksAdded(path, 'package.json')

      console.log('AFTER REMOVE:')
      // Then remove it but decline cleanup
      await remove({ item: testFile, workspace: path })

      // Check package.json content after remove
      const packagePathAfterRemove = join(path, 'package.json')
      const contentAfterRemove = await Deno.readTextFile(packagePathAfterRemove)
      console.log('Package.json after remove:', JSON.parse(contentAfterRemove))

      // Verify tasks were NOT removed from package.json
      await verifyTasksAdded(path, 'package.json')
    } finally {
      testEnv.restore()
      await cleanup()
    }
  },
})
