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
import { loadAIConfig } from '../../providers/ai-config';

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

  it('forwards provider transport into ClaudeEngine model config', async () => {
    vi.mocked(loadAIConfig).mockReturnValue({
      defaultProvider: 'native-codex',
      providerProfiles: {
        'openai-api': { transport: 'pi-ai' },
      },
    });

    const backend = new ClaudeEngineAgentBackend('openai-api');
    const session = await backend.start(makeConfig({ model: 'gpt-5-mini' }));

    expect(engineOptions).toHaveLength(1);
    expect(engineOptions[0]).toEqual(expect.objectContaining({
      model: expect.objectContaining({
        provider: 'openai',
        providerId: 'openai-api',
        transport: 'pi-ai',
      }),
    }));

    await session.cancel('stop');
  });

  it('forwards native-codex transport into ClaudeEngine model config', async () => {
    vi.mocked(loadAIConfig).mockReturnValue({
      defaultProvider: 'native-codex',
      providerProfiles: {
        'native-codex': { transport: 'pi-ai' },
      },
    });

    const backend = new ClaudeEngineAgentBackend('native-codex');
    const session = await backend.start(makeConfig({ model: 'gpt-5.4' }));

    expect(engineOptions).toHaveLength(1);
    expect(engineOptions[0]).toEqual(expect.objectContaining({
      model: expect.objectContaining({
        provider: 'native-codex',
        providerId: 'native-codex',
        transport: 'pi-ai',
      }),
    }));

    await session.cancel('stop');
  });

  it('preserves custom provider identity for transport-aware routing', async () => {
    vi.mocked(loadAIConfig).mockReturnValue({
      defaultProvider: 'custom',
      customProvider: {
        baseUrl: 'https://proxy.example.com',
        apiKey: 'proxy-key',
        defaultModel: 'deepseek-chat',
      },
      providerProfiles: {
        custom: { transport: 'pi-ai' },
      },
    });

    const backend = new ClaudeEngineAgentBackend('custom');
    const session = await backend.start(makeConfig({ model: 'deepseek-chat' }));

    expect(engineOptions).toHaveLength(1);
    expect(engineOptions[0]).toEqual(expect.objectContaining({
      model: expect.objectContaining({
        provider: 'custom',
        providerId: 'custom',
        transport: 'pi-ai',
        baseUrl: 'https://proxy.example.com',
      }),
    }));

    await session.cancel('stop');
  });
});
