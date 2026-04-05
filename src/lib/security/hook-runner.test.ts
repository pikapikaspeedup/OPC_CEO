import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerHook,
  unregisterHook,
  getHooksForEvent,
  clearHooks,
  executeHooks,
} from './hook-runner';
import type { HookDefinition, HookInput, HookOutput } from './types';

beforeEach(() => {
  clearHooks();
});

describe('hook registry', () => {
  it('registers and retrieves hooks by event', () => {
    const hook: HookDefinition = {
      id: 'test-hook',
      event: 'PreToolUse',
      type: 'function',
      source: 'organization',
      handler: async () => ({ continue: true }),
    };
    registerHook(hook);
    expect(getHooksForEvent('PreToolUse')).toHaveLength(1);
    expect(getHooksForEvent('PostToolUse')).toHaveLength(0);
  });

  it('replaces hook with same id', () => {
    registerHook({ id: 'h1', event: 'PreToolUse', type: 'function', source: 'organization', handler: async () => ({ continue: true }) });
    registerHook({ id: 'h1', event: 'PreToolUse', type: 'function', source: 'organization', handler: async () => ({ continue: false }) });
    expect(getHooksForEvent('PreToolUse')).toHaveLength(1);
  });

  it('unregisters hook', () => {
    registerHook({ id: 'h1', event: 'PreToolUse', type: 'function', source: 'organization', handler: async () => ({ continue: true }) });
    expect(unregisterHook('h1')).toBe(true);
    expect(getHooksForEvent('PreToolUse')).toHaveLength(0);
  });

  it('unregister returns false for unknown hook', () => {
    expect(unregisterHook('nonexistent')).toBe(false);
  });

  it('skips disabled hooks', () => {
    registerHook({ id: 'h1', event: 'PreToolUse', type: 'function', source: 'organization', handler: async () => ({ continue: true }), enabled: false });
    expect(getHooksForEvent('PreToolUse')).toHaveLength(0);
  });

  it('throws on invalid registration', () => {
    expect(() => registerHook({ id: '', event: 'PreToolUse', type: 'function' } as any)).toThrow();
    expect(() => registerHook({ id: 'h1', event: 'PreToolUse', type: 'function' } as any)).toThrow(/handler/);
    expect(() => registerHook({ id: 'h1', event: 'PreToolUse', type: 'command' } as any)).toThrow(/command/);
  });
});

describe('executeHooks', () => {
  it('returns continue:true when no hooks registered', async () => {
    const result = await executeHooks('PreToolUse', { event: 'PreToolUse' });
    expect(result.continue).toBe(true);
  });

  it('executes hooks in order', async () => {
    const order: number[] = [];
    registerHook({ id: 'h1', event: 'PreToolUse', type: 'function', source: 'organization', handler: async () => { order.push(1); return { continue: true }; } });
    registerHook({ id: 'h2', event: 'PreToolUse', type: 'function', source: 'organization', handler: async () => { order.push(2); return { continue: true }; } });
    await executeHooks('PreToolUse', { event: 'PreToolUse' });
    expect(order).toEqual([1, 2]);
  });

  it('stops on continue:false', async () => {
    const order: number[] = [];
    registerHook({ id: 'h1', event: 'PreToolUse', type: 'function', source: 'organization', handler: async () => { order.push(1); return { continue: false, stopReason: 'stop here' }; } });
    registerHook({ id: 'h2', event: 'PreToolUse', type: 'function', source: 'organization', handler: async () => { order.push(2); return { continue: true }; } });
    const result = await executeHooks('PreToolUse', { event: 'PreToolUse' });
    expect(order).toEqual([1]);
    expect(result.continue).toBe(false);
    expect(result.stopReason).toBe('stop here');
  });

  it('merges hook decisions', async () => {
    registerHook({ id: 'h1', event: 'PreToolUse', type: 'function', source: 'organization', handler: async () => ({ decision: 'approve', reason: 'looks good' }) });
    const result = await executeHooks('PreToolUse', { event: 'PreToolUse' });
    expect(result.decision).toBe('approve');
    expect(result.reason).toBe('looks good');
  });

  it('aggregates updatedInput across hooks', async () => {
    registerHook({ id: 'h1', event: 'PreToolUse', type: 'function', source: 'organization', handler: async () => ({ updatedInput: { a: 1 } }) });
    registerHook({ id: 'h2', event: 'PreToolUse', type: 'function', source: 'organization', handler: async () => ({ updatedInput: { b: 2 } }) });
    const result = await executeHooks('PreToolUse', { event: 'PreToolUse' });
    expect(result.updatedInput).toEqual({ a: 1, b: 2 });
  });

  it('concatenates additionalContext', async () => {
    registerHook({ id: 'h1', event: 'PreToolUse', type: 'function', source: 'organization', handler: async () => ({ additionalContext: 'ctx1' }) });
    registerHook({ id: 'h2', event: 'PreToolUse', type: 'function', source: 'organization', handler: async () => ({ additionalContext: 'ctx2' }) });
    const result = await executeHooks('PreToolUse', { event: 'PreToolUse' });
    expect(result.additionalContext).toBe('ctx1\nctx2');
  });

  it('handles hook error gracefully (fail-open)', async () => {
    registerHook({ id: 'h1', event: 'PreToolUse', type: 'function', source: 'organization', handler: async () => { throw new Error('boom'); } });
    registerHook({ id: 'h2', event: 'PreToolUse', type: 'function', source: 'organization', handler: async () => ({ decision: 'approve' }) });
    const result = await executeHooks('PreToolUse', { event: 'PreToolUse' });
    // Should still reach h2 despite h1 throwing
    expect(result.decision).toBe('approve');
  });

  it('handles timeout', async () => {
    registerHook({
      id: 'slow',
      event: 'PreToolUse',
      type: 'function',
      source: 'organization',
      timeout: 50,
      handler: async () => {
        await new Promise(r => setTimeout(r, 200));
        return { decision: 'approve' };
      },
    });
    // Should not hang — timeout kicks in and error is caught gracefully
    const result = await executeHooks('PreToolUse', { event: 'PreToolUse' });
    expect(result.continue).toBe(true); // fail-open
  });
});
