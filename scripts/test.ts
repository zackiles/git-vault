#!/usr/bin/env -S deno run -A

/**
 * @module test
 * @description Script to run tests for git-vault with proper filter handling
 */

import { dirname, fromFileUrl, join } from '@std/path'
import { parse } from '@std/jsonc'

const scriptDir = dirname(fromFileUrl(import.meta.url))
const projectRoot = join(scriptDir, '..')
const denoJson = parse(
  await Deno.readTextFile(join(projectRoot, 'deno.json')),
) as {
  version?: string
}

// Parse all raw arguments from deno task
const args = Deno.args

// Determine if we have a filter flag
let filterValue = ''
const cleanedArgs: string[] = []

// Handle special case for filter which could be a pattern or a simple string
for (let i = 0; i < args.length; i++) {
  const arg = args[i]

  if (arg === '--filter' || arg === '-f') {
    // Next argument is the filter value
    if (i + 1 < args.length) {
      filterValue = args[i + 1]
      i++ // Skip the next argument as we've processed it
    }
  } else if (arg.startsWith('--filter=')) {
    // Filter value is part of the argument
    filterValue = arg.substring('--filter='.length)
  } else if (arg.startsWith('-f=')) {
    // Filter value is part of the argument with short flag
    filterValue = arg.substring('-f='.length)
  } else {
    // Keep other arguments
    cleanedArgs.push(arg)
  }
}

// Build the command arguments
const testArgs = [
  'test',
  '-A',
  '--reporter=dot',
  '--reload',
  ...cleanedArgs,
]

// Add filter if provided
if (filterValue) {
  testArgs.push(`--filter=${filterValue}`)
}

// Default to all test files if no specific files are provided
if (!cleanedArgs.some((arg) => arg.endsWith('.ts'))) {
  testArgs.push('test/**/*.test.ts')
}

const command = new Deno.Command('deno', {
  args: testArgs,
  cwd: projectRoot,
  env: {
    ...Deno.env.toObject(),
    'DENO_ENV': 'test',
    'GV_VERSION': denoJson?.version ?? '',
  },
  stdout: 'inherit',
  stderr: 'inherit',
})

const { code } = await command.output()
Deno.exit(code)
