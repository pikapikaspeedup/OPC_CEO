import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockNativeCodexComplete } = vi.hoisted(() => ({
  mockNativeCodexComplete: vi.fn(),
}));

vi.mock('../../../bridge/native-codex-adapter', () => ({
  nativeCodexComplete: (...args: unknown[]) => mockNativeCodexComplete(...args),
}));

import { streamQueryWithRetry } from '../retry';
import { streamQueryNativeCodex } from '../native-codex';
import type { QueryOptions, StreamEvent } from '../types';

function makeQueryOptions(overrides: Partial<QueryOptions> = {}): QueryOptions {
  return {
    model: {
      model: 'gpt-5.4',
      apiKey: 'unused-native-codex-key',
      provider: 'native-codex',
    },
    systemPrompt: 'You are a helpful coding assistant.',
    messages: [{ role: 'user', content: 'Read the config file.' }],
    ...overrides,
  };
}

async function collect<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('streamQueryNativeCodex', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('converts native-codex responses into Anthropic-style stream events', async () => {
    mockNativeCodexComplete.mockResolvedValue({
      content: 'I need to inspect a file first.',
      toolCalls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'FileReadTool',
            arguments: '{"path":"src/index.ts"}',
          },
        },
      ],
      model: 'gpt-5.4',
      usage: {
        promptTokens: 11,
        completionTokens: 7,
        totalTokens: 18,
      },
      finishReason: 'tool_calls',
    });

    const events = await collect(streamQueryNativeCodex(makeQueryOptions({
      tools: [
        {
          name: 'FileReadTool',
          description: 'Read a file from the workspace',
          input_schema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
    })));

    expect(mockNativeCodexComplete).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.4',
      messages: [
        { role: 'system', content: 'You are a helpful coding assistant.' },
        { role: 'user', content: 'Read the config file.' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'FileReadTool',
            description: 'Read a file from the workspace',
            parameters: { type: 'object', properties: { path: { type: 'string' } } },
          },
        },
      ],
      signal: undefined,
    }));

    expect(events[0]).toEqual({
      type: 'message_start',
      message: {
        id: expect.stringMatching(/^native-codex-/),
        usage: {
          input_tokens: 11,
          output_tokens: 7,
        },
      },
    });

    expect(events.find((event) =>
      event.type === 'content_block_delta'
      && event.delta.type === 'text_delta'
      && event.delta.text === 'I need to inspect a file first.',
    )).toBeDefined();

    expect(events.find((event) =>
      event.type === 'content_block_start'
      && event.content_block.type === 'tool_use'
      && event.content_block.name === 'FileReadTool'
      && event.content_block.input.path === 'src/index.ts',
    )).toBeDefined();

    expect(events.find((event) =>
      event.type === 'message_delta'
      && event.delta.stop_reason === 'tool_use',
    )).toBeDefined();
    expect(events.at(-1)).toEqual({ type: 'message_stop' });
  });

  it('flattens prior tool interactions before sending them to native-codex', async () => {
    mockNativeCodexComplete.mockResolvedValue({
      content: 'The file has been inspected.',
      toolCalls: [],
      model: 'gpt-5.4',
      usage: null,
      finishReason: 'stop',
    });

    await collect(streamQueryNativeCodex(makeQueryOptions({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will inspect the file.' },
            { type: 'tool_use', id: 'tool_1', name: 'FileReadTool', input: { path: 'README.md' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tool_1', content: 'README contents' },
          ],
        },
      ],
    })));

    expect(mockNativeCodexComplete).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: 'system', content: 'You are a helpful coding assistant.' },
        {
          role: 'assistant',
          content: expect.stringContaining('<tool-use id="tool_1" name="FileReadTool">'),
        },
        {
          role: 'user',
          content: expect.stringContaining('<tool-result id="tool_1">'),
        },
      ],
    }));
  });

  it('routes native-codex through streamQueryWithRetry mainline', async () => {
    mockNativeCodexComplete.mockResolvedValue({
      content: 'Done.',
      toolCalls: [],
      model: 'gpt-5.4',
      usage: null,
      finishReason: 'stop',
    });

    const events = await collect(streamQueryWithRetry(makeQueryOptions())) as StreamEvent[];

    expect(mockNativeCodexComplete).toHaveBeenCalledTimes(1);
    expect(events[0]?.type).toBe('message_start');
    expect(events.at(-1)).toEqual({ type: 'message_stop' });
  });
});
