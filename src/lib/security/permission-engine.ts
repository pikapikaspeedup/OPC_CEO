/**
 * Permission Engine — Rule Matching & Decision Making
 *
 * Implements the 2-layer permission core from CCB:
 * Layer 1: Static rule matching (deny > ask > allow)
 * Layer 2: Mode overlay + fallback
 *
 * CCB reference:
 * - D0z(...) → static deny/ask/allow rules + tool.checkPermissions
 * - YP(...) → mode-aware decision (dontAsk→deny, bypass→allow, etc.)
 * - permissions.ts (1486 lines) — simplified to ~200 lines for OPC
 *
 * Key design decisions:
 * - No TUI prompt flow (OPC has approval framework instead)
 * - No classifier (CCB's auto-mode AI classifier is Anthropic-specific)
 * - No telemetry/analytics integration
 * - Deny rules always win (same as CCB)
 */

import { createLogger } from '../logger';
import type {
  PermissionBehavior,
  PermissionDecision,
  PermissionMode,
  PermissionRule,
  PermissionRuleSource,
  PermissionRuleValue,
} from './types';

const log = createLogger('PermissionEngine');

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

/**
 * Check if a permission rule matches a tool invocation.
 *
 * Supports patterns:
 * - `Bash` → matches tool name 'Bash' (any args)
 * - `Bash(git:*)` → matches tool 'Bash' with command starting with 'git'
 * - `FileEdit(src/**)` → matches tool 'FileEdit' with path under src/
 * - `*` → matches any tool
 *
 * CCB reference: permissionRuleValueFromString / permissionRuleValueToString
 */
export function ruleMatchesTool(
  rule: PermissionRuleValue,
  toolName: string,
  toolInput?: Record<string, unknown>,
): boolean {
  // Wildcard matches everything
  if (rule.toolName === '*') return true;

  // Tool name must match
  if (rule.toolName !== toolName) return false;

  // If no content pattern, match all invocations of this tool
  if (!rule.ruleContent) return true;

  // Content pattern matching
  const content = rule.ruleContent;

  // Bash command patterns: git:*, npm:*, etc.
  if (toolName === 'Bash' && content.includes(':')) {
    const [prefix, pattern] = content.split(':', 2);
    const command = String(toolInput?.command ?? '').trim();
    const baseCommand = command.split(/\s+/)[0];
    if (baseCommand === prefix && (pattern === '*' || command.includes(pattern))) {
      return true;
    }
    return false;
  }

  // Path patterns: src/**, *.ts, etc.
  if (toolInput?.path || toolInput?.file_path) {
    const filePath = String(toolInput.path ?? toolInput.file_path);
    return matchGlobPattern(content, filePath);
  }

  // Domain patterns: domain:github.com
  if (content.startsWith('domain:') && toolInput?.url) {
    const domain = content.slice('domain:'.length);
    try {
      const url = new URL(String(toolInput.url));
      return url.hostname === domain || url.hostname.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  }

  // Fallback: simple substring match
  return Object.values(toolInput ?? {}).some(v => String(v).includes(content));
}

/**
 * Simple glob pattern matching.
 * Supports: *, **, ? and path separators.
 */
function matchGlobPattern(pattern: string, value: string): boolean {
  // Convert glob to regex
  const regexStr = pattern
    .replace(/\*\*/g, '<<<DSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/<<<DSTAR>>>/g, '.*');
  try {
    return new RegExp(`^${regexStr}$`).test(value);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Layer 1: Static rule evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate static permission rules for a tool invocation.
 *
 * Priority: deny > ask > allow (same as CCB)
 * Within same behavior: later rules override earlier ones.
 *
 * CCB reference: D0z(...) — first layer of permission core
 *
 * @param rules All applicable rules (organization + department + group + session)
 * @param toolName The tool being invoked
 * @param toolInput The tool's input parameters
 */
export function evaluateRules(
  rules: PermissionRule[],
  toolName: string,
  toolInput?: Record<string, unknown>,
): PermissionDecision | null {
  let matchedAllow: PermissionRule | undefined;
  let matchedAsk: PermissionRule | undefined;
  let matchedDeny: PermissionRule | undefined;

  for (const rule of rules) {
    if (!ruleMatchesTool(rule.value, toolName, toolInput)) continue;
    
    switch (rule.behavior) {
      case 'deny':
        matchedDeny = rule;
        break;
      case 'ask':
        matchedAsk = rule;
        break;
      case 'allow':
        matchedAllow = rule;
        break;
    }
  }

  // Deny always wins
  if (matchedDeny) {
    return {
      behavior: 'deny',
      reason: { type: 'rule', rule: matchedDeny },
      message: `Denied by rule: ${matchedDeny.value.toolName}${matchedDeny.value.ruleContent ? `(${matchedDeny.value.ruleContent})` : ''}`,
    };
  }

  // Ask takes precedence over allow
  if (matchedAsk) {
    return {
      behavior: 'ask',
      reason: { type: 'rule', rule: matchedAsk },
      message: `Approval required: ${matchedAsk.value.toolName}${matchedAsk.value.ruleContent ? `(${matchedAsk.value.ruleContent})` : ''}`,
    };
  }

  // Allow
  if (matchedAllow) {
    return {
      behavior: 'allow',
      reason: { type: 'rule', rule: matchedAllow },
    };
  }

  // No matching rule
  return null;
}

// ---------------------------------------------------------------------------
// Layer 2: Mode overlay
// ---------------------------------------------------------------------------

/**
 * Apply permission mode to a rule evaluation result.
 *
 * CCB reference: YP(...) — second layer of permission core
 *
 * @param ruleResult Result from evaluateRules (or null if no rules matched)
 * @param mode Current permission mode
 */
export function applyModeOverlay(
  ruleResult: PermissionDecision | null,
  mode: PermissionMode,
): PermissionDecision {
  // If rules gave a definitive answer, respect it
  // (except bypass mode which overrides everything)
  if (ruleResult && mode !== 'bypass') {
    // In strict mode, 'ask' becomes 'deny' (no interactive prompt in OPC)
    if (mode === 'strict' && ruleResult.behavior === 'ask') {
      return {
        behavior: 'deny',
        reason: { type: 'mode', mode },
        message: `Strict mode: ${(ruleResult as any).message ?? 'no explicit allow rule'}`,
      };
    }
    return ruleResult;
  }

  // No rule matched — apply mode defaults
  switch (mode) {
    case 'bypass':
      return { behavior: 'allow', reason: { type: 'mode', mode } };

    case 'strict':
      return {
        behavior: 'deny',
        reason: { type: 'mode', mode },
        message: 'Strict mode: no explicit allow rule for this tool',
      };

    case 'permissive':
      return { behavior: 'allow', reason: { type: 'mode', mode } };

    case 'default':
    default:
      // Default mode: ask for unknown tools
      return {
        behavior: 'ask',
        reason: { type: 'mode', mode },
        message: 'No permission rule matched — approval required',
      };
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Check permission for a tool invocation.
 *
 * Combines both layers:
 * 1. Static rule matching
 * 2. Mode overlay
 *
 * @param toolName Tool being invoked
 * @param toolInput Tool input parameters
 * @param rules All applicable permission rules
 * @param mode Current permission mode
 */
export function checkPermission(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  rules: PermissionRule[],
  mode: PermissionMode,
): PermissionDecision {
  log.debug({ toolName, mode, ruleCount: rules.length }, 'Checking permission');

  // Layer 1: Static rules
  const ruleResult = evaluateRules(rules, toolName, toolInput);

  // Layer 2: Mode overlay
  const decision = applyModeOverlay(ruleResult, mode);

  log.debug({ toolName, behavior: decision.behavior, reason: decision.reason.type }, 'Permission decision');

  return decision;
}

// ---------------------------------------------------------------------------
// Rule parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a rule string like "Bash(git:*)" into a PermissionRuleValue.
 *
 * CCB reference: permissionRuleValueFromString
 */
export function parseRuleString(ruleStr: string): PermissionRuleValue {
  const match = ruleStr.match(/^([^(]+)(?:\(([^)]*)\))?$/);
  if (!match) {
    return { toolName: ruleStr };
  }
  return {
    toolName: match[1],
    ruleContent: match[2] || undefined,
  };
}

/**
 * Format a PermissionRuleValue back to a string.
 *
 * CCB reference: permissionRuleValueToString
 */
export function formatRuleString(value: PermissionRuleValue): string {
  if (value.ruleContent) {
    return `${value.toolName}(${value.ruleContent})`;
  }
  return value.toolName;
}

/**
 * Build a complete PermissionRule from a compact specification.
 *
 * @param behavior 'allow' | 'deny' | 'ask'
 * @param ruleStr Rule string like "Bash(git:*)"
 * @param source Where the rule came from
 */
export function buildRule(
  behavior: PermissionBehavior,
  ruleStr: string,
  source: PermissionRuleSource = 'organization',
): PermissionRule {
  return {
    source,
    behavior,
    value: parseRuleString(ruleStr),
  };
}
