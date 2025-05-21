#!/usr/bin/env -S deno run -A

/**
 * @module test
 * @description Script to run BDD tests for Luna AI agent framework
 */

import { parseArgs } from '@std/cli/parse-args'
import { dirname, fromFileUrl, join } from '@std/path'

const scriptDir = dirname(fromFileUrl(import.meta.url))
const projectRoot = join(scriptDir, '..')

const flags = parseArgs(Deno.args, {
  string: ['filter'],
  alias: {
    f: 'filter',
  },
})

const command = new Deno.Command('deno', {
  args: [
    'test',
    '-A',
    '--reload',
    /**'--fail-fast',*/ '--reporter=dot',
    ...Deno.args,
    flags.filter ? `--filter=${flags.filter}` : 'test/**/*.test.ts',
  ],
  cwd: projectRoot,
  env: {
    ...Deno.env.toObject(),
    'DENO_ENV': 'test',
  },
  stdout: 'inherit',
  stderr: 'inherit',
})

const { code } = await command.output()
Deno.exit(code)
