import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockResolveCodexAccessToken } = vi.hoisted(() => ({
  mockResolveCodexAccessToken: vi.fn(),
}));
const { completeMock, getModelsMock, getModelMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
  getModelsMock: vi.fn(),
  getModelMock: vi.fn(),
}));

vi.mock('./native-codex-auth', () => ({
  resolveCodexAccessToken: (...args: unknown[]) => mockResolveCodexAccessToken(...args),
}));

vi.mock('@mariozechner/pi-ai', () => ({
  complete: (...args: unknown[]) => completeMock(...args),
  getModels: (...args: unknown[]) => getModelsMock(...args),
  getModel: (...args: unknown[]) => getModelMock(...args),
}));

import {
  nativeCodexComplete,
  nativeCodexGenerateImage,
  normalizeNativeCodexModel,
} from './native-codex-adapter';

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
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('passes signal and tools to pi-ai, then parses function calls', async () => {
    mockResolveCodexAccessToken.mockResolvedValue('test-access-token');
    const controller = new AbortController();
    getModelsMock.mockReturnValue([{ id: 'gpt-5.4' }]);
    getModelMock.mockReturnValue({ id: 'gpt-5.4' });
    completeMock.mockResolvedValue({
      content: [
        { type: 'text', text: 'Let me inspect that.' },
        { type: 'toolCall', id: 'call_1', name: 'FileReadTool', arguments: { path: 'README.md' } },
      ],
      usage: {
        input: 10,
        output: 5,
        totalTokens: 15,
      },
      stopReason: 'toolUse',
    });

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

    expect(getModelsMock).toHaveBeenCalledWith('openai-codex');
    expect(completeMock).toHaveBeenCalledWith(
      { id: 'gpt-5.4' },
      expect.objectContaining({
        messages: [
          expect.objectContaining({ role: 'user' }),
        ],
        tools: [
          expect.objectContaining({
            name: 'FileReadTool',
            description: 'Read a file',
            parameters: { type: 'object' },
          }),
        ],
      }),
      expect.objectContaining({
        apiKey: 'test-access-token',
        signal: controller.signal,
        transport: 'auto',
      }),
    );
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

  it('does not fall back to native fetch when pi-ai fails', async () => {
    mockResolveCodexAccessToken.mockResolvedValue('test-access-token');
    getModelsMock.mockReturnValue([{ id: 'gpt-5.4' }]);
    getModelMock.mockReturnValue({ id: 'gpt-5.4' });
    completeMock.mockRejectedValue(new Error('pi-ai unavailable'));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(nativeCodexComplete({
      messages: [
        { role: 'user', content: 'hello' },
      ],
      model: 'gpt-5.4',
    })).rejects.toThrow('pi-ai unavailable');

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('nativeCodexGenerateImage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('forces the image_generation tool and returns a base64 payload', async () => {
    mockResolveCodexAccessToken.mockResolvedValue('test-access-token');

    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      expect(payload.model).toBe('gpt-5.5');
      expect(payload.instructions).toBe('You are a helpful assistant.');
      expect(payload.input).toEqual([
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'orange cat mascot' }],
        },
      ]);
      expect(payload.tool_choice).toEqual({ type: 'image_generation' });
      expect(payload.tools).toEqual([{ type: 'image_generation', size: '1024x1024' }]);
      expect(payload.stream).toBe(true);

      return new Response(
        createSSEStream([
          'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","status":"completed","revised_prompt":"A polished orange cat mascot.","result":"aW1hZ2UtZGF0YQ=="}}\n\n',
          'data: {"type":"response.done","response":{"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}\n\n',
        ]),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      );
    }));

    const result = await nativeCodexGenerateImage({
      prompt: 'orange cat mascot',
      model: 'gpt-5.5',
      size: '512x512',
    });

    expect(result).toEqual({
      model: 'gpt-5.5',
      size: '1024x1024',
      imageBase64: 'aW1hZ2UtZGF0YQ==',
      mimeType: 'image/png',
      revisedPrompt: 'A polished orange cat mascot.',
    });
  });
});
