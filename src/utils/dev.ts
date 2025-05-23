import { join } from '@std/path/join'
import { green } from '@std/fmt/colors'
import { PATHS } from '../paths.ts'
import terminal from './terminal.ts'
import gracefulShutdown from './graceful-shutdown.ts'

async function start(args: string[]): Promise<string[]> {
  const tempDir = await setupTempDir()
  return [
    ...args.filter((arg) =>
      !arg.startsWith('--workspace') && !arg.startsWith('-w')
    ),
    '--workspace',
    tempDir,
  ]
}

async function setupTempDir(): Promise<string> {
  const tempDir = await Deno.makeTempDir({ prefix: `${PATHS.BASE_NAME}-dev-` })
  const originalCwd = Deno.cwd()

  console.log(
    green(`Development Mode. Temporary workspace directory: ${tempDir}`),
  )
  Deno.chdir(tempDir)

  gracefulShutdown.addShutdownHandler(() => {
    try {
      console.log(`Cleaning up temporary directory: ${tempDir}`)
      Deno.chdir(originalCwd)
      Deno.removeSync(tempDir, { recursive: true })
    } catch (error) {
      terminal.error('Failed to clean up temporary directory:', error)
    }
  })

  await new Deno.Command('git', { args: ['init'] }).output()
  await Deno.writeTextFile(join(tempDir, 'README.md'), '')

  // Write sample package.json
  const packageJson = {
    name: 'sample-project',
    version: '1.0.0',
    description: 'A sample project for development testing',
    type: 'module',
    scripts: {
      test: 'echo "Error: no test specified" && exit 1',
    },
    keywords: [],
    author: '',
    license: 'MIT',
  }

  // Write sample deno.json
  const denoJson = {
    name: 'sample-project',
    version: '1.0.0',
    description: 'A sample project for development testing',
    tasks: {
      start: 'deno run --allow-read main.ts',
      test: 'deno test --allow-read',
      lint: 'deno lint',
      fmt: 'deno fmt',
    },
  }

  await Deno.writeTextFile(
    join(tempDir, 'package.json'),
    JSON.stringify(packageJson, null, 2),
  )

  await Deno.writeTextFile(
    join(tempDir, 'deno.json'),
    JSON.stringify(denoJson, null, 2),
  )

  return tempDir
}

export { start }
