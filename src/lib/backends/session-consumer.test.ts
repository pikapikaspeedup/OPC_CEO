import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAgentSessions,
  getAgentSession,
  markAgentSessionCancelRequested,
  markAgentSessionTerminalSeen,
  registerAgentSession,
} from './session-registry';
import { consumeAgentSession } from './session-consumer';
import type { AgentBackendCapabilities, AgentEvent, AgentSession } from './types';

const capabilities: AgentBackendCapabilities = {
  supportsAppend: true,
  supportsCancel: true,
  emitsLiveState: true,
  emitsRawSteps: false,
  emitsStreamingText: false,
};

function makeSession(runId: string, events: AgentEvent[]): AgentSession {
  return {
    runId,
    providerId: 'codex',
    handle: `codex-${runId}`,
    capabilities,
    async *events(): AsyncIterable<AgentEvent> {
      for (const event of events) {
        yield event;
      }
    },
    append: async () => undefined,
    cancel: async () => undefined,
  };
}

describe('session-consumer', () => {
  beforeEach(() => {
    clearAgentSessions();
  });

  it('consumes events in order and releases the session on terminal completion', async () => {
    const session = makeSession('run-1', [
      {
        kind: 'started',
        runId: 'run-1',
        providerId: 'codex',
        handle: 'codex-run-1',
        startedAt: '2026-04-08T00:00:00.000Z',
      },
      {
        kind: 'live_state',
        runId: 'run-1',
        providerId: 'codex',
        handle: 'codex-run-1',
        liveState: {
          cascadeStatus: 'running',
          stepCount: 2,
          lastStepAt: '2026-04-08T00:00:02.000Z',
          lastStepType: 'PLANNER_RESPONSE',
        },
      },
      {
        kind: 'completed',
        runId: 'run-1',
        providerId: 'codex',
        handle: 'codex-run-1',
        finishedAt: '2026-04-08T00:00:03.000Z',
        result: {
          status: 'completed',
          summary: 'done',
          changedFiles: [],
          blockers: [],
          needsReview: [],
        },
      },
    ]);

    registerAgentSession(session);
    const hooks = {
      onStarted: vi.fn(),
      onLiveState: vi.fn(),
      onCompleted: vi.fn(),
    };

    const result = await consumeAgentSession('run-1', session, hooks);

    expect(result.processedKinds).toEqual(['started', 'live_state', 'completed']);
    expect(result.terminalEvent?.kind).toBe('completed');
    expect(hooks.onStarted).toHaveBeenCalledTimes(1);
    expect(hooks.onLiveState).toHaveBeenCalledTimes(1);
    expect(hooks.onCompleted).toHaveBeenCalledTimes(1);
    expect(getAgentSession('run-1')).toBeNull();
  });

  it('suppresses late completion after local cancel has been requested', async () => {
    const session = makeSession('run-2', [
      {
        kind: 'started',
        runId: 'run-2',
        providerId: 'codex',
        handle: 'codex-run-2',
        startedAt: '2026-04-08T00:00:00.000Z',
      },
      {
        kind: 'completed',
        runId: 'run-2',
        providerId: 'codex',
        handle: 'codex-run-2',
        finishedAt: '2026-04-08T00:00:03.000Z',
        result: {
          status: 'completed',
          summary: 'late',
          changedFiles: [],
          blockers: [],
          needsReview: [],
        },
      },
    ]);

    registerAgentSession(session);
    const hooks = {
      onStarted: vi.fn(() => {
        markAgentSessionCancelRequested('run-2');
      }),
      onCompleted: vi.fn(),
    };

    const result = await consumeAgentSession('run-2', session, hooks, { releaseOnTerminal: false });

    expect(result.processedKinds).toEqual(['started']);
    expect(result.ignoredEventCount).toBe(1);
    expect(result.terminalEvent).toBeNull();
    expect(hooks.onCompleted).not.toHaveBeenCalled();
    expect(getAgentSession('run-2')).toEqual(expect.objectContaining({ cancelRequested: true }));
  });

  it('ignores all events once terminalSeen has already been marked', async () => {
    const session = makeSession('run-3', [
      {
        kind: 'started',
        runId: 'run-3',
        providerId: 'codex',
        handle: 'codex-run-3',
        startedAt: '2026-04-08T00:00:00.000Z',
      },
      {
        kind: 'completed',
        runId: 'run-3',
        providerId: 'codex',
        handle: 'codex-run-3',
        finishedAt: '2026-04-08T00:00:01.000Z',
        result: {
          status: 'completed',
          summary: 'done',
          changedFiles: [],
          blockers: [],
          needsReview: [],
        },
      },
    ]);

    registerAgentSession(session);
    markAgentSessionTerminalSeen('run-3');
    const hooks = {
      onStarted: vi.fn(),
      onCompleted: vi.fn(),
    };

    const result = await consumeAgentSession('run-3', session, hooks, { releaseOnTerminal: false });

    expect(result.processedKinds).toEqual([]);
    expect(result.ignoredEventCount).toBe(2);
    expect(hooks.onStarted).not.toHaveBeenCalled();
    expect(hooks.onCompleted).not.toHaveBeenCalled();
  });
});