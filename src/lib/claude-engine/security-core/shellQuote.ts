/**
 * Safe wrappers for shell-quote library functions that handle errors gracefully.
 * Extracted from claude-code src/utils/bash/shellQuote.ts
 * 
 * Dependencies replaced:
 * - logError → console.error
 * - jsonStringify → JSON.stringify
 */

import {
  type ParseEntry,
  parse as shellQuoteParse,
  quote as shellQuoteQuote,
} from 'shell-quote'

export type { ParseEntry } from 'shell-quote'

export type ShellParseResult =
  | { success: true; tokens: ParseEntry[] }
  | { success: false; error: string }

export type ShellQuoteResult =
  | { success: true; quoted: string }
  | { success: false; error: string }

export function tryParseShellCommand(
  cmd: string,
  env?:
    | Record<string, string | undefined>
    | ((key: string) => string | undefined),
): ShellParseResult {
  try {
    const tokens =
      typeof env === 'function'
        ? shellQuoteParse(cmd, env)
        : shellQuoteParse(cmd, env)
    return { success: true, tokens }
  } catch (error) {
    if (error instanceof Error) {
      console.error('[security-core] shellQuote parse error:', error.message)
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown parse error',
    }
  }
}

export function tryQuoteShellArgs(args: unknown[]): ShellQuoteResult {
  try {
    const validated: string[] = args.map((arg, index) => {
      if (arg === null || arg === undefined) {
        return String(arg)
      }

      const type = typeof arg

      if (type === 'string') {
        return arg as string
      }
      if (type === 'number' || type === 'boolean') {
        return String(arg)
      }

      if (type === 'object') {
        throw new Error(
          `Cannot quote argument at index ${index}: object values are not supported`,
        )
      }
      if (type === 'symbol') {
        throw new Error(
          `Cannot quote argument at index ${index}: symbol values are not supported`,
        )
      }
      if (type === 'function') {
        throw new Error(
          `Cannot quote argument at index ${index}: function values are not supported`,
        )
      }

      throw new Error(
        `Cannot quote argument at index ${index}: unsupported type ${type}`,
      )
    })

    const quoted = shellQuoteQuote(validated)
    return { success: true, quoted }
  } catch (error) {
    if (error instanceof Error) {
      console.error('[security-core] shellQuote quote error:', error.message)
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown quote error',
    }
  }
}

/**
 * Checks if parsed tokens contain malformed entries that suggest shell-quote
 * misinterpreted the command. This happens when input contains ambiguous
 * patterns (like JSON-like strings with semicolons) that shell-quote parses
 * according to shell rules, producing token fragments.
 */
export function hasMalformedTokens(
  command: string,
  parsed: ParseEntry[],
): boolean {
  let inSingle = false
  let inDouble = false
  let doubleCount = 0
  let singleCount = 0
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (c === '\\' && !inSingle) {
      i++
      continue
    }
    if (c === '"' && !inSingle) {
      doubleCount++
      inDouble = !inDouble
    } else if (c === "'" && !inDouble) {
      singleCount++
      inSingle = !inSingle
    }
  }
  if (doubleCount % 2 !== 0 || singleCount % 2 !== 0) return true

  for (const entry of parsed) {
    if (typeof entry !== 'string') continue

    const openBraces = (entry.match(/{/g) || []).length
    const closeBraces = (entry.match(/}/g) || []).length
    if (openBraces !== closeBraces) return true

    const openParens = (entry.match(/\(/g) || []).length
    const closeParens = (entry.match(/\)/g) || []).length
    if (openParens !== closeParens) return true

    const openBrackets = (entry.match(/\[/g) || []).length
    const closeBrackets = (entry.match(/\]/g) || []).length
    if (openBrackets !== closeBrackets) return true

    // eslint-disable-next-line custom-rules/no-lookbehind-regex
    const doubleQuotes = entry.match(/(?<!\\)"/g) || []
    if (doubleQuotes.length % 2 !== 0) return true

    // eslint-disable-next-line custom-rules/no-lookbehind-regex
    const singleQuotes = entry.match(/(?<!\\)'/g) || []
    if (singleQuotes.length % 2 !== 0) return true
  }
  return false
}

/**
 * Detects commands containing '\' patterns that exploit the shell-quote library's
 * incorrect handling of backslashes inside single quotes.
 */
export function hasShellQuoteSingleQuoteBug(command: string): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (char === '\\' && !inSingleQuote) {
      i++
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote

      if (!inSingleQuote) {
        let backslashCount = 0
        let j = i - 1
        while (j >= 0 && command[j] === '\\') {
          backslashCount++
          j--
        }
        if (backslashCount > 0 && backslashCount % 2 === 1) {
          return true
        }
        if (
          backslashCount > 0 &&
          backslashCount % 2 === 0 &&
          command.indexOf("'", i + 1) !== -1
        ) {
          return true
        }
      }
      continue
    }
  }

  return false
}

export function quote(args: ReadonlyArray<unknown>): string {
  const result = tryQuoteShellArgs([...args])

  if (result.success) {
    return result.quoted
  }

  try {
    const stringArgs = args.map(arg => {
      if (arg === null || arg === undefined) {
        return String(arg)
      }
      const type = typeof arg
      if (type === 'string' || type === 'number' || type === 'boolean') {
        return String(arg)
      }
      return JSON.stringify(arg)
    })

    return shellQuoteQuote(stringArgs)
  } catch (error) {
    if (error instanceof Error) {
      console.error('[security-core] quote fallback error:', error.message)
    }
    throw new Error('Failed to quote shell arguments safely')
  }
}
