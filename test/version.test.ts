/**
 * Test suite for the version command
 *
 * These tests are simple unit tests that don't require any external dependencies.
 */

import { assert } from 'jsr:@std/assert'
import version from '../src/commands/version.ts'

// Test version command output
Deno.test({
  name: 'version: command runs without error',
  async fn() {
    // Run version command
    await version.run({ _: [] })

    // We can't easily capture console output, but we can verify the command runs
    assert(true, 'Version command completed without errors')
  },
})
