/**
 * @anthropic-claude/security-core
 * 
 * Complete bash security & permission engine extracted from claude-code.
 * Phase 1: 23 security validators for shell command injection detection.
 * Phase 2: Permission rule matching & dangerous command patterns.
 * Phase 3: Full permission chain (sed, path, mode, sandbox, command helpers).
 * 
 * Usage:
 *   import { bashCommandIsSafe, configureAnalytics, configureSecurityContext } from '@anthropic-claude/security-core'
 *   
 *   // Configure runtime context
 *   configureSecurityContext({ cwd: '/my/project', ... })
 *   
 *   // Optional: hook up analytics
 *   configureAnalytics((event, data) => myLogger.log(event, data))
 *   
 *   const result = bashCommandIsSafe('rm -rf /')
 *   if (result.behavior === 'ask') {
 *     console.log('Dangerous:', result.message)
 *   }
 */

// Core security checker
export {
  bashCommandIsSafe,
  configureAnalytics,
  stripSafeHeredocSubstitutions,
  hasSafeHeredocSubstitution,
} from './bashSecurity'

// Security context configuration
export { configureSecurityContext } from './stubs'

// Permission types
export type {
  PermissionResult,
  PermissionDecision,
  PermissionBehavior,
  PermissionAllowDecision,
  PermissionAskDecision,
  PermissionDenyDecision,
  PermissionDecisionReason,
  PermissionRule,
  PermissionRuleValue,
  PermissionRuleSource,
  PermissionMode,
  PermissionUpdate,
} from './permissions'

export { getRuleBehaviorDescription } from './permissions'

// Shell utilities
export {
  tryParseShellCommand,
  hasMalformedTokens,
  hasShellQuoteSingleQuoteBug,
  quote as shellQuote,
} from './shellQuote'

export type { ShellParseResult } from './shellQuote'

// Heredoc utilities
export { extractHeredocs } from './heredoc'

// Permission rule matching (Phase 2)
export {
  parsePermissionRule,
  matchWildcardPattern,
  commandMatchesRule,
  permissionRuleExtractPrefix,
  hasWildcards,
  suggestionForExactCommand,
  suggestionForPrefix,
} from './shellRuleMatching'

export type { ShellPermissionRule } from './shellRuleMatching'

// Dangerous command patterns (Phase 2)
export {
  DANGEROUS_BASH_PATTERNS,
  CROSS_PLATFORM_CODE_EXEC,
  isDangerousBashCommand,
} from './dangerousPatterns'

// Phase 3: Full permission sub-validators
export { checkSedConstraints } from './sedValidation'
export { checkPathConstraints } from './pathValidation'
export { checkPermissionMode } from './modeValidation'
export { checkCommandOperatorPermissions } from './bashCommandHelpers'
export { shouldUseSandbox } from './shouldUseSandbox'
export { splitCommand_DEPRECATED, extractOutputRedirections } from './commands'
export { ParsedCommand, buildParsedCommandFromRoot } from './ParsedCommand'
export { checkSemantics, parseForSecurityFromAst } from './ast'
export { parseCommandRaw } from './parser'

// Tool types (for integration)
export type {
  ToolPermissionContext,
  ToolUseContext,
  Tool,
  BashToolType,
} from './toolTypes'
export { BashTool } from './toolTypes'
