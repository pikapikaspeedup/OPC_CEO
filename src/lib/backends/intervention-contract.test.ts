/**
 * Phase 4: Intervention Contract tests for Claude Code backend.
 *
 * Tests:
 * 1. append() calls executor.appendMessage with --resume
 * 2. cancel() works on attached sessions
 * 3. capabilities.supportsAppend = true
 * 4. attach() creates non-running session that accepts append
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockClaudeCodeExecutor,
  mockGetExecutor,
} = vi.hoisted(() => {
  const executor = {
    executeTask: vi.fn(),
    appendMessage: vi.fn(),
    cancel: vi.fn(),
    capabilities: vi.fn().mockReturnValue({
      supportsMultiTurn: true,
      supportsStreaming: true,
      supportsStepWatch: false,
    }),
  };
  return {
    mockClaudeCodeExecutor: executor,
    mockGetExecutor: vi.fn((id: string) => {
      if (id === 'claude-code') return executor;
      throw new Error(`Unknown provider: ${id}`);
    }),
  };
});

vi.mock('../providers', () => ({
  getExecutor: (...args: [string]) => mockGetExecutor(...args),
  resolveProvider: vi.fn().mockReturnValue({ provider: 'claude-code' }),
}));

vi.mock('../bridge/gateway', () => ({
  getApiKey: vi.fn(),
  getOwnerConnection: vi.fn(),
  grpc: { addTrackedWorkspace: vi.fn(), startCascade: vi.fn(), sendMessage: vi.fn(), cancelCascade: vi.fn() },
  refreshOwnerMap: vi.fn(),
}));

import { LegacyClaudeCodeManualBackend } from './builtin-backends';
import type { BackendRunConfig, AgentEvent } from './types';

function makeConfig(runId: string): BackendRunConfig {
  return {
    runId,
    workspacePath: '/tmp/workspace',
    prompt: 'test task',
    model: 'claude-sonnet-4-20250514',
  };
}

async function collectEvents(session: { events(): AsyncIterable<AgentEvent> }): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.events()) {
    events.push(event);
  }
  return events;
}

describe('intervention-contract', () => {
  beforeEach(() => {
    mockClaudeCodeExecutor.executeTask.mockReset();
    mockClaudeCodeExecutor.appendMessage.mockReset();
    mockClaudeCodeExecutor.cancel.mockReset();
  });

  describe('capabilities', () => {
    it('reports supportsAppend = true despite stepWatch = false', () => {
      const backend = new LegacyClaudeCodeManualBackend();
      const caps = backend.capabilities();
      expect(caps.supportsAppend).toBe(true);
      expect(caps.supportsCancel).toBe(true);
    });
  });

  describe('append (nudge via --resume)', () => {
    it('calls executor.appendMessage with correct params', async () => {
      // Setup: start a session, then call append
      mockClaudeCodeExecutor.executeTask.mockImplementation(() => new Promise(() => {})); // never resolves
      mockClaudeCodeExecutor.appendMessage.mockResolvedValue({
        handle: 'session-1',
        content: 'Nudge response',
        steps: [],
        changedFiles: [],
        status: 'completed',
      });

      const backend = new LegacyClaudeCodeManualBackend();
      const session = await backend.start(makeConfig('run-nudge'));

      await session.append({
        prompt: 'Please complete the task',
        model: 'claude-sonnet-4-20250514',
        workspacePath: '/tmp/workspace',
      });

      expect(mockClaudeCodeExecutor.appendMessage).toHaveBeenCalledOnce();
      expect(mockClaudeCodeExecutor.appendMessage).toHaveBeenCalledWith(
        'claude-code-run-nudge',
        {
          prompt: 'Please complete the task',
          model: 'claude-sonnet-4-20250514',
          workspace: '/tmp/workspace',
          runId: 'run-nudge',
        },
      );

      // Clean up
      await session.cancel();
    });
  });

  describe('attach + append', () => {
    it('attaches to existing handle and allows append', async () => {
      mockClaudeCodeExecutor.appendMessage.mockResolvedValue({
        handle: 'existing-session-123',
        content: 'Resumed response',
        steps: [],
        changedFiles: [],
        status: 'completed',
      });

      const backend = new LegacyClaudeCodeManualBackend();
      const session = await backend.attach(makeConfig('run-attach'), 'existing-session-123');

      expect(session.handle).toBe('existing-session-123');

      await session.append({
        prompt: 'Follow up message',
        model: 'claude-sonnet-4-20250514',
        workspacePath: '/tmp/workspace',
      });

      expect(mockClaudeCodeExecutor.appendMessage).toHaveBeenCalledWith(
        'existing-session-123',
        {
          prompt: 'Follow up message',
          model: 'claude-sonnet-4-20250514',
          workspace: '/tmp/workspace',
          runId: 'run-attach',
        },
      );
    });

    it('attached session emits started event but does not execute', async () => {
      const backend = new LegacyClaudeCodeManualBackend();
      const session = await backend.attach(makeConfig('run-attach-2'), 'handle-xyz');

      // Should not call executeTask
      expect(mockClaudeCodeExecutor.executeTask).not.toHaveBeenCalled();

      // Cancel to close event channel
      await session.cancel();
      const events = await collectEvents(session);

      expect(events[0].kind).toBe('started');
      expect(events[events.length - 1].kind).toBe('cancelled');
    });
  });

  describe('cancel', () => {
    it('cancels running sessions via executor.cancel', async () => {
      mockClaudeCodeExecutor.executeTask.mockImplementation(() => new Promise(() => {}));
      mockClaudeCodeExecutor.cancel.mockResolvedValue(undefined);

      const backend = new LegacyClaudeCodeManualBackend();
      const session = await backend.start(makeConfig('run-cancel'));

      await session.cancel('test cancellation');

      expect(mockClaudeCodeExecutor.cancel).toHaveBeenCalledWith(
        expect.stringContaining('claude-code-'),
      );

      const events = await collectEvents(session);
      const cancelled = events.find(e => e.kind === 'cancelled');
      expect(cancelled).toBeDefined();
      if (cancelled && cancelled.kind === 'cancelled') {
        expect(cancelled.reason).toBe('test cancellation');
      }
    });

    it('cancel on already-cancelled session is idempotent', async () => {
      mockClaudeCodeExecutor.executeTask.mockImplementation(() => new Promise(() => {}));
      mockClaudeCodeExecutor.cancel.mockResolvedValue(undefined);

      const backend = new LegacyClaudeCodeManualBackend();
      const session = await backend.start(makeConfig('run-cancel-2'));

      await session.cancel();
      await session.cancel(); // Second cancel should not throw

      expect(mockClaudeCodeExecutor.cancel).toHaveBeenCalledTimes(1);
    });
  });
});
