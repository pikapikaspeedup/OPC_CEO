/**
 * Provider Fallback Chain Tests
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  streamQueryWithProviderFallback,
  buildProviderChainFromEnv,
  type ProviderEntry,
  type ProviderFallbackConfig,
  type ProviderStreamEvent,
} from '../provider-fallback';
import { FallbackTriggeredError } from '../retry';
import type { QueryOptions, StreamEvent } from '../types';

// ── Helpers ─────────────────────────────────────────────────────────

async function collect(gen: AsyncGenerator<ProviderStreamEvent>): Promise<ProviderStreamEvent[]> {
  const items: ProviderStreamEvent[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

function getFallbackEvents(events: ProviderStreamEvent[]): Array<Extract<ProviderStreamEvent, { type: 'provider_fallback' }>> {
  return events.filter(
    (event): event is Extract<ProviderStreamEvent, { type: 'provider_fallback' }> => event.type === 'provider_fallback',
  );
}

function makeProvider(name: string, model: string = 'test-model'): ProviderEntry {
  const providerIdMap = {
    anthropic: 'claude-api',
    openai: 'openai-api',
    gemini: 'gemini-api',
    grok: 'grok-api',
  } as const;

  return {
    name,
    model: {
      model,
      apiKey: `key-${name}`,
      provider: name as 'anthropic' | 'openai' | 'gemini' | 'grok',
      providerId: providerIdMap[name as keyof typeof providerIdMap],
      transport: 'pi-ai',
    },
  };
}

const baseQueryOptions: Omit<QueryOptions, 'model'> = {
  systemPrompt: 'You are helpful',
  messages: [{ role: 'user', content: 'Hello' }],
};

// ── Mock streamQueryWithRetry ───────────────────────────────────────

// We mock the retry module to control streamQueryWithRetry behavior
vi.mock('../retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../retry')>();
  return {
    ...actual,
    streamQueryWithRetry: vi.fn(),
  };
});

import { streamQueryWithRetry } from '../retry';
const mockStreamQueryWithRetry = vi.mocked(streamQueryWithRetry);

// ── Tests ───────────────────────────────────────────────────────────

describe('streamQueryWithProviderFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('succeeds with primary provider', async () => {
    const events: StreamEvent[] = [
      { type: 'message_start', message: { id: 'msg1', usage: { input_tokens: 10, output_tokens: 5 } } },
      { type: 'message_stop' },
    ];

    mockStreamQueryWithRetry.mockImplementation(async function* () {
      for (const e of events) yield e;
    });

    const config: ProviderFallbackConfig = {
      providers: [makeProvider('anthropic'), makeProvider('openai')],
    };

    const result = await collect(streamQueryWithProviderFallback(baseQueryOptions, config));

    expect(result).toHaveLength(2);
    expect(result[0]!.type).toBe('message_start');
    expect(result[1]!.type).toBe('message_stop');

    // Should only call with primary provider
    expect(mockStreamQueryWithRetry).toHaveBeenCalledTimes(1);
    const calledOptions = mockStreamQueryWithRetry.mock.calls[0]![0] as QueryOptions;
    expect(calledOptions.model.provider).toBe('anthropic');
  });

  test('falls back to second provider when primary fails', async () => {
    let callCount = 0;
    mockStreamQueryWithRetry.mockImplementation(async function* () {
      callCount++;
      if (callCount === 1) {
        throw new Error('Primary provider unavailable');
      }
      yield { type: 'message_start', message: { id: 'msg1', usage: { input_tokens: 10, output_tokens: 5 } } } as StreamEvent;
      yield { type: 'message_stop' } as StreamEvent;
    });

    const config: ProviderFallbackConfig = {
      providers: [makeProvider('anthropic'), makeProvider('openai')],
    };

    const result = await collect(streamQueryWithProviderFallback(baseQueryOptions, config));

    // Should have: provider_fallback event + message_start + message_stop
    expect(result.length).toBe(3);
    expect(result[0]!.type).toBe('provider_fallback');
    const fallbackEvent = result[0] as { type: 'provider_fallback'; fromProvider: string; toProvider: string };
    expect(fallbackEvent.fromProvider).toBe('anthropic');
    expect(fallbackEvent.toProvider).toBe('openai');

    expect(result[1]!.type).toBe('message_start');
    expect(result[2]!.type).toBe('message_stop');
  });

  test('falls through multiple providers', async () => {
    let callCount = 0;
    mockStreamQueryWithRetry.mockImplementation(async function* () {
      callCount++;
      if (callCount <= 2) {
        throw new Error(`Provider ${callCount} failed`);
      }
      yield { type: 'message_stop' } as StreamEvent;
    });

    const config: ProviderFallbackConfig = {
      providers: [makeProvider('anthropic'), makeProvider('openai'), makeProvider('gemini')],
    };

    const result = await collect(streamQueryWithProviderFallback(baseQueryOptions, config));

    // Two fallback events + message_stop
    const fallbacks = getFallbackEvents(result);
    expect(fallbacks).toHaveLength(2);
    expect(fallbacks[0]?.fromProvider).toBe('anthropic');
    expect(fallbacks[0]?.toProvider).toBe('openai');
    expect(fallbacks[1]?.fromProvider).toBe('openai');
    expect(fallbacks[1]?.toProvider).toBe('gemini');
  });

  test('throws when all providers are exhausted', async () => {
    mockStreamQueryWithRetry.mockImplementation(async function* () {
      throw new Error('Service unavailable');
    });

    const config: ProviderFallbackConfig = {
      providers: [makeProvider('anthropic'), makeProvider('openai')],
    };

    await expect(
      collect(streamQueryWithProviderFallback(baseQueryOptions, config)),
    ).rejects.toThrow('Service unavailable');
  });

  test('catches FallbackTriggeredError and switches provider', async () => {
    let callCount = 0;
    mockStreamQueryWithRetry.mockImplementation(async function* () {
      callCount++;
      if (callCount === 1) {
        throw new FallbackTriggeredError('claude-opus', 'claude-sonnet');
      }
      yield { type: 'message_stop' } as StreamEvent;
    });

    const config: ProviderFallbackConfig = {
      providers: [makeProvider('anthropic', 'claude-opus'), makeProvider('openai', 'gpt-4o')],
      catchModelFallback: true,
    };

    const result = await collect(streamQueryWithProviderFallback(baseQueryOptions, config));

    const fallbacks = getFallbackEvents(result);
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]?.reason).toContain('overloaded');
  });

  test('does not catch FallbackTriggeredError when catchModelFallback is false', async () => {
    mockStreamQueryWithRetry.mockImplementation(async function* () {
      throw new FallbackTriggeredError('claude-opus', 'claude-sonnet');
    });

    const config: ProviderFallbackConfig = {
      providers: [makeProvider('anthropic'), makeProvider('openai')],
      catchModelFallback: false,
    };

    await expect(
      collect(streamQueryWithProviderFallback(baseQueryOptions, config)),
    ).rejects.toThrow('Model fallback triggered');
  });

  test('throws with zero providers', async () => {
    const config: ProviderFallbackConfig = { providers: [] };

    await expect(
      collect(streamQueryWithProviderFallback(baseQueryOptions, config)),
    ).rejects.toThrow('at least one provider');
  });

  test('supports maxFailuresBeforeFallback > 1', async () => {
    let callCount = 0;
    mockStreamQueryWithRetry.mockImplementation(async function* () {
      callCount++;
      if (callCount <= 2) {
        throw new Error(`Attempt ${callCount} failed`);
      }
      yield { type: 'message_stop' } as StreamEvent;
    });

    const config: ProviderFallbackConfig = {
      providers: [makeProvider('anthropic'), makeProvider('openai')],
      maxFailuresBeforeFallback: 3, // Allow 3 failures before switching
    };

    // Call count 1, 2 fail on anthropic, call count 3 on anthropic succeeds
    const result = await collect(streamQueryWithProviderFallback(baseQueryOptions, config));

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('message_stop');
    // All 3 calls were to the primary provider
    expect(callCount).toBe(3);
  });

  test('passes per-provider retryOptions', async () => {
    mockStreamQueryWithRetry.mockImplementation(async function* () {
      yield { type: 'message_stop' } as StreamEvent;
    });

    const config: ProviderFallbackConfig = {
      providers: [{
        ...makeProvider('anthropic'),
        retryOptions: { maxRetries: 5 },
      }],
    };

    await collect(streamQueryWithProviderFallback(baseQueryOptions, config, { maxRetries: 2 }));

    // Per-provider retryOptions should override base
    const calledRetryOptions = mockStreamQueryWithRetry.mock.calls[0]![1];
    expect(calledRetryOptions).toEqual(expect.objectContaining({ maxRetries: 5 }));
  });
});

describe('buildProviderChainFromEnv', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('XAI_API_KEY', '');
    vi.stubEnv('GROK_API_KEY', '');
    vi.stubEnv('CLAUDE_CODE_USE_OPENAI', '');
    vi.stubEnv('CLAUDE_CODE_USE_GEMINI', '');
    vi.stubEnv('CLAUDE_CODE_USE_GROK', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('returns empty chain when no API keys', () => {
    const chain = buildProviderChainFromEnv();
    expect(chain).toHaveLength(0);
  });

  test('returns anthropic as primary with only ANTHROPIC_API_KEY', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-123');
    const chain = buildProviderChainFromEnv();
    expect(chain).toHaveLength(1);
    expect(chain[0]!.name).toBe('anthropic');
    expect(chain[0]!.model.transport).toBe('pi-ai');
  });

  test('returns multiple providers ordered by priority', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-123');
    vi.stubEnv('OPENAI_API_KEY', 'sk-oai-123');
    vi.stubEnv('GEMINI_API_KEY', 'gemini-123');

    const chain = buildProviderChainFromEnv();

    expect(chain).toHaveLength(3);
    expect(chain[0]!.name).toBe('anthropic');
    expect(chain[1]!.name).toBe('openai');
    expect(chain[2]!.name).toBe('gemini');
  });

  test('respects USE_OPENAI as primary', () => {
    vi.stubEnv('CLAUDE_CODE_USE_OPENAI', '1');
    vi.stubEnv('OPENAI_API_KEY', 'sk-oai-123');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-123');

    const chain = buildProviderChainFromEnv();

    expect(chain[0]!.name).toBe('openai');
    expect(chain[1]!.name).toBe('anthropic');
  });

  test('includes grok with XAI_API_KEY', () => {
    vi.stubEnv('XAI_API_KEY', 'xai-123');
    vi.stubEnv('CLAUDE_CODE_USE_GROK', '1');

    const chain = buildProviderChainFromEnv();

    expect(chain).toHaveLength(1);
    expect(chain[0]!.name).toBe('grok');
  });
});

describe('retry helpers', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('detectProvider defaults to anthropic', async () => {
    delete process.env.CLAUDE_CODE_USE_OPENAI;
    delete process.env.CLAUDE_CODE_USE_GEMINI;
    delete process.env.CLAUDE_CODE_USE_GROK;
    const { detectProvider } = await import('../retry');
    expect(detectProvider()).toBe('anthropic');
  });

  test('detectProvider honors OPENAI/GEMINI/GROK env flags', async () => {
    const { detectProvider } = await import('../retry');
    process.env.CLAUDE_CODE_USE_OPENAI = '1';
    expect(detectProvider()).toBe('openai');
    delete process.env.CLAUDE_CODE_USE_OPENAI;

    process.env.CLAUDE_CODE_USE_GEMINI = '1';
    expect(detectProvider()).toBe('gemini');
    delete process.env.CLAUDE_CODE_USE_GEMINI;

    process.env.CLAUDE_CODE_USE_GROK = '1';
    expect(detectProvider()).toBe('grok');
  });

  test('FallbackTriggeredError carries original and fallback model ids', () => {
    const err = new FallbackTriggeredError('claude-opus-4-20250514', 'claude-sonnet-4-20250514');
    expect(err.originalModel).toBe('claude-opus-4-20250514');
    expect(err.fallbackModel).toBe('claude-sonnet-4-20250514');
    expect(err.name).toBe('FallbackTriggeredError');
  });
});
