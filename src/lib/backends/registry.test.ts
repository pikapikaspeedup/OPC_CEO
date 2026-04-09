import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAgentBackends,
  getAgentBackend,
  hasAgentBackend,
  listAgentBackends,
  registerAgentBackend,
} from './registry';
import type { AgentBackend, AgentBackendCapabilities, AgentEvent, AgentSession } from './types';

const capabilities: AgentBackendCapabilities = {
  supportsAppend: true,
  supportsCancel: true,
  emitsLiveState: true,
  emitsRawSteps: true,
  emitsStreamingText: false,
};

function makeSession(runId: string, providerId: AgentBackend['providerId']): AgentSession {
  return {
    runId,
    providerId,
    handle: `${providerId}-${runId}`,
    capabilities,
    async *events(): AsyncIterable<AgentEvent> {
      yield {
        kind: 'started',
        runId,
        providerId,
        handle: `${providerId}-${runId}`,
        startedAt: '2026-04-08T00:00:00.000Z',
      };
    },
    append: async () => undefined,
    cancel: async () => undefined,
  };
}

function makeBackend(providerId: AgentBackend['providerId']): AgentBackend {
  return {
    providerId,
    capabilities: () => capabilities,
    start: async (config) => makeSession(config.runId, providerId),
  };
}

describe('agent-backend registry', () => {
  beforeEach(() => {
    clearAgentBackends();
  });

  it('registers and resolves a backend by provider id', () => {
    const backend = makeBackend('codex');
    registerAgentBackend(backend);

    expect(hasAgentBackend('codex')).toBe(true);
    expect(getAgentBackend('codex')).toBe(backend);
  });

  it('lists registered backends in insertion order', () => {
    const codex = makeBackend('codex');
    const antigravity = makeBackend('antigravity');

    registerAgentBackend(codex);
    registerAgentBackend(antigravity);

    expect(listAgentBackends()).toEqual([codex, antigravity]);
  });

  it('throws a clear error for unknown providers', () => {
    expect(() => getAgentBackend('codex')).toThrow('AgentBackend not registered for provider: codex');
  });
});