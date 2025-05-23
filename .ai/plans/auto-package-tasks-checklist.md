# Proposal: Project Helpers Integration (AKA Auto-Package Tasks)

## Objective

Enhance the user experience of `gv add` by automatically detecting common project configuration files (like `package.json`, `deno.json`, `Makefile`) and offering to add `vault:add` and `vault:remove` tasks to them. Correspondingly, `gv remove` should offer to clean up these tasks.

## Approach

Modify the `add` command to scan for known project task files in the repository root after a successful item addition. If found, prompt the user to add Git-Vault tasks. Implement logic within `add` and `remove` commands to read, modify, and write these configuration files, handling syntax variations based on file type.

## Proposed Changes

### 1. Extend `.vault/config.json`

Add a new section to the `.vault/config.json` to track which project config files Git-Vault tasks have been added to for each managed path. This will allow the `remove` command to know where to clean up.

```typescript
// src/types.ts or similar
interface ManagedPath {
  hash: string
  path: string
  // Add a new optional property to track where tasks were added
  addedTasks?: {
    file: string // e.g., 'package.json', 'deno.json'
    // Potentially add more detail here if needed, e.g., syntax type
  }[]
}

interface GitVaultConfig {
  // ... existing properties
  managedPaths: ManagedPath[]
  // ... existing properties
}
```

### 2. Modify `src/commands/add.ts`

Add logic after the item is successfully added and staged, but before the final success message.

*   **Prioritized Scan:** Iterate through the list of project config files from the `TODO.md` table in order of priority (e.g., `package.json`, `Makefile`, `deno.json`). Use `Deno.stat` or `await exists()` to check for the presence of each file in the repository root (`repoRoot`). Stop after the first file is found.
*   **User Prompt:** If a project config file is found, use `terminal.createConfirm` to ask the user if they want to add `vault:add` and `vault:remove` tasks to that file.
*   **Conditional Task Addition:** If the user confirms:
    *   Read the content of the detected project config file.
    *   Implement specific logic (or helper functions) for each supported file type (`package.json`, `deno.json`, etc.) to parse its content and add the necessary tasks.
        *   For `package.json` (NPM/Yarn/PNPM): Add entries like `"vault:add": "gv add"` and `"vault:remove": "gv remove"` to the `scripts` object. Ensure proper JSON formatting. Consider using a simple string replacement or a JSON parsing library if complexity increases.
        *   For `deno.json`/`deno.jsonc`: Add entries like `"vault:add": "gv add $@"`, `"vault:remove": "gv remove $@"`, and potentially `"vault:list": "gv list"` to the `tasks` object. Ensure proper JSONC formatting (allowing comments).
        *   For `Makefile`: Add targets like `vault-add:\n\tgv add $(filter-out $@,$(MAKECMDGOALS))` and `vault-remove:\n\tgv remove $(filter-out $@,$(MAKECMDGOALS))`. Need to research standard Makefile patterns for passing arguments.
        *   Handle syntax differences, e.g., the note about semicolons for JavaScript configs.
    *   Write the modified content back to the file.
    *   Update the `managedPaths` entry for the newly added item in the `config.managedPaths` array to record which file was modified.
    *   Call `await writeGitVaultConfig(repoRoot, config)` to save the updated config.
    *   Call `await stageFile(relative(repoRoot, projectConfigFile))` to stage the modified config file.
    *   Provide informative `terminal.info` messages about which file was updated and how to run the new tasks.

### 3. Modify `src/commands/remove.ts`

Add logic after the item is successfully removed from config and its archive/password files are handled.

*   **Check Config:** Before the final success message, check the `managedPaths` entry for the item being removed (`pathEntry`). If it has an `addedTasks` property, retrieve the list of files where tasks were added.
*   **User Prompt:** For each file listed in `addedTasks`, use `terminal.createConfirm` to ask the user if they want to remove the Git-Vault tasks from that file.
*   **Conditional Task Removal:** If the user confirms:
    *   Read the content of the project config file.
    *   Implement specific logic (or helper functions, possibly reusing parts from `add`) for each file type to remove the previously added Git-Vault tasks.
    *   Write the modified content back to the file.
    *   Update the `managedPaths` entry in memory (before saving) to remove the specific file from the `addedTasks` array.
    *   Call `await stageFile(relative(repoRoot, projectConfigFile))` to stage the modified config file.
    *   Provide informative `terminal.info` messages.
*   **Update Config:** After processing all files in `addedTasks` for the item being removed, ensure the modified `config.managedPaths` (with updated `addedTasks` or the entry completely removed) is saved using `await writeGitVaultConfig(repoRoot, config)`.

### 4. Refactoring and Helper Functions

Create dedicated helper functions (e.g., in `src/utils/projectConfig.ts`) to handle reading, parsing, modifying, and writing different project config file types. This will keep the `add.ts` and `remove.ts` files clean and make it easier to add support for more file types in the future.

```typescript
// Example sketch for a helper
import { exists } from '@std/fs'
import { join } from '@std/path'

interface TaskDefinition {
  add: string
  remove: string
  list?: string // Optional, based on task file capabilities
}

async function addTasksToProjectConfig(
  repoRoot: string,
  configFileName: string,
  tasks: TaskDefinition,
): Promise<boolean> {
  const configPath = join(repoRoot, configFileName)
  if (!await exists(configPath)) {
    return false // File not found
  }

  // Read file, parse based on configFileName extension/type
  // Modify content to add tasks (using appropriate syntax)
  // Write file

  // Return true on success
  return true
}

async function removeTasksFromProjectConfig(
  repoRoot: string,
  configFileName: string,
): Promise<boolean> {
  const configPath = join(repoRoot, configFileName)
  if (!await exists(configPath)) {
    return false // File not found
  }

  // Read file, parse
  // Modify content to remove tasks
  // Write file

  // Return true on success
  return true
}
```

### 5. Testing

Add new test cases in `test/` that cover:

*   Adding an item when `package.json` is present and confirming task addition.
*   Adding an item when `deno.json` is present and confirming task addition.
*   Adding an item when multiple config files are present (only the highest priority is prompted).
*   Adding an item when no config files are present (no prompt occurs).
*   Removing an item when tasks were added to `package.json` and confirming task removal.
*   Removing an item when tasks were added to `deno.json` and confirming task removal.
*   Removing an item when tasks were not added (no removal prompt occurs).
*   Ensure the `.vault/config.json` is correctly updated in both add and remove scenarios.
*   Verify the correct syntax (e.g., semicolons in `package.json`, `$@` in `deno.json`) is used when adding tasks.

### 6. Documentation

Update the `README.md` (specifically the Usage section) and any relevant parts of the `docs/` directory to explain the Project Helpers feature, which config files are supported, how the user will be prompted, and how to use the added tasks (e.g., `npm run vault:add <path>`, `deno task vault:add <path>`).

### Checklist

*   [ ] Extend `GitVaultConfig` type to track added tasks.
*   [ ] Implement project config file scanning in `src/commands/add.ts`.
*   [ ] Implement user prompt in `src/commands/add.ts`.
*   [ ] Implement logic/helpers to add tasks to `package.json`.
*   [ ] Implement logic/helpers to add tasks to `deno.json`.
*   [ ] (Optional initial scope) Implement logic/helpers for other prioritized task files.
*   [ ] Update `src/commands/add.ts` to save the config and stage the modified project file.
*   [ ] Implement logic to check for added tasks in `src/commands/remove.ts`.
*   [ ] Implement user prompt in `src/commands/remove.ts`.
*   [ ] Implement logic/helpers to remove tasks from project config files.
*   [ ] Update `src/commands/remove.ts` to save the config and stage the modified project file.
*   [ ] Add new test cases covering add and remove scenarios with different config files.
*   [ ] Update documentation (`README.md` and `docs/`).
