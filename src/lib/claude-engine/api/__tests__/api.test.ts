import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

import type { Tool } from '../../types';
import {
  buildHeaders,
  buildRequestBody,
  parseSSELine,
  query,
  streamQuery,
} from '../client';
import {
  calculateBackoff,
  shouldRetry,
  streamQueryWithRetry,
  type RetryOptions,
} from '../retry';
import { toolToAPISchema, toolsToAPISchemas } from '../tool-schema';
import type {
  APIResponse,
  ModelConfig,
  QueryOptions,
  StreamEvent,
  TokenUsage,
} from '../types';
import { MODEL_PRICING, UsageTracker } from '../usage';

function createModelConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    model: 'claude-sonnet-4-20250514',
    apiKey: 'test-api-key',
    ...overrides,
  };
}

function createQueryOptions(overrides: Partial<QueryOptions> = {}): QueryOptions {
  return {
    model: createModelConfig(),
    systemPrompt: 'You are a helpful coding assistant.',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }

      controller.close();
    },
  });
}

function createSSEFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function collectEvents<T>(
  generator: AsyncGenerator<T>,
): Promise<T[]> {
  const events: T[] = [];

  for await (const event of generator) {
    events.push(event);
  }

  return events;
}

function createMockTool(): Tool<{
  path: string;
  recursive?: boolean;
}> {
  return {
    name: 'FileReadTool',
    inputSchema: z.object({
      path: z.string(),
      recursive: z.boolean().optional(),
    }),
    description: () => 'Read a file from the workspace',
    call: async () => ({ data: 'ok' }),
    isEnabled: () => true,
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    maxResultSizeChars: 10_000,
  };
}

describe('buildHeaders', () => {
  test('includes api key', () => {
    const headers = buildHeaders(createQueryOptions());

    expect(headers['x-api-key']).toBe('test-api-key');
  });

  test('includes anthropic-version header', () => {
    const headers = buildHeaders(createQueryOptions());

    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  test('includes betas header when provided', () => {
    const headers = buildHeaders(
      createQueryOptions({ betas: ['prompt-caching-2024-07-31', 'tools-2024-05-16'] }),
    );

    expect(headers['anthropic-beta']).toBe(
      'prompt-caching-2024-07-31,tools-2024-05-16',
    );
  });

  test('does not include betas header when empty', () => {
    const headers = buildHeaders(createQueryOptions({ betas: [] }));

    expect(headers['anthropic-beta']).toBeUndefined();
  });
});

describe('buildRequestBody', () => {
  test('includes model and max_tokens', () => {
    const body = buildRequestBody(
      createQueryOptions({ maxOutputTokens: 2048 }),
    );

    expect(body.model).toBe('claude-sonnet-4-20250514');
    expect(body.max_tokens).toBe(2048);
  });

  test('includes system prompt', () => {
    const body = buildRequestBody(createQueryOptions());

    expect(body.system).toBe('You are a helpful coding assistant.');
  });

  test('includes messages array', () => {
    const body = buildRequestBody(createQueryOptions());

    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  test('includes tools when provided', () => {
    const body = buildRequestBody(
      createQueryOptions({
        tools: [
          {
            name: 'FileReadTool',
            description: 'Read files',
            input_schema: { type: 'object' },
          },
        ],
      }),
    );

    expect(body.tools).toEqual([
      {
        name: 'FileReadTool',
        description: 'Read files',
        input_schema: { type: 'object' },
      },
    ]);
  });

  test('includes thinking config when enabled', () => {
    const body = buildRequestBody(
      createQueryOptions({
        thinking: { type: 'enabled', budgetTokens: 1024 },
      }),
    );

    expect(body.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 1024,
    });
  });

  test('omits thinking when disabled', () => {
    const body = buildRequestBody(
      createQueryOptions({
        thinking: { type: 'disabled' },
      }),
    );

    expect(body.thinking).toBeUndefined();
  });
});

describe('parseSSELine', () => {
  test('parses event line', () => {
    expect(parseSSELine('event: message_start')).toEqual({
      event: 'message_start',
    });
  });

  test('parses data line', () => {
    expect(parseSSELine('data: {"type":"message_start"}')).toEqual({
      data: '{"type":"message_start"}',
    });
  });

  test('ignores comment lines', () => {
    expect(parseSSELine(': keepalive')).toBeNull();
  });

  test('handles empty lines', () => {
    expect(parseSSELine('')).toBeNull();
  });
});

describe('streamQuery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('yields events from SSE stream (mock fetch)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          createSSEStream([
            createSSEFrame('message_start', {
              type: 'message_start',
              message: {
                id: 'msg_123',
                usage: { input_tokens: 10, output_tokens: 0 },
              },
            }).slice(0, 40),
            createSSEFrame('message_start', {
              type: 'message_start',
              message: {
                id: 'msg_123',
                usage: { input_tokens: 10, output_tokens: 0 },
              },
            }).slice(40) +
              createSSEFrame('content_block_start', {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              }) +
              createSSEFrame('content_block_delta', {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: 'Hello' },
              }) +
              createSSEFrame('message_stop', { type: 'message_stop' }),
          ]),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
      ),
    );

    const events = await collectEvents(streamQuery(createQueryOptions()));

    expect(events).toEqual([
      {
        type: 'message_start',
        message: {
          id: 'msg_123',
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      },
      { type: 'message_stop' },
    ]);
  });

  test('handles abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.signal as AbortSignal | undefined)?.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }

        throw new Error('Expected an aborted signal');
      }),
    );

    await expect(
      collectEvents(
        streamQuery(
          createQueryOptions({ signal: controller.signal }),
        ),
      ),
    ).rejects.toThrow(/aborted/i);
  });

  test('throws on non-200 status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 })),
    );

    await expect(
      collectEvents(streamQuery(createQueryOptions())),
    ).rejects.toThrow(/429/);
  });

  test('handles error event in stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          createSSEStream([
            createSSEFrame('error', {
              type: 'error',
              error: {
                type: 'overloaded_error',
                message: 'Server busy',
              },
            }),
          ]),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
      ),
    );

    const events = await collectEvents(streamQuery(createQueryOptions()));

    expect(events).toEqual([
      {
        type: 'error',
        error: {
          type: 'overloaded_error',
          message: 'Server busy',
        },
      },
    ]);
  });
});

describe('query', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('collects stream events into APIResponse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          createSSEStream([
            createSSEFrame('message_start', {
              type: 'message_start',
              message: {
                id: 'msg_final',
                usage: { input_tokens: 42, output_tokens: 0 },
              },
            }) +
              createSSEFrame('content_block_start', {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              }) +
              createSSEFrame('content_block_delta', {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: 'Hello world' },
              }) +
              createSSEFrame('content_block_stop', {
                type: 'content_block_stop',
                index: 0,
              }) +
              createSSEFrame('message_delta', {
                type: 'message_delta',
                delta: { stop_reason: 'end_turn' },
                usage: { input_tokens: 42, output_tokens: 12 },
              }) +
              createSSEFrame('message_stop', { type: 'message_stop' }),
          ]),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
      ),
    );

    const response = await query(createQueryOptions());

    expect(response).toEqual<APIResponse>({
      id: 'msg_final',
      content: [{ type: 'text', text: 'Hello world' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 42, output_tokens: 12 },
      model: 'claude-sonnet-4-20250514',
    });
  });

  test('extracts usage from message_delta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          createSSEStream([
            createSSEFrame('message_start', {
              type: 'message_start',
              message: {
                id: 'msg_usage',
                usage: { input_tokens: 100, output_tokens: 0 },
              },
            }) +
              createSSEFrame('message_delta', {
                type: 'message_delta',
                delta: { stop_reason: 'end_turn' },
                usage: {
                  input_tokens: 100,
                  output_tokens: 55,
                  cache_read_input_tokens: 12,
                },
              }) +
              createSSEFrame('message_stop', { type: 'message_stop' }),
          ]),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
      ),
    );

    const response = await query(createQueryOptions());

    expect(response.usage).toEqual<TokenUsage>({
      input_tokens: 100,
      output_tokens: 55,
      cache_read_input_tokens: 12,
    });
  });
});

describe('streamQueryWithRetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('retries on 429 with backoff', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          createSSEStream([
            createSSEFrame('message_start', {
              type: 'message_start',
              message: {
                id: 'msg_retry_429',
                usage: { input_tokens: 1, output_tokens: 0 },
              },
            }),
          ]),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const events = await collectEvents(
      streamQueryWithRetry(createQueryOptions(), {
        maxRetries: 2,
        initialDelayMs: 0,
        maxDelayMs: 0,
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events[0]).toMatchObject({
      type: 'retry',
      attempt: 1,
      maxAttempts: 3,
      statusCode: 429,
    });
    expect(events[1]).toMatchObject({ type: 'message_start' });
  });

  test('retries on 529', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('overloaded', { status: 529 }))
      .mockResolvedValueOnce(
        new Response(
          createSSEStream([
            createSSEFrame('message_stop', { type: 'message_stop' }),
          ]),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const events = await collectEvents(
      streamQueryWithRetry(createQueryOptions(), {
        maxRetries: 1,
        initialDelayMs: 0,
        maxDelayMs: 0,
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events[0]).toMatchObject({
      type: 'retry',
      statusCode: 529,
    });
  });

  test('does not retry on 400', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    let thrownError: unknown;

    try {
      await collectEvents(
        streamQueryWithRetry(createQueryOptions(), {
          maxRetries: 2,
          initialDelayMs: 0,
          maxDelayMs: 0,
        }),
      );
    } catch (error) {
      thrownError = error;
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toMatch(/400/);
  });

  test('yields retry events', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          createSSEStream([
            createSSEFrame('message_stop', { type: 'message_stop' }),
          ]),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const events = await collectEvents(
      streamQueryWithRetry(createQueryOptions(), {
        maxRetries: 1,
        initialDelayMs: 0,
        maxDelayMs: 0,
      }),
    );

    expect(events[0]).toMatchObject({
      type: 'retry',
      attempt: 1,
      maxAttempts: 2,
      statusCode: 503,
    });
  });

  test('stops after maxRetries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('still overloaded', { status: 529 }));
    vi.stubGlobal('fetch', fetchMock);

    const yielded: Array<StreamEvent | { type: 'retry' }> = [];
    let thrownError: unknown;

    try {
      for await (const event of streamQueryWithRetry(createQueryOptions(), {
        maxRetries: 2,
        initialDelayMs: 0,
        maxDelayMs: 0,
      })) {
        yielded.push(event as StreamEvent | { type: 'retry' });
      }
    } catch (error) {
      thrownError = error;
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(yielded.filter((event) => event.type === 'retry')).toHaveLength(2);
    expect(thrownError).toBeInstanceOf(Error);
  });
});

describe('calculateBackoff', () => {
  test('applies exponential backoff', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const options: Required<RetryOptions> = {
      maxRetries: 3,
      initialDelayMs: 500,
      maxDelayMs: 60_000,
      retryableStatusCodes: [429, 529, 502, 503],
    };

    expect(calculateBackoff(1, options)).toBe(500);
    expect(calculateBackoff(2, options)).toBe(1000);
    expect(calculateBackoff(3, options)).toBe(2000);
  });

  test('respects maxDelayMs cap', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const options: Required<RetryOptions> = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 1500,
      retryableStatusCodes: [429, 529, 502, 503],
    };

    expect(calculateBackoff(3, options)).toBe(1500);
  });

  test('adds jitter', () => {
    const options: Required<RetryOptions> = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 60_000,
      retryableStatusCodes: [429, 529, 502, 503],
    };

    vi.spyOn(Math, 'random').mockReturnValue(0);
    const low = calculateBackoff(2, options);

    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const high = calculateBackoff(2, options);

    expect(low).not.toBe(high);
  });
});

describe('shouldRetry', () => {
  test('returns true for retryable status', () => {
    expect(shouldRetry(429, [429, 529, 502, 503])).toBe(true);
  });

  test('returns false for non-retryable status', () => {
    expect(shouldRetry(400, [429, 529, 502, 503])).toBe(false);
  });
});

describe('toolToAPISchema', () => {
  test('converts Tool to APITool', () => {
    const apiTool = toolToAPISchema(createMockTool());

    expect(apiTool.name).toBe('FileReadTool');
    expect(apiTool.description).toBe('Read a file from the workspace');
  });

  test('extracts JSON schema from zod schema', () => {
    const apiTool = toolToAPISchema(createMockTool());

    expect(apiTool.input_schema).toEqual({
      type: 'object',
      properties: {
        path: { type: 'string' },
        recursive: { type: 'boolean' },
      },
      required: ['path'],
      additionalProperties: false,
    });
  });

  test('batch converts tools', () => {
    const schemas = toolsToAPISchemas([createMockTool(), createMockTool()]);

    expect(schemas).toHaveLength(2);
    expect(schemas[0]?.name).toBe('FileReadTool');
  });
});

describe('UsageTracker', () => {
  test('starts at zero', () => {
    const tracker = new UsageTracker();

    expect(tracker.getTotal()).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
  });

  test('accumulates usage from multiple calls', () => {
    const tracker = new UsageTracker();

    tracker.add({ input_tokens: 100, output_tokens: 40 });
    tracker.add({
      input_tokens: 50,
      output_tokens: 10,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 2,
    });

    expect(tracker.getTotal()).toEqual({
      input_tokens: 150,
      output_tokens: 50,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 2,
    });
  });

  test('estimates cost for known models', () => {
    const tracker = new UsageTracker();
    tracker.add({ input_tokens: 1000, output_tokens: 500 });

    expect(MODEL_PRICING['claude-sonnet-4-20250514']).toBeDefined();
    expect(tracker.estimateCost('claude-sonnet-4-20250514')).toBeGreaterThan(0);
  });

  test('reset clears totals', () => {
    const tracker = new UsageTracker();
    tracker.add({ input_tokens: 100, output_tokens: 40 });

    tracker.reset();

    expect(tracker.getTotal()).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
  });
});