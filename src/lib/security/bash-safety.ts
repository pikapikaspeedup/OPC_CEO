/**
 * Bash Safety Analyzer — Command Safety Checks
 *
 * Analyzes bash commands for dangerous patterns before execution.
 * Adapted from CCB's bashSecurity.ts (50+ pattern checks, ~500 lines)
 * to a streamlined version for Gateway context.
 *
 * CCB reference:
 * - src/tools/BashTool/bashSecurity.ts — Full security check suite
 * - COMMAND_SUBSTITUTION_PATTERNS, ZSH_DANGEROUS_COMMANDS
 * - BASH_SECURITY_CHECK_IDS (numbered check identifiers)
 *
 * Key CCB patterns adapted:
 * 1. Command substitution detection ($(), backticks, process substitution)
 * 2. Dangerous command blocking (rm -rf, fork bombs, etc.)
 * 3. Shell metacharacter warnings
 * 4. Output redirection analysis
 * 5. Zsh-specific dangerous commands (zmodload, emulate, syswrite, etc.)
 */

import { createLogger } from '../logger';
import type { BashDangerLevel, BashSafetyConfig, BashSafetyIssue, BashSafetyResult } from './types';
import { DEFAULT_BASH_SAFETY_CONFIG } from './types';

const log = createLogger('BashSafety');

// ---------------------------------------------------------------------------
// Dangerous pattern definitions (adapted from CCB)
// ---------------------------------------------------------------------------

/**
 * Command substitution patterns — can be used to bypass security.
 * CCB reference: COMMAND_SUBSTITUTION_PATTERNS array
 */
const SUBSTITUTION_PATTERNS: Array<{ pattern: RegExp; description: string; checkId: number }> = [
  { pattern: /\$\(/, description: '$() command substitution', checkId: 8 },
  { pattern: /\$\{/, description: '${} parameter substitution', checkId: 8 },
  { pattern: /<\(/, description: '<() process substitution', checkId: 8 },
  { pattern: />\(/, description: '>() process substitution', checkId: 8 },
  { pattern: /=\(/, description: 'Zsh =() process substitution', checkId: 8 },
  { pattern: /(?:^|[\s;&|])=[a-zA-Z_]/, description: 'Zsh equals expansion (=cmd)', checkId: 8 },
  { pattern: /\$\[/, description: '$[] legacy arithmetic expansion', checkId: 8 },
];

/**
 * Backtick detection — separate from SUBSTITUTION_PATTERNS because we need
 * to distinguish escaped vs unescaped backticks.
 * CCB reference: validateDangerousPatterns backtick handling
 */
const BACKTICK_PATTERN = /(?:^|[^\\])`/;

/**
 * Zsh-specific dangerous commands.
 * CCB reference: ZSH_DANGEROUS_COMMANDS Set
 */
const ZSH_DANGEROUS_COMMANDS = new Set([
  'zmodload', 'emulate',
  'sysopen', 'sysread', 'syswrite', 'sysseek',
  'zpty', 'ztcp', 'zsocket', 'mapfile',
  'zf_rm', 'zf_mv', 'zf_ln', 'zf_chmod', 'zf_chown', 'zf_mkdir', 'zf_rmdir', 'zf_chgrp',
]);

/**
 * Output redirection patterns.
 * CCB reference: extractOutputRedirections + DANGEROUS_PATTERNS_OUTPUT_REDIRECTION
 */
const OUTPUT_REDIRECTION_PATTERN = /(?:>>?|[12]>)\s*(?:\/|~)/;

/**
 * Control character detection.
 * CCB reference: BASH_SECURITY_CHECK_IDS.CONTROL_CHARACTERS
 */
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0e-\x1f\x7f]/;

/**
 * Unicode whitespace that could be used for obfuscation.
 * CCB reference: BASH_SECURITY_CHECK_IDS.UNICODE_WHITESPACE
 */
const UNICODE_WHITESPACE_PATTERN = /[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]/;

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze a bash command for safety issues.
 *
 * @param command The command string to analyze
 * @param config Safety configuration (override defaults)
 * @returns Safety analysis result
 */
export function analyzeBashCommand(
  command: string,
  config: BashSafetyConfig = DEFAULT_BASH_SAFETY_CONFIG,
): BashSafetyResult {
  if (!config.enabled) {
    return {
      level: 'safe',
      issues: [],
      parsedCommands: [command],
      hasSubstitution: false,
    };
  }

  const issues: BashSafetyIssue[] = [];
  const trimmed = command.trim();

  // Split on common separators for multi-command analysis
  const parsedCommands = splitCommands(trimmed);
  const baseCommand = parsedCommands[0]?.split(/\s+/)[0] ?? '';

  // 1. Check blocked patterns (always critical)
  for (const blocked of config.blockedPatterns) {
    if (commandMatchesPattern(trimmed, blocked)) {
      issues.push({
        checkId: 0,
        description: `Blocked pattern: ${blocked}`,
        level: 'blocked',
        matchedPattern: blocked,
      });
    }
  }

  // 2. Check for dangerous patterns BEFORE safe-command shortcut
  //    A "safe" base command like `echo` can still be dangerous with
  //    substitution, control chars, or redirection. CCB does the same:
  //    safe command check is only valid for plain, simple invocations.

  // 3. Command substitution detection
  let hasSubstitution = false;
  for (const { pattern, description, checkId } of SUBSTITUTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      hasSubstitution = true;
      if (config.blockSubstitution) {
        issues.push({ checkId, description, level: 'dangerous', matchedPattern: pattern.source });
      } else {
        issues.push({ checkId, description, level: 'moderate', matchedPattern: pattern.source });
      }
    }
  }

  // Backtick detection
  if (BACKTICK_PATTERN.test(trimmed)) {
    hasSubstitution = true;
    const level = config.blockSubstitution ? 'dangerous' : 'moderate';
    issues.push({
      checkId: 8,
      description: 'Backtick command substitution',
      level,
      matchedPattern: '`...`',
    });
  }

  // 4. Zsh dangerous commands
  if (ZSH_DANGEROUS_COMMANDS.has(baseCommand)) {
    issues.push({
      checkId: 20,
      description: `Zsh dangerous command: ${baseCommand}`,
      level: 'dangerous',
    });
  }

  // 5. Output redirection to sensitive paths
  if (OUTPUT_REDIRECTION_PATTERN.test(trimmed)) {
    issues.push({
      checkId: 10,
      description: 'Output redirection to absolute/home path',
      level: 'moderate',
    });
  }

  // 6. Control characters (obfuscation attempt)
  if (CONTROL_CHAR_PATTERN.test(trimmed)) {
    issues.push({
      checkId: 17,
      description: 'Control characters detected (possible obfuscation)',
      level: 'dangerous',
    });
  }

  // 7. Unicode whitespace (obfuscation attempt)
  if (UNICODE_WHITESPACE_PATTERN.test(trimmed)) {
    issues.push({
      checkId: 18,
      description: 'Unicode whitespace detected (possible obfuscation)',
      level: 'dangerous',
    });
  }

  // 8. Incomplete command (trailing backslash-newline or pipe)
  if (/[|\\]\s*$/.test(trimmed)) {
    issues.push({
      checkId: 1,
      description: 'Incomplete command (trailing pipe or continuation)',
      level: 'moderate',
    });
  }

  // 9. IFS injection
  if (/\bIFS\s*=/.test(trimmed)) {
    issues.push({
      checkId: 11,
      description: 'IFS variable manipulation',
      level: 'moderate',
    });
  }

  // 10. /proc/environ access
  if (/\/proc\/.*\/environ/.test(trimmed)) {
    issues.push({
      checkId: 13,
      description: '/proc/environ access (credential leak risk)',
      level: 'dangerous',
    });
  }

  // 11. Safe-command shortcut — only applies when no issues were found.
  //     If a "safe" command like `echo` has substitution or control chars,
  //     we still report those issues.
  if (issues.length === 0 && isSafeCommand(trimmed, config.safeCommands)) {
    return {
      level: 'safe',
      issues: [],
      parsedCommands,
      hasSubstitution: false,
    };
  }

  // Determine overall level
  const level = determineOverallLevel(issues);

  log.debug({ command: trimmed.slice(0, 100), level, issueCount: issues.length }, 'Bash safety analysis');

  return { level, issues, parsedCommands, hasSubstitution };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split a command string on unquoted separators (;, &&, ||, |).
 * Simplified version — does not handle all quoting edge cases.
 */
function splitCommands(command: string): string[] {
  // Simple split on ; && || (not inside quotes)
  return command.split(/\s*(?:;|&&|\|\|)\s*/).filter(Boolean);
}

/**
 * Check if a command matches a blocked pattern.
 * Supports basic wildcard (*) matching.
 */
function commandMatchesPattern(command: string, pattern: string): boolean {
  if (pattern.includes('*')) {
    const regexStr = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\*/g, '.*');
    try {
      return new RegExp(regexStr, 'i').test(command);
    } catch {
      return command.toLowerCase().includes(pattern.toLowerCase().replace(/\*/g, ''));
    }
  }
  return command.toLowerCase().includes(pattern.toLowerCase());
}

/**
 * Check if a command is in the safe commands list.
 */
function isSafeCommand(command: string, safeCommands: string[]): boolean {
  const trimmed = command.trim();
  return safeCommands.some(safe => {
    if (trimmed === safe) return true;
    // Match prefix (e.g., "git status" matches "git status --short")
    if (trimmed.startsWith(safe + ' ') || trimmed.startsWith(safe + '\t')) return true;
    // Match base command
    const baseCommand = trimmed.split(/\s+/)[0];
    return baseCommand === safe;
  });
}

/**
 * Determine overall danger level from individual issues.
 */
function determineOverallLevel(issues: BashSafetyIssue[]): BashDangerLevel {
  if (issues.length === 0) return 'safe';
  if (issues.some(i => i.level === 'blocked')) return 'blocked';
  if (issues.some(i => i.level === 'dangerous')) return 'dangerous';
  if (issues.some(i => i.level === 'moderate')) return 'moderate';
  return 'safe';
}
