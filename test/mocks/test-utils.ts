/**
 * Test utilities for setting up and managing mocks
 */
import { type Mock1PasswordCLI, createMock1PasswordCLI } from './1password.mock.ts';
import terminal from '../../src/utils/terminal.ts';
import { join } from '@std/path';

/**
 * Environment mocking interface
 */
export interface TestEnvironment {
  op: Mock1PasswordCLI;
  originalTerminal: Record<string, unknown>;
  originalCommand: typeof Deno.Command;
  restore: () => void;
}

/**
 * Setup a test environment with mocks for external dependencies
 * @param options.mockCommands - Whether to mock Deno.Command (default: true)
 * @param options.mockTerminal - Whether to mock terminal methods (default: true)
 */
export function setupTestEnvironment(options: {
  mockCommands?: boolean;
  mockTerminal?: boolean;
  gitRepoPath?: string | null; // Path that should be treated as a Git repo, or null for non-Git
} = {}): TestEnvironment {
  const { mockCommands = true, mockTerminal = true, gitRepoPath } = options;
  const op = createMock1PasswordCLI();

  // Store original terminal methods
  const originalTerminal = { ...terminal };

  // Store original Deno methods
  const originalCommand = Deno.Command;

  // Mock terminal methods that require user input (only if requested)
  if (mockTerminal) {
    terminal.createPromptPassword = () => 'test-password-123';
    terminal.createConfirm = (message: string, defaultYes = false) => {
      // For 1Password prompts, default to false (use file storage) unless explicitly testing 1Password
      if (/(?:use |connect to |with )1password|op\s+cli/i.test(message)) {
        return false;
      }
      return defaultYes;
    };
    terminal.createPromptInput = (_message: string, defaultValue = '') => defaultValue;
    terminal.createPromptSelect = (_message: string, options: string[]) => options[0] || '';
    terminal.createPromptMultiSelect = (_message: string, options: string[]) =>
      options.length ? [options[0]] : [];
  }

  // Mock Deno.Command to intercept CLI calls (only if requested)
  if (mockCommands) {
    // @ts-ignore - We're deliberately replacing this for testing
    globalThis.Deno.Command = class MockCommand {
      constructor(private command: string, private options: { args?: string[]; stdout?: string; stderr?: string; stdin?: string; cwd?: string }) {}

      async output() {
        try {
          const args = this.options.args || [];

          switch (this.command.toLowerCase()) {
            case 'op':
              return await mockOpCommand(op, args);
            case 'git':
              return await mockGitCommand(args, this.options.cwd, gitRepoPath);
            case 'gpg':
              return mockGpgCommand(args);
            case 'tar':
              return mockTarCommand(args);
            default:
              // For any other commands (where, which, etc), return success
              return {
                code: 0,
                success: true,
                stdout: new TextEncoder().encode(`Mock command executed successfully: ${this.command}`),
                stderr: new TextEncoder().encode(''),
              };
          }
        } catch (error) {
          console.error(`Error in mock command ${this.command}:`, error);
          return {
            code: 1,
            success: false,
            stdout: new TextEncoder().encode(''),
            stderr: new TextEncoder().encode(error instanceof Error ? error.message : String(error)),
          };
        }
      }
    };
  }

  return {
    op,
    originalTerminal,
    originalCommand,
    restore: () => {
      // Restore original terminal methods
      if (mockTerminal) {
        Object.assign(terminal, originalTerminal);
      }

      // Restore original Deno methods
      if (mockCommands) {
        // @ts-ignore - We're restoring the original
        globalThis.Deno.Command = originalCommand;
      }
    }
  };
}

/**
 * Helper function to mock 1Password CLI commands
 */
async function mockOpCommand(mockOp: Mock1PasswordCLI, args: string[]) {
  const command = args[0];

  try {
    if (command === '--version') {
      return {
        code: 0,
        success: true,
        stdout: new TextEncoder().encode('2.18.0'),
        stderr: new TextEncoder().encode(''),
      };
    }

    if (command === 'whoami') {
      const result = mockOp.whoami();
      return {
        code: 0,
        success: true,
        stdout: new TextEncoder().encode(result),
        stderr: new TextEncoder().encode(''),
      };
    }

    if (command === 'signin') {
      return {
        code: 0,
        success: true,
        stdout: new TextEncoder().encode(''),
        stderr: new TextEncoder().encode(''),
      };
    }

    if (command === 'vault' && args[1] === 'list') {
      const vaults = JSON.stringify([{ name: 'Git-Vault' }, { name: 'Personal' }]);
      return {
        code: 0,
        success: true,
        stdout: new TextEncoder().encode(vaults),
        stderr: new TextEncoder().encode(''),
      };
    }

    if (command === 'item' && args[1] === 'create') {
      // Parse create command arguments
      let title = '';
      let vault = '';
      const fields: Record<string, string> = {};

      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--title' && i + 1 < args.length) {
          title = args[i + 1];
          i++;
        } else if (args[i] === '--vault' && i + 1 < args.length) {
          vault = args[i + 1];
          i++;
        } else if (args[i] === '--category') {
          i++; // Skip category value
        } else if (args[i].includes('=')) {
          const [key, value] = args[i].split('=', 2);
          fields[key] = value;
        }
      }

      const result = mockOp.createItem(title, vault, fields);
      return {
        code: 0,
        success: true,
        stdout: new TextEncoder().encode(result),
        stderr: new TextEncoder().encode(''),
      };
    }

    if (command === 'item' && args[1] === 'get') {
      const title = args[2];
      let vault = '';
      let field = '';

      for (let i = 3; i < args.length; i++) {
        if (args[i] === '--vault' && i + 1 < args.length) {
          vault = args[i + 1];
          i++;
        } else if (args[i] === '--fields' && i + 1 < args.length) {
          field = args[i + 1];
          i++;
        }
      }

      const result = mockOp.getItem(title, vault, field);
      return {
        code: 0,
        success: true,
        stdout: new TextEncoder().encode(result),
        stderr: new TextEncoder().encode(''),
      };
    }

    if (command === 'item' && args[1] === 'edit') {
      const title = args[2];
      let vault = '';
      const fields: Record<string, string> = {};

      for (let i = 3; i < args.length; i++) {
        if (args[i] === '--vault' && i + 1 < args.length) {
          vault = args[i + 1];
          i++;
        } else if (args[i].includes('=')) {
          const [key, value] = args[i].split('=', 2);
          fields[key] = value;
        }
      }

      const result = mockOp.editItem(title, vault, fields);
      return {
        code: 0,
        success: true,
        stdout: new TextEncoder().encode(result),
        stderr: new TextEncoder().encode(''),
      };
    }

    // Default for unrecognized op commands
    return {
      code: 0,
      success: true,
      stdout: new TextEncoder().encode(''),
      stderr: new TextEncoder().encode(''),
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      code: 1,
      success: false,
      stdout: new TextEncoder().encode(''),
      stderr: new TextEncoder().encode(errorMessage),
    };
  }
}

/**
 * Helper function to mock Git commands
 */
async function mockGitCommand(args: string[], cwd?: string, gitRepoPath?: string | null) {
  try {
    const command = args[0]?.toLowerCase() || '';
    const repoPath = cwd || Deno.cwd();

    // Check if we're in a Git repository
    const isInGitRepo = gitRepoPath === null ? false : (gitRepoPath !== undefined ? (cwd === gitRepoPath || repoPath === gitRepoPath) : true);

    switch (command) {
      case 'rev-parse':
        if (args.includes('--show-toplevel')) {
          // If we're not in a Git repo, simulate failure
          if (!isInGitRepo) {
            return {
              code: 128,
              success: false,
              stdout: new TextEncoder().encode(''),
              stderr: new TextEncoder().encode('fatal: not a git repository (or any of the parent directories): .git'),
            };
          }
          return {
            code: 0,
            success: true,
            stdout: new TextEncoder().encode(repoPath),
            stderr: new TextEncoder().encode(''),
          };
        }
        if (args.includes('--is-inside-work-tree')) {
          // If we're not in a Git repo, simulate failure
          if (!isInGitRepo) {
            return {
              code: 128,
              success: false,
              stdout: new TextEncoder().encode(''),
              stderr: new TextEncoder().encode('fatal: not a git repository (or any of the parent directories): .git'),
            };
          }
          return {
            code: 0,
            success: true,
            stdout: new TextEncoder().encode('true'),
            stderr: new TextEncoder().encode(''),
          };
        }
        if (args.includes('--git-dir')) {
          // If we're not in a Git repo, simulate failure
          if (!isInGitRepo) {
            return {
              code: 128,
              success: false,
              stdout: new TextEncoder().encode(''),
              stderr: new TextEncoder().encode('fatal: not a git repository (or any of the parent directories): .git'),
            };
          }
          return {
            code: 0,
            success: true,
            stdout: new TextEncoder().encode(`${repoPath}/.git`),
            stderr: new TextEncoder().encode(''),
          };
        }
        break;

      case 'lfs': {
        const subCommand = args[1]?.toLowerCase();
        switch (subCommand) {
          case 'version':
            return {
              code: 0,
              success: true,
              stdout: new TextEncoder().encode('git-lfs/3.0.0'),
              stderr: new TextEncoder().encode(''),
            };
          case 'install':
            return {
              code: 0,
              success: true,
              stdout: new TextEncoder().encode('Git LFS initialized.'),
              stderr: new TextEncoder().encode(''),
            };
          case 'track':
            return {
              code: 0,
              success: true,
              stdout: new TextEncoder().encode(`Tracking "${args[2] || '*.tar.gz.gpg'}"`),
              stderr: new TextEncoder().encode(''),
            };
        }
        break;
      }

      case 'remote':
        if (args[1] === 'get-url' && args[2] === 'origin') {
          return {
            code: 0,
            success: true,
            stdout: new TextEncoder().encode('https://github.com/test/test-repo.git'),
            stderr: new TextEncoder().encode(''),
          };
        }
        return {
          code: 0,
          success: true,
          stdout: new TextEncoder().encode('origin'),
          stderr: new TextEncoder().encode(''),
        };

      // Common Git commands that should always succeed in tests
      case 'init':
      case 'add':
      case 'commit':
      case 'status':
      case 'ls-files':
        return {
          code: 0,
          success: true,
          stdout: new TextEncoder().encode(''),
          stderr: new TextEncoder().encode(''),
        };

      case 'config':
        if (args[1] === 'core.hooksPath') {
          // If setting hooks path, create the hooks directory and files
          if (args.length >= 3 && cwd) {
            const hooksPath = args[2].startsWith('/') ? args[2] : join(cwd, args[2]);
            try {
              // Create hooks directory
              await Deno.mkdir(hooksPath, { recursive: true });

              // Create hook files
              const hooks = ['pre-commit', 'post-checkout', 'post-merge'];
              for (const hook of hooks) {
                const hookPath = join(hooksPath, hook);
                await Deno.writeTextFile(hookPath, `#!/bin/sh\n# git-vault hook\necho "git-vault ${hook} hook"\n`);
                await Deno.chmod(hookPath, 0o755);
              }
            } catch (error) {
              console.error('Failed to create hooks:', error);
            }
          }

          // Return the custom hooks path if it was set
          return {
            code: 0,
            success: true,
            stdout: new TextEncoder().encode(args[2] || ''),
            stderr: new TextEncoder().encode(''),
          };
        }
        return {
          code: 0,
          success: true,
          stdout: new TextEncoder().encode(''),
          stderr: new TextEncoder().encode(''),
        };
    }

    // Default success for any other git command
    return {
      code: 0,
      success: true,
      stdout: new TextEncoder().encode(`Mock git command executed: ${args.join(' ')}`),
      stderr: new TextEncoder().encode(''),
    };
  } catch (error) {
    console.error('Error in mockGitCommand:', error);
    return {
      code: 1,
      success: false,
      stdout: new TextEncoder().encode(''),
      stderr: new TextEncoder().encode(error instanceof Error ? error.message : String(error)),
    };
  }
}

/**
 * Helper function to mock GPG commands
 */
function mockGpgCommand(args: string[]) {
  // Handle encryption (both long and short forms)
  if (args.includes('--symmetric') || args.includes('-c')) {
    // Find the output file
    let outputFile = '';
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--output' && i + 1 < args.length) {
        outputFile = args[i + 1];
        break;
      }
    }

    // Create a dummy encrypted file for tests
    if (outputFile) {
      try {
        Deno.writeTextFileSync(outputFile, 'mock-encrypted-content');
      } catch {
        // If we can't write the file, that's okay for some tests
      }
    }

    return {
      code: 0,
      success: true,
      stdout: new TextEncoder().encode(''),
      stderr: new TextEncoder().encode(''),
    };
  }

  // Handle decryption
  if (args.includes('--decrypt')) {
    return {
      code: 0,
      success: true,
      stdout: new TextEncoder().encode('decrypted content'),
      stderr: new TextEncoder().encode(''),
    };
  }

  // Handle version check
  if (args.includes('--version')) {
    return {
      code: 0,
      success: true,
      stdout: new TextEncoder().encode('gpg (GnuPG) 2.4.0'),
      stderr: new TextEncoder().encode(''),
    };
  }

  // Default success for other GPG commands
  return {
    code: 0,
    success: true,
    stdout: new TextEncoder().encode(''),
    stderr: new TextEncoder().encode(''),
  };
}

/**
 * Helper function to mock tar commands
 */
function mockTarCommand(args: string[]) {
  // Handle archive creation (tar -czf archive.tar.gz file)
  if (args.includes('-czf') || args.includes('-c')) {
    // Find the output file (usually the argument after -czf)
    let outputFile = '';
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-czf' && i + 1 < args.length) {
        outputFile = args[i + 1];
        break;
      }
    }

    // Create a dummy archive file for tests
    if (outputFile) {
      try {
        // Create a minimal tar.gz.gpg file for testing
        Deno.writeTextFileSync(outputFile, 'mock-encrypted-archive-content');
      } catch {
        // If we can't write the file, that's okay for some tests
      }
    }

    return {
      code: 0,
      success: true,
      stdout: new TextEncoder().encode(''),
      stderr: new TextEncoder().encode(''),
    };
  }

  // Handle archive extraction
  if (args.includes('-xzf') || args.includes('-x')) {
    return {
      code: 0,
      success: true,
      stdout: new TextEncoder().encode(''),
      stderr: new TextEncoder().encode(''),
    };
  }

  // Default success for other tar commands
  return {
    code: 0,
    success: true,
    stdout: new TextEncoder().encode(''),
    stderr: new TextEncoder().encode(''),
  };
}
