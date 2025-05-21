import { dedent } from '@qnighy/dedent'
import type { CommandHandler } from '../types.ts'

/**
 * Version command implementation
 *
 * Shows git-vault version and other information
 */
function versionCommand(): Promise<void> {
  const version = '0.0.4'

  console.log(dedent`git-vault version ${version}\n
Environment:
  Deno: ${Deno.version.deno}
  TypeScript: ${Deno.version.typescript}
  V8: ${Deno.version.v8}
`)

  console.log(dedent`For more information, visit: https://github.com/zackiles/git-vault`)
  console.log(dedent`Report issues: https://github.com/zackiles/git-vault/issues`)

  return Promise.resolve()
}

const version: CommandHandler = { run: versionCommand }

export default version
