/**
 * Resource Policy — cost & quota constraint system for controlling
 * resource consumption across workspaces, templates, and projects.
 *
 * Policies are evaluated pre-dispatch (before a run is created).
 * They are declarative rules — no custom code execution.
 */

// ── Policy Types ────────────────────────────────────────────────────────────

export type PolicyScope = 'workspace' | 'template' | 'project';
export type PolicyResource = 'runs' | 'branches' | 'iterations' | 'stages' | 'concurrent-runs';
export type PolicyAction = 'warn' | 'block' | 'pause';

export interface PolicyRule {
  /** Resource type to constrain */
  resource: PolicyResource;
  /** Maximum allowed value */
  limit: number;
  /** Action when limit is exceeded */
  action: PolicyAction;
  /** Optional human-readable description */
  description?: string;
}

export interface ResourcePolicy {
  /** Unique policy ID */
  id: string;
  /** Asset kind discriminator */
  kind: 'resource-policy';
  /** Human-readable name */
  name: string;
  /** Scope this policy applies to */
  scope: PolicyScope;
  /** Scope target ID (workspace URI, templateId, or projectId) */
  targetId: string;
  /** Policy rules */
  rules: PolicyRule[];
  /** Whether this policy is active (default true) */
  enabled?: boolean;
}

// ── Usage Counters ──────────────────────────────────────────────────────────

export interface ResourceUsage {
  /** Total runs dispatched */
  runs: number;
  /** Total fan-out branches created */
  branches: number;
  /** Total loop iterations executed */
  iterations: number;
  /** Total pipeline stages completed */
  stages: number;
  /** Currently running (not completed/failed) runs */
  concurrentRuns: number;
}

// ── Evaluation Result ───────────────────────────────────────────────────────

export interface PolicyViolation {
  /** The policy that was violated */
  policyId: string;
  /** The rule that was triggered */
  rule: PolicyRule;
  /** Current usage value */
  currentValue: number;
  /** Action to take */
  action: PolicyAction;
  /** Human-readable message */
  message: string;
}

export interface PolicyEvalResult {
  /** Whether dispatch is allowed */
  allowed: boolean;
  /** List of violations (may include warnings even if allowed) */
  violations: PolicyViolation[];
}
