import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkPermission,
  evaluateRules,
  applyModeOverlay,
  ruleMatchesTool,
  parseRuleString,
  formatRuleString,
  buildRule,
} from './permission-engine';
import type { PermissionRule } from './types';

// ---------------------------------------------------------------------------
// ruleMatchesTool
// ---------------------------------------------------------------------------

describe('ruleMatchesTool', () => {
  it('wildcard * matches any tool', () => {
    expect(ruleMatchesTool({ toolName: '*' }, 'Bash')).toBe(true);
    expect(ruleMatchesTool({ toolName: '*' }, 'FileEdit')).toBe(true);
  });

  it('exact tool name matches', () => {
    expect(ruleMatchesTool({ toolName: 'Bash' }, 'Bash')).toBe(true);
    expect(ruleMatchesTool({ toolName: 'Bash' }, 'FileEdit')).toBe(false);
  });

  it('tool name without content matches all invocations', () => {
    expect(ruleMatchesTool({ toolName: 'Bash' }, 'Bash', { command: 'rm -rf' })).toBe(true);
  });

  it('Bash command prefix pattern: git:*', () => {
    expect(ruleMatchesTool({ toolName: 'Bash', ruleContent: 'git:*' }, 'Bash', { command: 'git status' })).toBe(true);
    expect(ruleMatchesTool({ toolName: 'Bash', ruleContent: 'git:*' }, 'Bash', { command: 'npm install' })).toBe(false);
  });

  it('path glob pattern: src/**', () => {
    expect(ruleMatchesTool({ toolName: 'FileEdit', ruleContent: 'src/**' }, 'FileEdit', { path: 'src/foo/bar.ts' })).toBe(true);
    expect(ruleMatchesTool({ toolName: 'FileEdit', ruleContent: 'src/**' }, 'FileEdit', { path: 'dist/out.js' })).toBe(false);
  });

  it('domain pattern: domain:github.com', () => {
    expect(ruleMatchesTool(
      { toolName: 'WebFetch', ruleContent: 'domain:github.com' },
      'WebFetch',
      { url: 'https://github.com/foo/bar' },
    )).toBe(true);
    expect(ruleMatchesTool(
      { toolName: 'WebFetch', ruleContent: 'domain:github.com' },
      'WebFetch',
      { url: 'https://evil.com/phish' },
    )).toBe(false);
  });

  it('domain pattern matches subdomains', () => {
    expect(ruleMatchesTool(
      { toolName: 'WebFetch', ruleContent: 'domain:github.com' },
      'WebFetch',
      { url: 'https://api.github.com/repos' },
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseRuleString / formatRuleString
// ---------------------------------------------------------------------------

describe('parseRuleString', () => {
  it('parses simple tool name', () => {
    expect(parseRuleString('Bash')).toEqual({ toolName: 'Bash' });
  });

  it('parses tool name with content', () => {
    expect(parseRuleString('Bash(git:*)')).toEqual({ toolName: 'Bash', ruleContent: 'git:*' });
  });

  it('parses wildcard', () => {
    expect(parseRuleString('*')).toEqual({ toolName: '*' });
  });

  it('roundtrips with formatRuleString', () => {
    const value = parseRuleString('FileEdit(src/**)');
    expect(formatRuleString(value)).toBe('FileEdit(src/**)');
  });
});

// ---------------------------------------------------------------------------
// evaluateRules
// ---------------------------------------------------------------------------

describe('evaluateRules', () => {
  it('returns null when no rules match', () => {
    const rules: PermissionRule[] = [
      buildRule('allow', 'FileEdit', 'organization'),
    ];
    expect(evaluateRules(rules, 'Bash')).toBeNull();
  });

  it('deny wins over allow', () => {
    const rules: PermissionRule[] = [
      buildRule('allow', 'Bash', 'organization'),
      buildRule('deny', 'Bash', 'department'),
    ];
    const result = evaluateRules(rules, 'Bash');
    expect(result?.behavior).toBe('deny');
  });

  it('deny wins over ask', () => {
    const rules: PermissionRule[] = [
      buildRule('ask', 'Bash', 'organization'),
      buildRule('deny', 'Bash(rm:*)', 'department'),
    ];
    const result = evaluateRules(rules, 'Bash', { command: 'rm -rf node_modules' });
    expect(result?.behavior).toBe('deny');
  });

  it('ask takes precedence over allow', () => {
    const rules: PermissionRule[] = [
      buildRule('allow', 'Bash', 'organization'),
      buildRule('ask', 'Bash', 'department'),
    ];
    const result = evaluateRules(rules, 'Bash');
    expect(result?.behavior).toBe('ask');
  });

  it('returns allow when only allow rules match', () => {
    const rules: PermissionRule[] = [
      buildRule('allow', 'Bash(git:*)', 'organization'),
    ];
    const result = evaluateRules(rules, 'Bash', { command: 'git status' });
    expect(result?.behavior).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// applyModeOverlay
// ---------------------------------------------------------------------------

describe('applyModeOverlay', () => {
  it('bypass mode allows everything', () => {
    const result = applyModeOverlay(null, 'bypass');
    expect(result.behavior).toBe('allow');
  });

  it('strict mode denies when no rule matches', () => {
    const result = applyModeOverlay(null, 'strict');
    expect(result.behavior).toBe('deny');
  });

  it('strict mode converts ask to deny', () => {
    const askResult = { behavior: 'ask' as const, reason: { type: 'rule' as const, rule: buildRule('ask', 'Bash', 'organization') }, message: 'test' };
    const result = applyModeOverlay(askResult, 'strict');
    expect(result.behavior).toBe('deny');
  });

  it('permissive mode allows when no rule matches', () => {
    const result = applyModeOverlay(null, 'permissive');
    expect(result.behavior).toBe('allow');
  });

  it('default mode asks when no rule matches', () => {
    const result = applyModeOverlay(null, 'default');
    expect(result.behavior).toBe('ask');
  });

  it('respects rule decision over mode (except bypass)', () => {
    const denyResult = { behavior: 'deny' as const, reason: { type: 'rule' as const, rule: buildRule('deny', 'Bash', 'organization') }, message: 'test' };
    expect(applyModeOverlay(denyResult, 'permissive').behavior).toBe('deny');
  });
});

// ---------------------------------------------------------------------------
// checkPermission (integrated)
// ---------------------------------------------------------------------------

describe('checkPermission', () => {
  it('allows explicitly allowed tools in default mode', () => {
    const rules = [buildRule('allow', 'Bash(git:*)', 'organization')];
    const result = checkPermission('Bash', { command: 'git status' }, rules, 'default');
    expect(result.behavior).toBe('allow');
  });

  it('denies explicitly denied tools', () => {
    const rules = [buildRule('deny', 'Bash(rm:*)', 'organization')];
    const result = checkPermission('Bash', { command: 'rm -rf /' }, rules, 'default');
    expect(result.behavior).toBe('deny');
  });

  it('asks for unknown tools in default mode', () => {
    const result = checkPermission('UnknownTool', {}, [], 'default');
    expect(result.behavior).toBe('ask');
  });

  it('allows everything in bypass mode', () => {
    const result = checkPermission('DangerousTool', {}, [], 'bypass');
    expect(result.behavior).toBe('allow');
  });

  it('denies everything not explicitly allowed in strict mode', () => {
    const result = checkPermission('SomeTool', {}, [], 'strict');
    expect(result.behavior).toBe('deny');
  });
});
