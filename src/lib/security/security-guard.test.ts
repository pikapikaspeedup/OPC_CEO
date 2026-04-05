import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkToolSafety } from './security-guard';
import { clearHooks, registerHook } from './hook-runner';
import { buildRule } from './permission-engine';
import type { ToolExecutionContext } from './types';
import { DEFAULT_SANDBOX_CONFIG } from './types';

const WORKSPACE = '/workspace/project';

function makeContext(overrides?: Partial<ToolExecutionContext>): ToolExecutionContext {
  return {
    workspace: WORKSPACE,
    rules: [],
    sandbox: DEFAULT_SANDBOX_CONFIG,
    mode: 'permissive',
    ...overrides,
  };
}

beforeEach(() => {
  clearHooks();
});

describe('checkToolSafety', () => {
  // Layer 1: Bash safety
  it('blocks dangerous bash commands', async () => {
    const result = await checkToolSafety('Bash', { command: 'rm -rf /' }, makeContext());
    expect(result.allowed).toBe(false);
    expect(result.details.bashSafety?.level).toBe('blocked');
  });

  it('allows safe bash commands', async () => {
    const result = await checkToolSafety('Bash', { command: 'ls -la' }, makeContext());
    expect(result.allowed).toBe(true);
  });

  // Layer 2: Permission rules
  it('blocks denied tools', async () => {
    const ctx = makeContext({
      mode: 'default',
      rules: [buildRule('deny', 'Bash', 'organization')],
    });
    const result = await checkToolSafety('Bash', { command: 'echo hello' }, ctx);
    expect(result.allowed).toBe(false);
    expect(result.details.permission?.behavior).toBe('deny');
  });

  it('allows explicitly allowed tools in default mode', async () => {
    const ctx = makeContext({
      mode: 'default',
      rules: [buildRule('allow', 'Bash(git:*)', 'organization')],
    });
    const result = await checkToolSafety('Bash', { command: 'git status' }, ctx);
    expect(result.allowed).toBe(true);
  });

  it('blocks unknown tools in default mode (ask → deny in OPC)', async () => {
    const ctx = makeContext({ mode: 'default', rules: [] });
    const result = await checkToolSafety('UnknownTool', {}, ctx);
    expect(result.allowed).toBe(false); // 'ask' treated as deny in automated context
  });

  // Layer 3: Hooks
  it('blocks when hook says block', async () => {
    registerHook({
      id: 'blocker',
      event: 'PreToolUse',
      type: 'function',
      source: 'organization',
      handler: async () => ({ decision: 'block', reason: 'not today' }),
    });
    const result = await checkToolSafety('Bash', { command: 'echo hello' }, makeContext());
    expect(result.allowed).toBe(false);
    expect(result.details.hookDecision).toBe('block');
  });

  it('passes modified input from hooks', async () => {
    registerHook({
      id: 'modifier',
      event: 'PreToolUse',
      type: 'function',
      source: 'organization',
      handler: async () => ({ decision: 'approve', updatedInput: { command: 'echo sanitized' } }),
    });
    const result = await checkToolSafety('Bash', { command: 'echo hello' }, makeContext());
    expect(result.allowed).toBe(true);
    expect(result.updatedInput).toEqual({ command: 'echo sanitized' });
  });

  // Layer 4: Sandbox
  it('blocks file writes outside workspace', async () => {
    const result = await checkToolSafety('FileEdit', { path: '/etc/passwd' }, makeContext());
    expect(result.allowed).toBe(false);
    expect(result.details.sandboxCheck?.allowed).toBe(false);
  });

  it('blocks file writes to .git', async () => {
    const result = await checkToolSafety('FileEdit', { path: WORKSPACE + '/.git/config' }, makeContext());
    expect(result.allowed).toBe(false);
  });

  it('allows file writes within workspace', async () => {
    const result = await checkToolSafety('FileEdit', { path: WORKSPACE + '/src/foo.ts' }, makeContext());
    expect(result.allowed).toBe(true);
  });

  // Integration: all layers work together
  it('bash safety blocks before permission check', async () => {
    const ctx = makeContext({
      rules: [buildRule('allow', '*', 'organization')], // allow everything
    });
    const result = await checkToolSafety('Bash', { command: 'rm -rf /' }, ctx);
    expect(result.allowed).toBe(false); // bash safety still blocks
  });
});
