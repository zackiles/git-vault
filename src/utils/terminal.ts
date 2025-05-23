/**
 * Terminal utility functions for gv
 */

import { parseArgs, promptSecret } from '@std/cli'
import type { PromptSelectOptions } from '@std/cli/unstable-prompt-select'
import { promptMultipleSelect } from '@std/cli/unstable-prompt-multiple-select'
import { ProgressBarStream } from '@std/cli/unstable-progress-bar-stream'
import { promptSelect } from '@std/cli/unstable-prompt-select'
import { Spinner } from '@std/cli/unstable-spinner'
import { bold, cyan, green, red, yellow } from '@std/fmt/colors'

const print = (type: string, message: string, extra?: unknown, valueColor = cyan): void => {
  const isTest = Deno.env.get('DENO_ENV') === 'test'
  if (isTest && !['error', 'warn'].includes(type)) return

  switch (type) {
    case 'error': {
      const errorDetails = extra instanceof Error
        ? `: ${extra.message}`
        : extra
        ? `: ${String(extra)}`
        : ''
      console.error(red(`Error: ${message}${errorDetails}`))
      break
    }
    case 'warn':
      console.warn(yellow(`Warning: ${message}`))
      break
    case 'success':
      console.log(green(`Success: ${message}`))
      break
    case 'info':
      console.log(`${bold(extra as string)} ${valueColor(message)}`)
      break
    case 'status':
      console.log(`${bold(extra as string || '→')} ${message}`)
      break
    case 'section':
      console.log(`\n${bold(message)}`)
      break
  }
}

/**
 * Confirms an action with the user
 *
 * @param message The confirmation message
 * @param defaultYes Whether the default action is yes
 * @returns True if confirmed, false otherwise
 */
function createConfirm(message: string, defaultYes = false): boolean {
  const values = defaultYes ? ['Yes', 'No'] : ['No', 'Yes']
  const options: PromptSelectOptions = { indicator: '>', visibleLines: 2, clear: true }
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
function createPromptInput(message: string, defaultValue = ''): string {
  const result = prompt(message, defaultValue)
  return result || defaultValue
}

/**
 * Prompts the user for a password securely
 *
 * @param message The prompt message
 * @returns The entered password, guaranteed to be a string (never null)
 */
function createPromptPassword(message: string): string {
  return promptSecret(message, { clear: true }) || ''
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

function error(message: string, error?: unknown): void {
  print('error', message, error)
}

function warn(message: string): void {
  print('warn', message)
}

function success(message: string): void {
  print('success', message)
}

function info(title: string, value: string, valueColor = cyan): void {
  print('info', value, title, valueColor)
}

function status(message: string, symbol = '→'): void {
  print('status', message, symbol)
}

function section(title: string): void {
  print('section', title)
}

/**
 * Prompt the user to select from multiple options, with null safety
 */
function createPromptSelect(
  message: string,
  options: string[],
  selectOptions?: PromptSelectOptions,
): string {
  const defaultOptions: PromptSelectOptions = { clear: true, indicator: '>' }
  const result = promptSelect(message, options, { ...defaultOptions, ...selectOptions })
  return (result ?? options[0]) || ''
}

/**
 * Prompt the user to select multiple options, with null safety
 */
function createPromptMultiSelect(
  message: string,
  options: string[],
): string[] {
  const result = promptMultipleSelect(message, options, { clear: true })
  return result ?? (options.length ? [options[0]] : [])
}

export default {
  parseArgs,
  createPromptPassword,
  createConfirm,
  createPromptInput,
  error,
  warn,
  success,
  info,
  status,
  section,
  showSpinner,
  createProgressBar,
  createPromptSelect,
  createPromptMultiSelect,
}
