import { exists } from '@std/fs'
import { join } from '@std/path'
import { applyEdits, modify } from 'jsonc-parser'
import {
  FORMATTING_OPTIONS,
  MAKEFILE_SECTION_MARKER,
  MAKEFILE_TASKS,
  NX_EXECUTOR,
  VAULT_TASKS,
  VSCODE_TASK_DEFAULTS,
} from '../constants.ts'
import { PATHS } from '../paths.ts'

const PROJECT_CONFIG_FILES = [
  'package.json',
  'package.jsonc',
  'deno.json',
  'deno.jsonc',
  'project.json',
  'project.jsonc',
  'tasks.json',
  'tasks.jsonc',
  'Makefile',
] as const

type ProjectConfigFile = typeof PROJECT_CONFIG_FILES[number]
type TaskDefinition = Record<'add' | 'remove', string> & { list?: string }

const VAULT_TASK_LABELS = Object.values(VAULT_TASKS) as string[]

async function detectProjectConfigFile(
  repoRoot: string,
): Promise<ProjectConfigFile | null> {
  for (const file of PROJECT_CONFIG_FILES) {
    if (await exists(join(repoRoot, file))) return file
  }
  return null
}

async function updateJsonScript(
  file: string,
  section: 'tasks' | 'scripts',
  name: string,
  cmd?: string,
): Promise<boolean> {
  try {
    const src = await Deno.readTextFile(file)
    const edits = modify(src, [section, name], cmd, {
      formattingOptions: FORMATTING_OPTIONS,
    })
    await Deno.writeTextFile(file, applyEdits(src, edits))
    return true
  } catch {
    return false
  }
}

function getTaskDefinitions(configFileName: ProjectConfigFile): TaskDefinition {
  const base = {
    add: `${PATHS.BASE_NAME} add`,
    remove: `${PATHS.BASE_NAME} remove`,
    list: `${PATHS.BASE_NAME} list`,
  }
  return configFileName.startsWith('deno.')
    ? { add: `${base.add} $@`, remove: `${base.remove} $@`, list: base.list }
    : base
}

async function addTasksToProjectConfig(
  repoRoot: string,
  configFileName: ProjectConfigFile,
  tasks: TaskDefinition,
): Promise<boolean> {
  const configPath = join(repoRoot, configFileName)
  if (!await exists(configPath)) return false

  try {
    if (configFileName === 'Makefile') {
      const content = await Deno.readTextFile(configPath)
      const entries = [[MAKEFILE_TASKS.ADD, tasks.add], [
        MAKEFILE_TASKS.REMOVE,
        tasks.remove,
      ], ...(tasks.list ? [[MAKEFILE_TASKS.LIST, tasks.list]] : [])]
      const targets = entries.flatMap(([target, command]) => [
        `${target}:`,
        `\t${command}${
          target !== MAKEFILE_TASKS.LIST
            ? ' $(filter-out $@,$(MAKECMDGOALS))'
            : ''
        }`,
        '',
      ])
      const updated = [
        content,
        MAKEFILE_SECTION_MARKER,
        ...targets,
        `.PHONY: ${entries.map(([t]) => t).join(' ')}`,
        '',
        '# Allow additional arguments to be passed to make targets',
        '%:',
        '\t@:',
        '',
      ].join('\n')
      await Deno.writeTextFile(configPath, updated)
      return true
    }

    const config = JSON.parse(await Deno.readTextFile(configPath))
    const fileName = configPath.split('/').at(-1) || ''

    if (fileName.startsWith('project.')) {
      config.targets = config.targets || {}
      config.targets[VAULT_TASKS.ADD] = {
        executor: NX_EXECUTOR,
        options: { command: tasks.add },
      }
      config.targets[VAULT_TASKS.REMOVE] = {
        executor: NX_EXECUTOR,
        options: { command: tasks.remove },
      }
      if (tasks.list) {
        config.targets[VAULT_TASKS.LIST] = {
          executor: NX_EXECUTOR,
          options: { command: tasks.list },
        }
      }
    } else if (fileName.startsWith('tasks.')) {
      config.tasks = config.tasks || []
      config.version = config.version || VSCODE_TASK_DEFAULTS.VERSION
      config.tasks = config.tasks.filter((task: { label: string }) =>
        !VAULT_TASK_LABELS.includes(task.label)
      )
      const createTask = (label: string, command: string) => ({
        label,
        command,
        type: VSCODE_TASK_DEFAULTS.TYPE,
        args: [...VSCODE_TASK_DEFAULTS.ARGS],
        problemMatcher: [...VSCODE_TASK_DEFAULTS.PROBLEM_MATCHER],
      })
      config.tasks.push(createTask(VAULT_TASKS.ADD, tasks.add))
      config.tasks.push(createTask(VAULT_TASKS.REMOVE, tasks.remove))
      if (tasks.list) {
        config.tasks.push(createTask(VAULT_TASKS.LIST, tasks.list))
      }
    } else {
      const section = fileName.includes('deno.') ? 'tasks' : 'scripts'
      const result1 = await updateJsonScript(
        configPath,
        section,
        VAULT_TASKS.ADD,
        tasks.add,
      )
      const result2 = await updateJsonScript(
        configPath,
        section,
        VAULT_TASKS.REMOVE,
        tasks.remove,
      )
      const result3 = await updateJsonScript(
        configPath,
        section,
        VAULT_TASKS.LIST,
        tasks.list,
      )
      return result1 && result2 && result3
    }

    await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2))
    return true
  } catch {
    return false
  }
}

async function removeTasksFromProjectConfig(
  repoRoot: string,
  configFileName: ProjectConfigFile,
): Promise<boolean> {
  const configPath = join(repoRoot, configFileName)
  if (!await exists(configPath)) return false

  try {
    if (configFileName === 'Makefile') {
      const content = await Deno.readTextFile(configPath)
      const lines = content.split('\n')
      let inSection = false
      const filtered = lines.filter((line, i) => {
        if (line.trim() === MAKEFILE_SECTION_MARKER) {
          inSection = true
          return false
        }
        if (
          inSection && ((line.startsWith('#') && !line.includes('Git-Vault')) ||
            (line.trim() === '' && lines[i + 1]?.trim() === ''))
        ) {
          inSection = false
        }
        return !inSection
      })
      await Deno.writeTextFile(
        configPath,
        filtered.join('\n').replace(/\n\n+$/, '\n'),
      )
      return true
    }

    const config = JSON.parse(await Deno.readTextFile(configPath))
    const fileName = configPath.split('/').at(-1) || ''

    if (fileName.startsWith('project.')) {
      for (const task of Object.values(VAULT_TASKS)) {
        delete config.targets?.[task]
      }
    } else if (fileName.startsWith('tasks.')) {
      config.tasks = config.tasks?.filter((task: { label: string }) =>
        !VAULT_TASK_LABELS.includes(task.label)
      ) || []
    } else {
      const section = fileName.includes('deno.') ? 'tasks' : 'scripts'
      const result1 = await updateJsonScript(
        configPath,
        section,
        VAULT_TASKS.ADD,
        undefined,
      )
      const result2 = await updateJsonScript(
        configPath,
        section,
        VAULT_TASKS.REMOVE,
        undefined,
      )
      const result3 = await updateJsonScript(
        configPath,
        section,
        VAULT_TASKS.LIST,
        undefined,
      )
      return result1 && result2 && result3
    }

    await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2))
    return true
  } catch {
    return false
  }
}

export {
  addTasksToProjectConfig,
  detectProjectConfigFile,
  getTaskDefinitions,
  removeTasksFromProjectConfig,
  updateJsonScript,
}
export type { ProjectConfigFile, TaskDefinition }
