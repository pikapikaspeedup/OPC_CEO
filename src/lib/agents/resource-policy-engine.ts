/**
 * Resource Policy Engine — evaluates resource policies against current usage.
 *
 * Policies are checked pre-dispatch. The engine is stateless:
 * callers provide both the policies and the current usage counters.
 */

import type {
  ResourcePolicy,
  ResourceUsage,
  PolicyEvalResult,
  PolicyViolation,
  PolicyResource,
} from './resource-policy-types';

// ── Policy Evaluation ───────────────────────────────────────────────────────

/**
 * Evaluate all applicable policies against current resource usage.
 *
 * @param policies - Active policies to evaluate
 * @param usage - Current resource counters
 * @returns Result indicating whether dispatch is allowed, with any violations
 */
export function evaluatePolicies(
  policies: ResourcePolicy[],
  usage: ResourceUsage,
): PolicyEvalResult {
  const violations: PolicyViolation[] = [];

  for (const policy of policies) {
    if (policy.enabled === false) continue;

    for (const rule of policy.rules) {
      const currentValue = getUsageValue(usage, rule.resource);

      if (currentValue >= rule.limit) {
        violations.push({
          policyId: policy.id,
          rule,
          currentValue,
          action: rule.action,
          message: buildMessage(policy, rule, currentValue),
        });
      }
    }
  }

  // Sort: block first, then pause, then warn
  violations.sort((a, b) => actionPriority(a.action) - actionPriority(b.action));

  const hasBlock = violations.some(v => v.action === 'block');
  const hasPause = violations.some(v => v.action === 'pause');

  return {
    allowed: !hasBlock && !hasPause,
    violations,
  };
}

/**
 * Find applicable policies for a given dispatch context.
 * Matches policies by scope and targetId.
 */
export function findApplicablePolicies(
  allPolicies: ResourcePolicy[],
  context: { workspaceUri?: string; templateId?: string; projectId?: string },
): ResourcePolicy[] {
  return allPolicies.filter(p => {
    if (p.enabled === false) return false;
    switch (p.scope) {
      case 'workspace':
        return context.workspaceUri === p.targetId;
      case 'template':
        return context.templateId === p.targetId;
      case 'project':
        return context.projectId === p.targetId;
      default:
        return false;
    }
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getUsageValue(usage: ResourceUsage, resource: PolicyResource): number {
  switch (resource) {
    case 'runs': return usage.runs;
    case 'branches': return usage.branches;
    case 'iterations': return usage.iterations;
    case 'stages': return usage.stages;
    case 'concurrent-runs': return usage.concurrentRuns;
    default: return 0;
  }
}

function actionPriority(action: string): number {
  switch (action) {
    case 'block': return 0;
    case 'pause': return 1;
    case 'warn': return 2;
    default: return 3;
  }
}

function buildMessage(
  policy: ResourcePolicy,
  rule: typeof policy.rules[number],
  currentValue: number,
): string {
  const desc = rule.description
    ? ` (${rule.description})`
    : '';
  return `Policy '${policy.name}': ${rule.resource} usage ${currentValue} exceeds limit ${rule.limit}${desc}`;
}
