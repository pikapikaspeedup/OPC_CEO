import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QueryOptions, StreamEvent } from '../types';

const mockStreamQueryViaPi = vi.fn();

vi.mock('../pi-transport', () => ({
  streamQueryViaPi: (...args: unknown[]) => mockStreamQueryViaPi(...args),
}));

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

function makeEvent(id = 'msg-1'): StreamEvent {
  return {
    type: 'message_start',
    message: { id, usage: { input_tokens: 1, output_tokens: 0 } },
  };
}

function makeOptions(overrides: Partial<QueryOptions['model']> = {}): QueryOptions {
  return {
    model: {
      model: 'gpt-5-mini',
      apiKey: 'key',
      provider: 'openai',
      providerId: 'openai-api',
      transport: 'pi-ai',
      ...overrides,
    },
    systemPrompt: 'You are helpful',
    messages: [{ role: 'user', content: 'Hello' }],
  };
}

describe('pi transport runtime routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses pi-ai transport when provider profile selects it', async () => {
    mockStreamQueryViaPi.mockImplementation(async function* () {
      yield makeEvent('pi');
      yield { type: 'message_stop' } as StreamEvent;
    });

    const { streamQueryWithRetry } = await import('../retry');
    const events = await collect(streamQueryWithRetry(makeOptions()));

    expect(events).toEqual([
      expect.objectContaining({ type: 'message_start' }),
      expect.objectContaining({ type: 'message_stop' }),
    ]);
    expect(mockStreamQueryViaPi).toHaveBeenCalledTimes(1);
  });

  it('surfaces pi-ai failures instead of falling back to native provider transport', async () => {
    mockStreamQueryViaPi.mockImplementation(async function* () {
      throw new Error('pi failed');
    });

    const { streamQueryWithRetry } = await import('../retry');
    await expect(collect(streamQueryWithRetry(makeOptions()))).rejects.toThrow('pi failed');
    expect(mockStreamQueryViaPi).toHaveBeenCalledTimes(1);
  });

  it('routes custom provider through pi-ai and does not fall back to a native OpenAI-compatible transport', async () => {
    mockStreamQueryViaPi.mockImplementation(async function* () {
      throw new Error('custom pi failed');
    });

    const { streamQueryWithRetry } = await import('../retry');
    await expect(collect(streamQueryWithRetry(makeOptions({
      provider: 'custom',
      providerId: 'custom',
      baseUrl: 'https://proxy.example.com',
      model: 'deepseek-chat',
    })))).rejects.toThrow('custom pi failed');

    expect(mockStreamQueryViaPi).toHaveBeenCalledTimes(1);
  });

  it('routes native-codex through pi-ai mainline', async () => {
    mockStreamQueryViaPi.mockImplementation(async function* () {
      yield makeEvent('native-codex-pi');
      yield { type: 'message_stop' } as StreamEvent;
    });

    const { streamQueryWithRetry } = await import('../retry');
    const events = await collect(streamQueryWithRetry(makeOptions({
      provider: 'native-codex',
      providerId: 'native-codex',
      model: 'gpt-5.4',
    })));

    expect(events).toHaveLength(2);
    expect(mockStreamQueryViaPi).toHaveBeenCalledTimes(1);
  });

  it('coerces legacy native transport flags back onto pi-ai for API-backed providers', async () => {
    mockStreamQueryViaPi.mockImplementation(async function* () {
      yield makeEvent('coerced-pi');
      yield { type: 'message_stop' } as StreamEvent;
    });

    const { streamQueryWithRetry } = await import('../retry');
    const events = await collect(streamQueryWithRetry(makeOptions({
      provider: 'openai',
      providerId: 'openai-api',
      transport: 'native',
    })));

    expect(events).toHaveLength(2);
    expect(mockStreamQueryViaPi).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.objectContaining({ transport: 'pi-ai' }),
    }));
  });
});
