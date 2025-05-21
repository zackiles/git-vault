import { parseArgs } from '@std/cli/parse-args'
import { join } from '@std/path'
import { bold, dim } from '@std/fmt/colors'
import { toPascalCase } from '@std/text'

//packages/ai/core
const configs: RepomixConfig[] = [
  {
    remote: 'https://github.com/denoland/std',
    include: ['testing/**/*'],
    ignore: ['testing/tests/**', 'testing/mocks/**'],
    output: join(Deno.cwd(), '.ai', 'context', 'std-testing.xml'),
    extraFlags: ['--remove-empty-lines', '--compress', '--quiet', '--parsable-style'],
  },
  {
    remote: 'https://github.com/vercel/ai',
    include: ['packages/ai/core/**/*.ts'],
    output: join(Deno.cwd(), '.ai', 'context', 'ai-sdk-core.xml'),
    extraFlags: ['--remove-empty-lines', '--compress', '--quiet', '--parsable-style'],
  },
  {
    config: join(Deno.cwd(), 'repomix.config.json'),
    extraFlags: ['--quiet'],
  },
]

const booleanFlags = [
  '--version',
  '--stdout',
  '--parsable-style',
  '--compress',
  '--output-show-line-numbers',
  '--copy',
  '--no-file-summary',
  '--no-directory-structure',
  '--remove-comments',
  '--remove-empty-lines',
  '--include-empty-directories',
  '--include-diffs',
  '--no-git-sort-by-changes',
  '--no-gitignore',
  '--no-default-patterns',
  '--init',
  '--global',
  '--no-security-check',
  '--mcp',
  '--verbose',
  '--quiet',
] as const

interface RepomixConfig {
  remote?: string
  include?: string[]
  ignore?: string[]
  output?: string
  config?: string
  extraFlags?: (typeof booleanFlags)[number][]
}

async function runRepomix(config: RepomixConfig): Promise<void> {
  const args: string[] = ['repomix']

  const parsedArgs = parseArgs(Deno.args, {
    string: ['remote', 'include', 'ignore', 'output', 'config'],
    boolean: booleanFlags.map((flag) => toPascalCase(flag)),
    collect: ['include', 'ignore'],
  })

  if (parsedArgs.remote || config.remote) {
    args.push('--remote', (parsedArgs.remote ?? config.remote) as string)
  }

  // Handle includes from command line args or config
  const includes = [
    ...(Array.isArray(parsedArgs.include) ? parsedArgs.include : []),
    ...(Array.isArray(config.include) ? config.include : []),
  ]
  if (includes.length) {
    args.push('--include', includes.join(','))
  }

  // Handle ignores from command line args or config
  const ignores = [
    ...(Array.isArray(parsedArgs.ignore) ? parsedArgs.ignore : []),
    ...(Array.isArray(config.ignore) ? config.ignore : []),
  ]
  if (ignores.length) {
    args.push('--ignore', ignores.join(','))
  }

  if (parsedArgs.config || config.config) {
    args.push('--config', (parsedArgs.config ?? config.config) as string)
  }

  // Add any additional flags from the config
  if (config.extraFlags?.length) {
    args.push(...config.extraFlags)
  }

  // Add output flag last
  if (parsedArgs.output || config.output) {
    args.push('--output', (parsedArgs.output ?? config.output) as string)
  }

  const cmd = new Deno.Command(args[0], { args: args.slice(1) })
  const { success, stderr } = await cmd.output()

  if (success) {
    console.log(
      `${
        bold(`Snapshot for ${parsedArgs.remote || config.remote || 'local codebase'} built to:`)
      } ${dim(parsedArgs.output || join(Deno.cwd(), '.ai', 'context', 'snapshot.xml'))}`,
    )
  } else {
    console.warn('Repomix command failed:', new TextDecoder().decode(stderr))
  }
}

if (import.meta.main) {
  for (const config of configs) {
    await runRepomix(config)
  }
}
