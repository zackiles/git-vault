/**
 * Test utilities for setting up and managing mocks
 */
import { type Mock1PasswordCLI, createMock1PasswordCLI } from './1password.mock.ts';
import terminal from '../../src/utils/terminal.ts';

/**
 * Environment mocking interface
 */
export interface TestEnvironment {
  op: Mock1PasswordCLI;
  originalTerminal: Record<string, unknown>;
  restore: () => void;
}

/**
 * Setup a test environment with mocks for external dependencies
 */
export function setupTestEnvironment(): TestEnvironment {
  const op = createMock1PasswordCLI();

  // Store original terminal methods
  const originalTerminal = { ...terminal };

  // Mock terminal methods that require user input
  terminal.createPromptPassword = () => 'test-password';
  terminal.createConfirm = (message: string, defaultYes = false) => {
    // For 1Password prompts, default to false (use file storage) unless explicitly testing 1Password
    if (message.includes('1Password for password storage')) {
      return false;
    }
    return defaultYes;
  };
  terminal.createPromptInput = (_message: string, defaultValue = '') => defaultValue;
  terminal.createPromptSelect = (_message: string, options: string[]) => options[0] || '';
  terminal.createPromptMultiSelect = (_message: string, options: string[]) =>
    options.length ? [options[0]] : [];

  return {
    op,
    originalTerminal,
    restore: () => {
      // Restore original terminal methods
      Object.assign(terminal, originalTerminal);
    }
  };
}

/**
 * Helper function to mock command execution
 * This can be used to mock operations like GPG, Git, etc.
 */
export function mockCommand(command: string, args: string[]): Deno.Command {
  if (command === 'op') {
    // Mock 1Password CLI commands
    const mockOp = createMock1PasswordCLI();
    return mockOpCommand(mockOp, args);
  }

  // Default mock implementation for any other command
  return {
    output: async () => ({
      code: 0,
      success: true,
      stdout: new TextEncoder().encode('Mock command executed successfully'),
      stderr: new TextEncoder().encode('')
    })
  } as unknown as Deno.Command;
}

/**
 * Helper function to mock 1Password CLI commands
 */
function mockOpCommand(mockOp: Mock1PasswordCLI, args: string[]): Deno.Command {
  const command = args[0];

  if (command === 'whoami') {
    return {
      output: async () => {
        try {
          const result = mockOp.whoami();
          return {
            code: 0,
            success: true,
            stdout: new TextEncoder().encode(result),
            stderr: new TextEncoder().encode('')
          };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            code: 1,
            success: false,
            stdout: new TextEncoder().encode(''),
            stderr: new TextEncoder().encode(errorMessage)
          };
        }
      }
    } as unknown as Deno.Command;
  } else if (command === 'item' && args[1] === 'create') {
    // Extract params from args
    const titleIndex = args.findIndex(arg => arg === '--title') + 1;
    const vaultIndex = args.findIndex(arg => arg === '--vault') + 1;
    const title = args[titleIndex];
    const vault = args[vaultIndex];

    // Extract fields from remaining args
    const fields: Record<string, string> = {};
    for (let i = vaultIndex + 1; i < args.length; i++) {
      if (args[i].includes('=')) {
        const [key, value] = args[i].split('=');
        fields[key] = value;
      }
    }

    return {
      output: async () => {
        try {
          const result = mockOp.createItem(title, vault, fields);
          return {
            code: 0,
            success: true,
            stdout: new TextEncoder().encode(result),
            stderr: new TextEncoder().encode('')
          };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            code: 1,
            success: false,
            stdout: new TextEncoder().encode(''),
            stderr: new TextEncoder().encode(errorMessage)
          };
        }
      }
    } as unknown as Deno.Command;
  } else if (command === 'item' && args[1] === 'get') {
    // Extract params from args
    const titleIndex = 2;
    const vaultIndex = args.findIndex(arg => arg === '--vault') + 1;
    const fieldsIndex = args.findIndex(arg => arg === '--fields') + 1;

    const title = args[titleIndex];
    const vault = args[vaultIndex];
    const field = fieldsIndex > 0 ? args[fieldsIndex] : undefined;

    return {
      output: async () => {
        try {
          const result = mockOp.getItem(title, vault, field);
          return {
            code: 0,
            success: true,
            stdout: new TextEncoder().encode(result),
            stderr: new TextEncoder().encode('')
          };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            code: 1,
            success: false,
            stdout: new TextEncoder().encode(''),
            stderr: new TextEncoder().encode(errorMessage)
          };
        }
      }
    } as unknown as Deno.Command;
  }

  // Default for unimplemented op commands
  return {
    output: async () => ({
      code: 0,
      success: true,
      stdout: new TextEncoder().encode('Mock op command executed'),
      stderr: new TextEncoder().encode('')
    })
  } as unknown as Deno.Command;
}
