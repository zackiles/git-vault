/**
 * Terminal utility functions for git-vault
 *
 * This file provides functions for interacting with the terminal,
 * including handling CLI arguments, prompting for user input, and
 * displaying formatted output.
 */

import { parseArgs, promptSecret } from '@std/cli'
import type { PromptSelectOptions } from '@std/cli/unstable-prompt-select'
import { promptMultipleSelect } from '@std/cli/unstable-prompt-multiple-select'
import { ProgressBarStream } from '@std/cli/unstable-progress-bar-stream'
import { promptSelect } from '@std/cli/unstable-prompt-select'
import { Spinner } from '@std/cli/unstable-spinner'
import { dedent } from '@qnighy/dedent'
import { bold, dim, green, red, yellow } from '@std/fmt/colors'
import type { Command } from '../types.ts'

/**
 * Check if we're in a non-interactive environment (CI, testing, etc.)
 */
function isNonInteractive(): boolean {
  return Deno.env.get('NON_INTERACTIVE') === 'true' || Deno.env.get('CI') === 'true'
}

/**
 * Confirms an action with the user
 *
 * @param message The confirmation message
 * @param defaultYes Whether the default action is yes
 * @returns Promise that resolves to true if confirmed, false otherwise
 */
function confirm(message: string, defaultYes = false): boolean {
  // In non-interactive mode, use the default value
  if (isNonInteractive()) {
    console.log(`${message} (Auto-selected: ${defaultYes ? 'Yes' : 'No'} in non-interactive mode)`)
    return defaultYes
  }

  const values = defaultYes ? ['Yes', 'No'] : ['No', 'Yes']
  const options: PromptSelectOptions = { indicator: '>', visibleLines: 2 }
  const response = promptSelect(message, values, options)
  return response === 'Yes'
}

/**
 * Prompts the user for input
 *
 * @param message The prompt message
 * @param defaultValue Default value to use if user enters nothing
 * @returns Promise that resolves to the user's input
 */
function promptInput(message: string, defaultValue = ''): string {
  // In non-interactive mode, use the default value
  if (isNonInteractive()) {
    console.log(`${message} (Auto-selected: ${defaultValue} in non-interactive mode)`)
    return defaultValue
  }

  return prompt(message, defaultValue) || defaultValue
}

/**
 * Shows a loading spinner
 *
 * @param message The message to display
 * @returns The spinner instance
 */
function showSpinner(message: string, options = {}): Spinner {
  const spinner = new Spinner({
    message,
    ...options,
  })
  spinner.start()
  return spinner
}

/**
 * Creates a progress bar
 *
 * @param total The total number of items
 * @param message The message to display
 * @returns The progress bar stream
 */
function createProgressBar(total: number, _message: string): ProgressBarStream {
  return new ProgressBarStream(Deno.stdout.writable, { max: total })
}

/**
 * Prints a command-specific help menu
 *
 * @param command The command to show help for
 */
function printCommandHelp(command: Command): void {
  let output = `\n${bold(command.name)}: ${dim(command.description)}\n`

  if (command.aliases && command.aliases.length > 0) {
    output += `\n${yellow('Aliases:')} ${command.aliases.join(', ')}\n`
  }

  if (command.args && command.args.length > 0) {
    output += `\n${yellow('Arguments:')}\n`
    for (const arg of command.args) {
      const required = arg.required ? yellow(' (required)') : ''
      const defaultValue = arg.default !== undefined ? dim(` (default: ${arg.default})`) : ''
      output += `  ${bold(arg.name)}${required}${defaultValue}: ${dim(arg.description)}\n`
    }
  }

  console.log(output)
}

/**
 * Prints the main help menu
 *
 * @param commands All available commands
 */
function printHelp(commands: Command[]): void {
  const commandsList = commands.map((command) =>
    `  ${bold(command.name)}: ${dim(command.description)}`
  ).join('\n')

  const output = dedent`
    ${bold('Git Vault')} - ${dim('Secure file encryption for Git repositories')}

    ${yellow('Usage:')} ${bold('gv <command> [options]')}

    ${yellow('Commands:')}
    ${commandsList}

    ${dim('Run')} ${bold('"gv <command> --help"')} ${
    dim('for more information on a specific command.')
  }
  `

  console.log(output)
}

/**
 * Prints an error message
 *
 * @param message The error message
 */
function error(message: string): void {
  console.error(red(`Error: ${message}`))
}

/**
 * Prints a success message
 *
 * @param message The success message
 */
function success(message: string): void {
  console.log(green(`Success: ${message}`))
}

/**
 * Prompt the user to select from multiple options
 *
 * Wraps promptSelect with non-interactive support
 */
function safePromptSelect(
  message: string,
  options: string[],
  selectOptions?: PromptSelectOptions,
): string {
  // In non-interactive environments, return the first option
  if (isNonInteractive()) {
    const selectedOption = options[0] || ''
    console.log(`${message} (Auto-selected: ${selectedOption} in non-interactive mode)`)
    return selectedOption
  }

  const result = promptSelect(message, options, selectOptions)
  return (result ?? options[0]) || ''
}

/**
 * Prompt the user to select multiple options
 *
 * Wraps promptMultipleSelect with non-interactive support
 */
function safePromptMultipleSelect(
  message: string,
  options: string[],
): string[] {
  // In non-interactive environments, return the first option
  if (isNonInteractive()) {
    const selectedOptions = options.length ? [options[0]] : []
    console.log(
      `${message} (Auto-selected: ${selectedOptions.join(', ')} in non-interactive mode)`,
    )
    return selectedOptions
  }

  // Call the original function with only the parameters it accepts
  const result = promptMultipleSelect(message, options)
  return result ?? (options.length ? [options[0]] : [])
}

const terminal = {
  parseArgs,
  promptPassword: promptSecret,
  confirm,
  promptInput,
  printCommandHelp,
  printHelp,
  error,
  success,
  showSpinner,
  createProgressBar,
  promptSelect: safePromptSelect,
  promptMultipleSelect: safePromptMultipleSelect,
  isNonInteractive,
}

export default terminal
