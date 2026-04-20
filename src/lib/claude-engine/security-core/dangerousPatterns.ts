/**
 * Dangerous shell command patterns.
 * Extracted from claude-code src/utils/permissions/dangerousPatterns.ts
 * 
 * Commands matching these patterns can execute arbitrary code,
 * bypassing permission controls.
 */

export const CROSS_PLATFORM_CODE_EXEC = [
  'python', 'python3', 'python2',
  'node', 'deno', 'tsx',
  'ruby', 'perl', 'php', 'lua',
  'npx', 'bunx',
  'npm run', 'yarn run', 'pnpm run', 'bun run',
  'bash', 'sh',
  'ssh',
] as const

export const DANGEROUS_BASH_PATTERNS: readonly string[] = [
  ...CROSS_PLATFORM_CODE_EXEC,
  'zsh', 'fish',
  'eval', 'exec', 'env',
  'xargs', 'sudo',
]

/**
 * Check if a command starts with any dangerous pattern.
 * Used to identify commands that can execute arbitrary code.
 */
export function isDangerousBashCommand(command: string): boolean {
  const trimmed = command.trim()
  return DANGEROUS_BASH_PATTERNS.some(
    pattern => trimmed === pattern || trimmed.startsWith(`${pattern} `),
  )
}
