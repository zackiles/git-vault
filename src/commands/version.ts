import type { CommandHandler } from '../types.ts'

/**
 * Shows gv version and other information
 */
function run(): void {
  const version = Deno.env.get('GV_VERSION')
  if (!version) {
    throw new Error('GV_VERSION is not set')
  }

  console.log(version)
}

export default run satisfies CommandHandler
