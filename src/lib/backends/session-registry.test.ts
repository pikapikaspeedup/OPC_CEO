import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAgentSessions,
  getAgentSession,
  listAgentSessions,
  markAgentSessionCancelRequested,
  markAgentSessionTerminalSeen,
  registerAgentSession,
  removeAgentSession,
} from './session-registry';
import type { AgentBackendCapabilities, AgentEvent, AgentSession } from './types';

const capabilities: AgentBackendCapabilities = {
  supportsAppend: true,
  supportsCancel: true,
  emitsLiveState: true,
  emitsRawSteps: false,
  emitsStreamingText: false,
};

function makeSession(runId: string, handle: string): AgentSession {
  return {
    runId,
    providerId: 'codex',
    handle,
    capabilities,
    async *events(): AsyncIterable<AgentEvent> {
      yield {
        kind: 'started',
        runId,
        providerId: 'codex',
        handle,
        startedAt: '2026-04-08T00:00:00.000Z',
      };
    },
    append: async () => undefined,
    cancel: async () => undefined,
  };
}

describe('agent-session registry', () => {
  beforeEach(() => {
    clearAgentSessions();
  });

  it('registers and returns active sessions by run id', () => {
    const record = registerAgentSession(makeSession('run-1', 'codex-run-1'));

    expect(record.cancelRequested).toBe(false);
    expect(record.terminalSeen).toBe(false);
    expect(getAgentSession('run-1')).toEqual(record);
    expect(listAgentSessions()).toHaveLength(1);
  });

  it('marks cancelRequested and terminalSeen flags in place', () => {
    registerAgentSession(makeSession('run-1', 'codex-run-1'));

    expect(markAgentSessionCancelRequested('run-1')?.cancelRequested).toBe(true);
    expect(markAgentSessionTerminalSeen('run-1')?.terminalSeen).toBe(true);
    expect(getAgentSession('run-1')).toEqual(expect.objectContaining({
      cancelRequested: true,
      terminalSeen: true,
    }));
  });

  it('replaces an existing run id when a new session is registered', () => {
    registerAgentSession(makeSession('run-1', 'codex-run-1'));
    const replacement = registerAgentSession(makeSession('run-1', 'codex-run-2'));

    expect(getAgentSession('run-1')).toEqual(replacement);
    expect(getAgentSession('run-1')?.handle).toBe('codex-run-2');
  });

  it('removes active sessions cleanly', () => {
    registerAgentSession(makeSession('run-1', 'codex-run-1'));

    expect(removeAgentSession('run-1')).toBe(true);
    expect(getAgentSession('run-1')).toBeNull();
  });
});