/**
 * Security Framework — Type Definitions
 *
 * Defines the core types for the 4-layer security system:
 * 1. Permission Mode — Session-level security posture
 * 2. Tool Permission Rules — Fine-grained tool/path/command allow/deny rules
 * 3. Hook System — Pre/Post tool use interception
 * 4. Sandbox — Filesystem/network isolation
 *
 * Design reference:
 * - Claude Code permission system (CCB src/types/permissions.ts)
 * - HitCC docs/02-execution/01-tools-hooks-and-permissions/
 *
 * Antigravity-specific adaptations:
 * - Permission modes simplified for OPC context (no TUI prompt flow)
 * - Hook system adapted for Gateway-side execution (not IDE-side)
 * - Sandbox leverages Codex CLI sandbox when available
 * - No Anthropic-specific dependencies (telemetry, growthbooks, etc.)
 */

// ============================================================================
// Layer 1: Permission Mode — Session-Level Security Posture
// ============================================================================

/**
 * Permission mode determines the overall security posture for a session/run.
 *
 * CCB reference: EXTERNAL_PERMISSION_MODES + INTERNAL_PERMISSION_MODES
 * OPC adaptation: Simplified to 4 modes (no plan/acceptEdits, those are CCB-specific)
 *
 * Resolution: GroupDefinition.permissionMode > DepartmentConfig.permissionMode > ai-config default
 */
export type PermissionMode =
  | 'default'          // Normal: check rules, ask when uncertain
  | 'strict'           // Deny anything not explicitly allowed (≈ CCB dontAsk)
  | 'permissive'       // Allow most safe operations, ask for dangerous ones (≈ CCB acceptEdits)
  | 'bypass'           // Allow everything — dangerous, requires explicit opt-in

/**
 * Default permission mode for new sessions.
 * 'default' is always safe — checks rules and asks when uncertain.
 */
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'default';

// ============================================================================
// Layer 2: Tool Permission Rules — Fine-Grained Allow/Deny/Ask
// ============================================================================

/**
 * Permission behavior for a tool invocation.
 *
 * CCB reference: PermissionBehavior = 'allow' | 'deny' | 'ask'
 */
export type PermissionBehavior = 'allow' | 'deny' | 'ask';

/**
 * Where a permission rule originates from.
 *
 * CCB reference: PermissionRuleSource
 * OPC adaptation: Sources mapped to Gateway's config hierarchy
 */
export type PermissionRuleSource =
  | 'organization'     // From ai-config.json / organization-level settings
  | 'department'       // From .department/config.json
  | 'group'            // From GroupDefinition (pipeline-level)
  | 'role'             // From role-level config
  | 'session'          // Runtime session-scoped rules
  | 'hook'             // Rules injected by hooks

/**
 * A permission rule that controls tool execution.
 *
 * Supports the same fine-grained patterns as CCB:
 * - `Bash(git:*)` — allow git commands
 * - `FileEdit(src/**)` — allow editing files under src/
 * - `WebFetch(domain:github.com)` — allow fetching from github.com
 * - `*` — wildcard match all
 *
 * CCB reference: PermissionRule + PermissionRuleValue
 */
export interface PermissionRule {
  /** Where this rule came from. */
  source: PermissionRuleSource
  /** What to do when rule matches: allow, deny, or ask. */
  behavior: PermissionBehavior
  /** The tool + optional pattern this rule applies to. */
  value: PermissionRuleValue
  /** Optional human description. */
  description?: string
}

/**
 * The value of a permission rule — tool name + optional content pattern.
 *
 * Examples:
 * - { toolName: 'Bash', ruleContent: 'git:*' }         → allow all git commands
 * - { toolName: 'FileEdit', ruleContent: 'src/**' }     → allow editing under src/
 * - { toolName: 'Bash' }                                → applies to all Bash commands
 * - { toolName: '*' }                                   → applies to all tools
 *
 * CCB reference: PermissionRuleValue
 */
export interface PermissionRuleValue {
  toolName: string
  ruleContent?: string
}

/**
 * Result of a permission check.
 *
 * CCB reference: PermissionDecision (allow | ask | deny)
 */
export type PermissionDecision =
  | { behavior: 'allow'; reason: PermissionDecisionReason }
  | { behavior: 'deny'; reason: PermissionDecisionReason; message: string }
  | { behavior: 'ask'; reason: PermissionDecisionReason; message: string }

/**
 * Why a permission decision was made.
 *
 * CCB reference: PermissionDecisionReason
 */
export type PermissionDecisionReason =
  | { type: 'rule'; rule: PermissionRule }
  | { type: 'mode'; mode: PermissionMode }
  | { type: 'hook'; hookName: string; reason?: string }
  | { type: 'sandbox'; reason: string }
  | { type: 'safety'; reason: string }
  | { type: 'default' }

// ============================================================================
// Layer 3: Hook System — Pre/Post Tool Use Interception
// ============================================================================

/**
 * Hook events that can be intercepted.
 *
 * CCB reference: HookEvent type (26 events)
 * OPC adaptation: Start with the most essential events for Gateway context
 */
export type HookEvent =
  | 'PreToolUse'          // Before tool execution — can approve/block/modify input
  | 'PostToolUse'         // After tool execution — can modify output
  | 'PreDispatch'         // Before dispatching a run to a provider (OPC-specific)
  | 'PostCompletion'      // After a run completes (OPC-specific)
  | 'PermissionRequest'   // When a permission decision needs external input

/**
 * Input payload for hook handlers.
 *
 * CCB reference: HookInput type
 */
export interface HookInput {
  event: HookEvent
  /** Tool name (for PreToolUse/PostToolUse). */
  toolName?: string
  /** Tool input parameters (for PreToolUse). */
  toolInput?: Record<string, unknown>
  /** Tool output (for PostToolUse). */
  toolOutput?: unknown
  /** Run ID (for PreDispatch/PostCompletion). */
  runId?: string
  /** Workspace path. */
  workspace?: string
  /** Session-level context. */
  sessionContext?: Record<string, unknown>
}

/**
 * Output from a hook handler.
 *
 * CCB reference: SyncHookJSONOutput + hookSpecificOutput
 * OPC adaptation: Simplified — no async hooks for now
 */
export interface HookOutput {
  /** Whether execution should continue. Default: true. */
  continue?: boolean
  /** Reason if continue is false. */
  stopReason?: string
  /** For PreToolUse: approve or block. */
  decision?: 'approve' | 'block'
  /** Reason for the decision. */
  reason?: string
  /** For PreToolUse: modified input to use instead. */
  updatedInput?: Record<string, unknown>
  /** For PostToolUse: modified output. */
  updatedOutput?: unknown
  /** Additional context to inject into the conversation. */
  additionalContext?: string
}

/**
 * A registered hook handler.
 *
 * CCB reference: Hook definition in settings.json / .claude/settings.json
 * OPC adaptation: Hooks can be functions (in-process) or commands (subprocess)
 */
export interface HookDefinition {
  /** Unique identifier. */
  id: string
  /** Which event to intercept. */
  event: HookEvent
  /** Human description. */
  description?: string
  /** Where this hook was registered from. */
  source: PermissionRuleSource
  /** Execution type. */
  type: 'function' | 'command'
  /**
   * For type='function': the handler function.
   * For type='command': the command to execute (receives JSON stdin, outputs JSON stdout).
   */
  handler?: (input: HookInput) => Promise<HookOutput>
  command?: string
  /** Timeout in milliseconds. Default: 30000 (30s). */
  timeout?: number
  /** Whether this hook is enabled. Default: true. */
  enabled?: boolean
}

// ============================================================================
// Layer 4: Sandbox — Filesystem/Network Isolation
// ============================================================================

/**
 * Sandbox configuration for isolated execution.
 *
 * CCB reference: sandbox settings + RG8(...) merge logic
 * OPC adaptation: Leverages Codex CLI sandbox when provider=codex,
 *                 provides Gateway-enforced sandbox for LLM API providers
 *
 * Key insight from CCB: Sandbox does NOT replace permission rules.
 * Permission rules still apply — sandbox is an additional enforcement layer.
 * `Edit(path)` allow rules merge into sandbox `allowWrite` set.
 */
export interface SandboxConfig {
  /** Whether sandboxing is enabled. */
  enabled: boolean
  /** Sandbox mode (matches Codex CLI modes). */
  mode: SandboxMode
  /** Filesystem restrictions. */
  filesystem: SandboxFilesystem
  /** Network restrictions. */
  network: SandboxNetwork
}

/** Sandbox isolation level. */
export type SandboxMode =
  | 'read-only'          // Can only read workspace files
  | 'workspace-write'    // Can read/write workspace files, no external access
  | 'full-access'        // No restrictions (danger)

/**
 * Filesystem sandbox rules.
 *
 * CCB reference: sandbox.filesystem settings + Edit/Read rule merge
 */
export interface SandboxFilesystem {
  /** Paths that can be written (relative to workspace). Supports globs. */
  allowWrite: string[]
  /** Paths that cannot be written. Takes precedence over allowWrite. */
  denyWrite: string[]
  /** Paths that can be read. Default: workspace root + explicitly allowed. */
  allowRead: string[]
  /** Paths that cannot be read (secrets, credentials). */
  denyRead: string[]
}

/**
 * Network sandbox rules.
 *
 * CCB reference: sandbox.network.allowedDomains + WebFetch rule merge
 */
export interface SandboxNetwork {
  /** Whether network access is allowed at all. */
  allowExternalNetwork: boolean
  /** Allowed domains (if network is allowed). */
  allowedDomains: string[]
  /** Blocked domains. Takes precedence over allowed. */
  blockedDomains: string[]
}

// ============================================================================
// Bash Safety — Command Analysis
// ============================================================================

/**
 * Known dangerous command patterns for Bash execution.
 *
 * CCB reference: bashSecurity.ts — 50+ patterns
 * OPC adaptation: Start with the most critical patterns
 */
export type BashDangerLevel = 'safe' | 'moderate' | 'dangerous' | 'blocked';

/**
 * Result of analyzing a bash command for safety.
 */
export interface BashSafetyResult {
  /** Overall danger level. */
  level: BashDangerLevel
  /** Specific issues found. */
  issues: BashSafetyIssue[]
  /** The parsed command(s). */
  parsedCommands: string[]
  /** Whether the command contains subshell/substitution. */
  hasSubstitution: boolean
}

/**
 * A specific safety issue found in a command.
 *
 * CCB reference: BASH_SECURITY_CHECK_IDS + validateDangerousPatterns
 */
export interface BashSafetyIssue {
  /** Numeric ID for logging (matches CCB convention). */
  checkId: number
  /** Human-readable description. */
  description: string
  /** Danger level of this specific issue. */
  level: BashDangerLevel
  /** The pattern that matched. */
  matchedPattern?: string
}

// ============================================================================
// Security Policy — Organization-Level Configuration
// ============================================================================

/**
 * Organization-level security policy.
 *
 * Stored alongside AIProviderConfig.
 * Merged with department-level overrides.
 *
 * CCB reference: managed policy + allowManagedPermissionRulesOnly
 */
export interface SecurityPolicy {
  /** Default permission mode for all sessions. */
  defaultMode: PermissionMode
  /** Whether only organization-managed rules apply (department/session rules ignored). */
  managedRulesOnly?: boolean
  /** Global allow rules. */
  allowRules: PermissionRule[]
  /** Global deny rules (always take precedence). */
  denyRules: PermissionRule[]
  /** Default sandbox config. */
  sandbox: SandboxConfig
  /** Registered hooks. */
  hooks: HookDefinition[]
  /** Bash-specific safety config. */
  bash: BashSafetyConfig
}

/**
 * Bash-specific safety configuration.
 *
 * CCB reference: bashSecurity.ts patterns + command semantics
 */
export interface BashSafetyConfig {
  /** Whether to apply bash safety checks. Default: true. */
  enabled: boolean
  /** Commands that are always blocked (e.g., rm -rf /, curl | sh). */
  blockedPatterns: string[]
  /** Safe commands that skip safety checks (e.g., ls, cat, echo). */
  safeCommands: string[]
  /** Whether to block command substitution ($(), backticks). Default for strict: true. */
  blockSubstitution: boolean
}

// ============================================================================
// Tool Definition — For Gateway-managed tools (non-IDE providers)
// ============================================================================

/**
 * A tool that Gateway provides to LLM API providers.
 *
 * When using bare LLM APIs (not Antigravity/Codex), Gateway needs its own tools.
 * These are extracted/adapted from CCB's tool implementations.
 *
 * CCB reference: Tool interface in src/Tool.ts
 */
export interface GatewayTool {
  /** Tool name (matches the Claude API tool_use name). */
  name: string
  /** Human description shown to the model. */
  description: string
  /** JSON Schema for tool input. */
  inputSchema: Record<string, unknown>
  /** Permission check for this tool (called before execution). */
  checkPermission?: (input: Record<string, unknown>, context: ToolExecutionContext) => PermissionDecision
  /** Execute the tool. */
  execute: (input: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolExecutionResult>
}

/**
 * Context available during tool execution.
 */
export interface ToolExecutionContext {
  /** Current workspace path. */
  workspace: string
  /** Current permission rules. */
  rules: PermissionRule[]
  /** Current sandbox config. */
  sandbox: SandboxConfig
  /** Current permission mode. */
  mode: PermissionMode
  /** Run ID. */
  runId?: string
  /** Abort signal. */
  signal?: AbortSignal
}

/**
 * Result from tool execution.
 */
export interface ToolExecutionResult {
  /** Whether execution succeeded. */
  success: boolean
  /** Text content to return to the model. */
  content: string
  /** Whether the result was truncated. */
  truncated?: boolean
  /** Error message if failed. */
  error?: string
}

// ============================================================================
// Default Configurations
// ============================================================================

/** Default sandbox configuration — workspace-write mode. */
export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  enabled: true,
  mode: 'workspace-write',
  filesystem: {
    allowWrite: ['**'],
    denyWrite: [
      '.git/**',
      'node_modules/**',
      '.env',
      '.env.*',
      '**/*.key',
      '**/*.pem',
    ],
    allowRead: ['**'],
    denyRead: ['.env', '.env.*', '**/*.key', '**/*.pem'],
  },
  network: {
    allowExternalNetwork: false,
    allowedDomains: [],
    blockedDomains: [],
  },
};

/**
 * Default bash safety configuration.
 *
 * Blocked patterns adapted from CCB bashSecurity.ts (critical subset).
 */
export const DEFAULT_BASH_SAFETY_CONFIG: BashSafetyConfig = {
  enabled: true,
  blockedPatterns: [
    'rm -rf /',
    'rm -rf /*',
    'rm -rf ~',
    'rm -rf ~/*',
    ':(){:|:&};:',           // fork bomb
    'mkfs',
    'dd if=',
    '> /dev/sd',
    'chmod -R 777 /',
    'curl * | sh',
    'curl * | bash',
    'wget * | sh',
    'wget * | bash',
  ],
  safeCommands: [
    'ls', 'cat', 'echo', 'pwd', 'whoami', 'date', 'head', 'tail',
    'wc', 'sort', 'uniq', 'grep', 'find', 'which', 'type',
    'git status', 'git log', 'git diff', 'git branch',
  ],
  blockSubstitution: false,
};

/** Default security policy. */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  defaultMode: 'default',
  managedRulesOnly: false,
  allowRules: [],
  denyRules: [],
  sandbox: DEFAULT_SANDBOX_CONFIG,
  hooks: [],
  bash: DEFAULT_BASH_SAFETY_CONFIG,
};
