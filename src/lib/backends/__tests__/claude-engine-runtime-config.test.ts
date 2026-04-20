import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  engineOptions,
  mockAppendRunHistoryEntry,
  mockEmitRunEvent,
} = vi.hoisted(() => ({
  engineOptions: [] as Array<Record<string, unknown>>,
  mockAppendRunHistoryEntry: vi.fn(),
  mockEmitRunEvent: vi.fn(),
}));

vi.mock('../../claude-engine/engine/claude-engine', () => {
  class MockClaudeEngine {
    constructor(public options: Record<string, unknown>) {
      engineOptions.push(options);
    }

    async init() {}

    getSessionId() {
      return 'session-runtime-config';
    }

    async *chat() {
      yield {
        type: 'complete',
        totalTurns: 1,
        totalUsage: {
          input_tokens: 1,
          output_tokens: 1,
        },
        stopReason: 'end_turn',
      };
    }
  }

  return { ClaudeEngine: MockClaudeEngine };
});

vi.mock('../../providers/ai-config', () => ({
  loadAIConfig: vi.fn(() => ({})),
}));

vi.mock('../../agents/run-history', () => ({
  appendRunHistoryEntry: (...args: unknown[]) => mockAppendRunHistoryEntry(...args),
}));

vi.mock('../../agents/run-events', () => ({
  emitRunEvent: (...args: unknown[]) => mockEmitRunEvent(...args),
}));

vi.mock('../../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { ClaudeEngineAgentBackend } from '../claude-engine-backend';
import type { BackendRunConfig } from '../types';

function makeConfig(overrides: Record<string, unknown> = {}): BackendRunConfig {
  return {
    runId: 'claude-engine-runtime-config-run',
    workspacePath: '/tmp/claude-engine-runtime-config',
    prompt: 'Execute acceptance test',
    model: 'gpt-4.1-mini',
    ...overrides,
  } as BackendRunConfig;
}

describe('ClaudeEngine runtime config forwarding', () => {
  beforeEach(() => {
    engineOptions.length = 0;
    mockAppendRunHistoryEntry.mockClear();
    mockEmitRunEvent.mockClear();
  });

  it('forwards toolset and additionalWorkingDirectories into ClaudeEngine options', async () => {
    const backend = new ClaudeEngineAgentBackend('openai-api');
    const additionalWorkingDirectories = [
      '/tmp/claude-engine-runtime-config/docs',
      '/tmp/claude-engine-runtime-config/specs',
    ];

    const session = await backend.start(makeConfig({
      toolset: 'coding',
      additionalWorkingDirectories,
    }));

    expect(engineOptions).toHaveLength(1);
    expect(engineOptions[0]).toEqual(expect.objectContaining({
      toolset: 'coding',
      toolContext: expect.objectContaining({
        workspacePath: '/tmp/claude-engine-runtime-config',
        additionalWorkingDirectories,
      }),
    }));

    await session.cancel('stop');
  });
});
