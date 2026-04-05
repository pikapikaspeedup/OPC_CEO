/**
 * Security Framework — Public API
 */

// Core types
export type {
  PermissionMode,
  PermissionBehavior,
  PermissionRuleSource,
  PermissionRule,
  PermissionRuleValue,
  PermissionDecision,
  PermissionDecisionReason,
  HookEvent,
  HookInput,
  HookOutput,
  HookDefinition,
  SandboxConfig,
  SandboxMode,
  SandboxFilesystem,
  SandboxNetwork,
  BashDangerLevel,
  BashSafetyResult,
  BashSafetyIssue,
  BashSafetyConfig,
  SecurityPolicy,
  GatewayTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from './types';

// Defaults
export {
  DEFAULT_PERMISSION_MODE,
  DEFAULT_SANDBOX_CONFIG,
  DEFAULT_BASH_SAFETY_CONFIG,
  DEFAULT_SECURITY_POLICY,
} from './types';

// Permission Engine
export {
  checkPermission,
  evaluateRules,
  applyModeOverlay,
  ruleMatchesTool,
  parseRuleString,
  formatRuleString,
  buildRule,
} from './permission-engine';

// Hook Runner
export {
  registerHook,
  unregisterHook,
  getHooksForEvent,
  clearHooks,
  executeHooks,
} from './hook-runner';

// Bash Safety
export { analyzeBashCommand } from './bash-safety';

// Sandbox Manager
export {
  mergeSandboxRules,
  isWriteAllowed,
  isReadAllowed,
  isNetworkAllowed,
} from './sandbox-manager';

// Policy Loader
export {
  loadSecurityPolicy,
  resolveSecurityConfig,
  resetPolicyCache,
} from './policy-loader';

// Security Guard (unified entry point)
export { checkToolSafety } from './security-guard';
export type { SafetyCheckResult } from './security-guard';
