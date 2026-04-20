import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockResolveCodexAccessToken } = vi.hoisted(() => ({
  mockResolveCodexAccessToken: vi.fn(),
}));

vi.mock('./native-codex-auth', () => ({
  resolveCodexAccessToken: (...args: unknown[]) => mockResolveCodexAccessToken(...args),
}));

import { nativeCodexComplete, normalizeNativeCodexModel } from './native-codex-adapter';

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

describe('normalizeNativeCodexModel', () => {
  it('keeps supported native codex models unchanged', () => {
    expect(normalizeNativeCodexModel('gpt-5.4')).toBe('gpt-5.4');
    expect(normalizeNativeCodexModel('gpt-5.4-mini')).toBe('gpt-5.4-mini');
  });

  it('maps internal placeholder models to supported native codex models', () => {
    expect(normalizeNativeCodexModel('MODEL_PLACEHOLDER_M26')).toBe('gpt-5.4');
    expect(normalizeNativeCodexModel('MODEL_PLACEHOLDER_M47')).toBe('gpt-5.4-mini');
    expect(normalizeNativeCodexModel('MODEL_AUTO')).toBe('gpt-5.4');
  });

  it('falls back to default codex model for unknown ids', () => {
    expect(normalizeNativeCodexModel('claude-sonnet-4')).toBe('gpt-5.4');
    expect(normalizeNativeCodexModel(undefined)).toBe('gpt-5.4');
  });
});

describe('nativeCodexComplete', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('passes abort signal and tools to fetch, then parses function calls', async () => {
    mockResolveCodexAccessToken.mockResolvedValue('test-access-token');
    const controller = new AbortController();

    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      expect(init?.signal).toBe(controller.signal);
      expect(payload.model).toBe('gpt-5.4');
      expect(payload.tools).toEqual([
        {
          type: 'function',
          name: 'FileReadTool',
          description: 'Read a file',
          parameters: { type: 'object' },
        },
      ]);

      return new Response(
        createSSEStream([
          'data: {"type":"response.output_item.done","item":{"type":"message","content":[{"type":"output_text","text":"Let me inspect that."}]}}\n\n',
          'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_1","name":"FileReadTool","arguments":"{\\"path\\":\\"README.md\\"}"}}\n\n',
          'data: {"type":"response.done","response":{"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}\n\n',
        ]),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      );
    }));

    const result = await nativeCodexComplete({
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Read the readme.' },
      ],
      model: 'MODEL_PLACEHOLDER_M26',
      tools: [
        {
          type: 'function',
          function: {
            name: 'FileReadTool',
            description: 'Read a file',
            parameters: { type: 'object' },
          },
        },
      ],
      signal: controller.signal,
    });

    expect(result).toEqual({
      content: 'Let me inspect that.',
      toolCalls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'FileReadTool',
            arguments: '{"path":"README.md"}',
          },
        },
      ],
      model: 'gpt-5.4',
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
      finishReason: 'tool_calls',
    });
  });
});
