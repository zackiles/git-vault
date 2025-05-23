/**
 * Test suite for the version command
 */

import { assert } from 'jsr:@std/assert'
import { canParse } from '@std/semver'
import version from '../src/commands/version.ts'

Deno.test({
  name: 'version: command outputs a valid semantic version',
  fn() {
    const originalConsoleLog = console.log
    let capturedOutput = ''

    console.log = (message: string) => {
      capturedOutput = message
    }

    try {
      version()

      assert(capturedOutput, 'Command should output a version')
      assert(canParse(capturedOutput), `Expected a valid semantic version, got: ${capturedOutput}`)
    } finally {
      console.log = originalConsoleLog
    }
  },
})
