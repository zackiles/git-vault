/**
 * Terminal utility functions for gv
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
 * Confirms an action with the user
 *
 * @param message The confirmation message
 * @param defaultYes Whether the default action is yes
 * @returns True if confirmed, false otherwise
 */
function confirm(message: string, defaultYes = false): boolean {
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
 * @returns The user's input
 */
function promptInput(message: string, defaultValue = ''): string {
  return prompt(message, defaultValue) || defaultValue
}

/**
 * Prompts the user for a password securely
 *
 * @param message The prompt message
 * @returns The entered password, guaranteed to be a string (never null)
 */
function safePromptPassword(message: string): string {
  return promptSecret(message) || ''
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
 * @param error Optional error instance to display details from
 */
function error(message: string, error?: unknown): void {
  const errorDetails = error instanceof Error
    ? `: ${error.message}`
    : error
    ? `: ${String(error)}`
    : ''
  console.error(red(`Error: ${message}${errorDetails}`))
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
 * Prompt the user to select from multiple options, with null safety
 */
function safePromptSelect(
  message: string,
  options: string[],
  selectOptions?: PromptSelectOptions,
): string {
  const result = promptSelect(message, options, selectOptions)
  return (result ?? options[0]) || ''
}

/**
 * Prompt the user to select multiple options, with null safety
 */
function safePromptMultipleSelect(
  message: string,
  options: string[],
): string[] {
  const result = promptMultipleSelect(message, options)
  return result ?? (options.length ? [options[0]] : [])
}

export default {
  parseArgs,
  promptPassword: safePromptPassword,
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
}
