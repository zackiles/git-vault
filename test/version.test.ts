/**
 * Test suite for the version command
 */

import { assert } from 'jsr:@std/assert'
import version from '../src/commands/version.ts'

Deno.test({
  name: 'version: command runs without error',
  fn() {
    version()
    assert(true, 'Version command completed without errors')
  },
})
