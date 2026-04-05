/**
 * Security Guard — Unified Security Check Entry Point
 *
 * Orchestrates all 4 security layers for a tool invocation:
 * 1. Bash safety analysis (for Bash tool)
 * 2. Permission rule + mode check
 * 3. Hook interception (PreToolUse)
 * 4. Sandbox validation
 *
 * This is the single entry point that Gateway calls before executing any tool
 * on behalf of an LLM API provider. IDE-based providers (Antigravity, Codex)
 * have their own built-in security — this module handles "bare API" scenarios.
 *
 * Usage:
 *   const result = await checkToolSafety('Bash', { command: 'rm -rf /' }, context);
 *   if (!result.allowed) { ... }
 */

import { createLogger } from '../logger';
import { analyzeBashCommand } from './bash-safety';
import { executeHooks } from './hook-runner';
import { checkPermission } from './permission-engine';
import { isReadAllowed, isWriteAllowed, mergeSandboxRules } from './sandbox-manager';
import type {
  BashSafetyResult,
  PermissionDecision,
  PermissionMode,
  PermissionRule,
  SandboxConfig,
  SecurityPolicy,
  ToolExecutionContext,
} from './types';

const log = createLogger('SecurityGuard');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SafetyCheckResult {
  /** Whether the tool invocation is allowed. */
  allowed: boolean
  /** Overall reason for the decision. */
  reason: string
  /** Detailed results from each layer. */
  details: {
    permission?: PermissionDecision
    bashSafety?: BashSafetyResult
    hookDecision?: 'approve' | 'block'
    sandboxCheck?: { allowed: boolean; reason: string }
  }
  /** Modified input (if hooks updated it). */
  updatedInput?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Check whether a tool invocation is safe to execute.
 *
 * Layers are checked in order:
 * 1. Bash safety (fast, pure analysis — no I/O)
 * 2. Permission rules + mode (fast, pure evaluation)
 * 3. Hooks (may involve I/O if command hooks are used)
 * 4. Sandbox (fast, path/domain checking)
 *
 * @param toolName The tool being invoked
 * @param toolInput The tool's input parameters
 * @param context Execution context (workspace, rules, sandbox, mode)
 * @returns Safety check result
 */
export async function checkToolSafety(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<SafetyCheckResult> {
  const details: SafetyCheckResult['details'] = {};

  // ── Layer 1: Bash Safety ──
  if (toolName === 'Bash' && toolInput.command) {
    const bashResult = analyzeBashCommand(String(toolInput.command));
    details.bashSafety = bashResult;

    if (bashResult.level === 'blocked') {
      log.warn({ command: String(toolInput.command).slice(0, 100) }, 'Bash command blocked by safety check');
      return {
        allowed: false,
        reason: `Bash command blocked: ${bashResult.issues.map(i => i.description).join('; ')}`,
        details,
      };
    }
  }

  // ── Layer 2: Permission Rules + Mode ──
  const permission = checkPermission(toolName, toolInput, context.rules, context.mode);
  details.permission = permission;

  if (permission.behavior === 'deny') {
    return {
      allowed: false,
      reason: 'message' in permission ? permission.message : 'Denied by permission rules',
      details,
    };
  }

  // 'ask' behavior — in OPC context, route to approval framework
  if (permission.behavior === 'ask') {
    // For now, treat 'ask' as 'deny' in automated context
    // Future: integrate with approval framework for live sessions
    return {
      allowed: false,
      reason: 'message' in permission ? permission.message : 'Approval required',
      details,
    };
  }

  // ── Layer 3: Hooks ──
  const hookResult = await executeHooks('PreToolUse', {
    event: 'PreToolUse',
    toolName,
    toolInput,
    runId: context.runId,
    workspace: context.workspace,
  });

  if (hookResult.decision) {
    details.hookDecision = hookResult.decision;
  }

  if (hookResult.decision === 'block') {
    return {
      allowed: false,
      reason: hookResult.reason ?? 'Blocked by hook',
      details,
    };
  }

  if (hookResult.continue === false) {
    return {
      allowed: false,
      reason: hookResult.stopReason ?? 'Stopped by hook',
      details,
    };
  }

  // ── Layer 4: Sandbox ──
  const mergedSandbox = mergeSandboxRules(context.sandbox, context.rules);

  // Check file write permissions
  if (toolName === 'FileEdit' || toolName === 'Edit' || toolName === 'Write') {
    const filePath = String(toolInput.path ?? toolInput.file_path ?? '');
    if (filePath) {
      const writeCheck = isWriteAllowed(filePath, context.workspace, mergedSandbox);
      details.sandboxCheck = writeCheck;
      if (!writeCheck.allowed) {
        return {
          allowed: false,
          reason: `Sandbox: ${writeCheck.reason}`,
          details,
        };
      }
    }
  }

  // Check file read permissions
  if (toolName === 'Read' || toolName === 'View') {
    const filePath = String(toolInput.path ?? toolInput.file_path ?? '');
    if (filePath) {
      const readCheck = isReadAllowed(filePath, context.workspace, mergedSandbox);
      details.sandboxCheck = readCheck;
      if (!readCheck.allowed) {
        return {
          allowed: false,
          reason: `Sandbox: ${readCheck.reason}`,
          details,
        };
      }
    }
  }

  // ── All Layers Passed ──
  return {
    allowed: true,
    reason: 'All security checks passed',
    details,
    updatedInput: hookResult.updatedInput,
  };
}
