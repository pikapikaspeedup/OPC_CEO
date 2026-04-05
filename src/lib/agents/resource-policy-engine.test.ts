/**
 * Tests for V5.4 Resource Policy Engine
 * - Policy evaluation against usage counters
 * - Policy matching by scope and targetId
 * - Violation sorting (block > pause > warn)
 */

import { describe, it, expect } from 'vitest';
import { evaluatePolicies, findApplicablePolicies } from './resource-policy-engine';
import type { ResourcePolicy, ResourceUsage } from './resource-policy-types';

// ── Test Helpers ────────────────────────────────────────────────────────────

function makeUsage(overrides?: Partial<ResourceUsage>): ResourceUsage {
  return {
    runs: 0,
    branches: 0,
    iterations: 0,
    stages: 0,
    concurrentRuns: 0,
    ...overrides,
  };
}

function makePolicy(overrides?: Partial<ResourcePolicy>): ResourcePolicy {
  return {
    id: 'pol-1',
    kind: 'resource-policy',
    name: 'Test Policy',
    scope: 'project',
    targetId: 'proj-1',
    rules: [],
    ...overrides,
  };
}

// ── Evaluation Tests ────────────────────────────────────────────────────────

describe('evaluatePolicies', () => {
  it('returns allowed=true when no policies', () => {
    const result = evaluatePolicies([], makeUsage());
    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('returns allowed=true when usage is under all limits', () => {
    const policy = makePolicy({
      rules: [{ resource: 'runs', limit: 10, action: 'block' }],
    });
    const result = evaluatePolicies([policy], makeUsage({ runs: 5 }));
    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('returns allowed=false when block limit is exceeded', () => {
    const policy = makePolicy({
      rules: [{ resource: 'runs', limit: 10, action: 'block' }],
    });
    const result = evaluatePolicies([policy], makeUsage({ runs: 10 }));
    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].action).toBe('block');
    expect(result.violations[0].currentValue).toBe(10);
  });

  it('returns allowed=false when pause limit is exceeded', () => {
    const policy = makePolicy({
      rules: [{ resource: 'concurrent-runs', limit: 3, action: 'pause' }],
    });
    const result = evaluatePolicies([policy], makeUsage({ concurrentRuns: 5 }));
    expect(result.allowed).toBe(false);
    expect(result.violations[0].action).toBe('pause');
  });

  it('returns allowed=true for warnings (warn does not block)', () => {
    const policy = makePolicy({
      rules: [{ resource: 'branches', limit: 20, action: 'warn' }],
    });
    const result = evaluatePolicies([policy], makeUsage({ branches: 25 }));
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].action).toBe('warn');
  });

  it('evaluates multiple rules across multiple policies', () => {
    const p1 = makePolicy({
      id: 'p1', name: 'Run Limit',
      rules: [{ resource: 'runs', limit: 50, action: 'block' }],
    });
    const p2 = makePolicy({
      id: 'p2', name: 'Branch Warning',
      rules: [{ resource: 'branches', limit: 10, action: 'warn' }],
    });
    const result = evaluatePolicies([p1, p2], makeUsage({ runs: 60, branches: 15 }));
    expect(result.allowed).toBe(false);  // Blocked by p1
    expect(result.violations).toHaveLength(2);
    // block should sort before warn
    expect(result.violations[0].action).toBe('block');
    expect(result.violations[1].action).toBe('warn');
  });

  it('skips disabled policies', () => {
    const policy = makePolicy({
      enabled: false,
      rules: [{ resource: 'runs', limit: 1, action: 'block' }],
    });
    const result = evaluatePolicies([policy], makeUsage({ runs: 100 }));
    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('checks all resource types', () => {
    const policy = makePolicy({
      rules: [
        { resource: 'runs', limit: 5, action: 'warn' },
        { resource: 'branches', limit: 3, action: 'warn' },
        { resource: 'iterations', limit: 10, action: 'warn' },
        { resource: 'stages', limit: 8, action: 'warn' },
        { resource: 'concurrent-runs', limit: 2, action: 'warn' },
      ],
    });
    const usage = makeUsage({
      runs: 10, branches: 5, iterations: 15, stages: 12, concurrentRuns: 4,
    });
    const result = evaluatePolicies([policy], usage);
    expect(result.violations).toHaveLength(5);
  });

  it('treats exactly-at-limit as a violation', () => {
    const policy = makePolicy({
      rules: [{ resource: 'stages', limit: 5, action: 'block' }],
    });
    const result = evaluatePolicies([policy], makeUsage({ stages: 5 }));
    expect(result.allowed).toBe(false);
  });

  it('includes rule description in violation message', () => {
    const policy = makePolicy({
      name: 'Budget',
      rules: [{ resource: 'runs', limit: 10, action: 'block', description: 'Max runs per project' }],
    });
    const result = evaluatePolicies([policy], makeUsage({ runs: 11 }));
    expect(result.violations[0].message).toContain('Max runs per project');
    expect(result.violations[0].message).toContain('Budget');
  });

  it('sorts violations: block > pause > warn', () => {
    const policy = makePolicy({
      rules: [
        { resource: 'branches', limit: 1, action: 'warn' },
        { resource: 'iterations', limit: 1, action: 'pause' },
        { resource: 'runs', limit: 1, action: 'block' },
      ],
    });
    const usage = makeUsage({ runs: 5, branches: 5, iterations: 5 });
    const result = evaluatePolicies([policy], usage);
    expect(result.violations.map(v => v.action)).toEqual(['block', 'pause', 'warn']);
  });
});

// ── Policy Matching Tests ───────────────────────────────────────────────────

describe('findApplicablePolicies', () => {
  it('matches workspace-scoped policy', () => {
    const policy = makePolicy({ scope: 'workspace', targetId: '/path/to/ws' });
    const found = findApplicablePolicies([policy], { workspaceUri: '/path/to/ws' });
    expect(found).toHaveLength(1);
  });

  it('matches template-scoped policy', () => {
    const policy = makePolicy({ scope: 'template', targetId: 'tmpl-1' });
    const found = findApplicablePolicies([policy], { templateId: 'tmpl-1' });
    expect(found).toHaveLength(1);
  });

  it('matches project-scoped policy', () => {
    const policy = makePolicy({ scope: 'project', targetId: 'proj-1' });
    const found = findApplicablePolicies([policy], { projectId: 'proj-1' });
    expect(found).toHaveLength(1);
  });

  it('returns empty for non-matching context', () => {
    const policy = makePolicy({ scope: 'project', targetId: 'proj-1' });
    const found = findApplicablePolicies([policy], { projectId: 'proj-2' });
    expect(found).toEqual([]);
  });

  it('excludes disabled policies', () => {
    const policy = makePolicy({ enabled: false, scope: 'project', targetId: 'proj-1' });
    const found = findApplicablePolicies([policy], { projectId: 'proj-1' });
    expect(found).toEqual([]);
  });

  it('returns multiple matching policies', () => {
    const p1 = makePolicy({ id: 'p1', scope: 'project', targetId: 'proj-1' });
    const p2 = makePolicy({ id: 'p2', scope: 'workspace', targetId: '/ws' });
    const p3 = makePolicy({ id: 'p3', scope: 'template', targetId: 'tmpl-x' });
    const found = findApplicablePolicies([p1, p2, p3], {
      projectId: 'proj-1',
      workspaceUri: '/ws',
      templateId: 'tmpl-other',
    });
    // Should match p1 (project) and p2 (workspace), not p3 (template doesn't match)
    expect(found.map(p => p.id)).toEqual(['p1', 'p2']);
  });
});
