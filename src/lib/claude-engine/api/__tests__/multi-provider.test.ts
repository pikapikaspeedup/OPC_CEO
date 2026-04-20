/**
 * 多 Provider 兼容层测试
 * 测试 OpenAI/Gemini/Grok 的消息转换、工具转换、流适配、模型映射
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

// OpenAI
import { anthropicMessagesToOpenAI } from '../openai/convertMessages';
import { anthropicToolsToOpenAI, anthropicToolChoiceToOpenAI } from '../openai/convertTools';
import { adaptOpenAIStreamToAnthropic, type ChatCompletionChunk } from '../openai/streamAdapter';
import { resolveOpenAIModel } from '../openai/modelMapping';
import { isOpenAIThinkingEnabled } from '../openai';

// Gemini
import { resolveGeminiModel } from '../gemini/modelMapping';
import { adaptGeminiStreamToAnthropic, type GeminiChunk } from '../gemini/streamAdapter';

// Grok
import { resolveGrokModel } from '../grok/modelMapping';

// Provider detection
import { detectProvider, FallbackTriggeredError } from '../retry';

// Helper to collect async generator
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

// Helper to create async iterable from array
async function* fromArray<T>(arr: T[]): AsyncGenerator<T> {
  for (const item of arr) yield item;
}

describe('OpenAI convertMessages', () => {
  test('converts system prompt', () => {
    const msgs = anthropicMessagesToOpenAI([], 'You are helpful');
    expect(msgs).toEqual([{ role: 'system', content: 'You are helpful' }]);
  });

  test('converts simple user/assistant messages', () => {
    const msgs = anthropicMessagesToOpenAI(
      [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
      '',
    );
    // No system msg since empty prompt
    expect(msgs.length).toBe(2);
    expect(msgs[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'Hi there' });
  });

  test('converts tool_use blocks to tool_calls', () => {
    const msgs = anthropicMessagesToOpenAI(
      [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me search...' },
            { type: 'tool_use', id: 'tc_1', name: 'search', input: { query: 'hello' } },
          ],
        },
      ],
      '',
    );
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[0].content).toBe('Let me search...');
    expect(msgs[0].tool_calls).toEqual([{
      id: 'tc_1',
      type: 'function',
      function: { name: 'search', arguments: '{"query":"hello"}' },
    }]);
  });

  test('converts tool_result blocks to tool messages', () => {
    const msgs = anthropicMessagesToOpenAI(
      [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tc_1', content: 'result data' },
            { type: 'text', text: 'Thanks!' },
          ],
        },
      ],
      '',
    );
    expect(msgs[0]).toEqual({ role: 'tool', content: 'result data', tool_call_id: 'tc_1' });
    expect(msgs[1]).toEqual({ role: 'user', content: 'Thanks!' });
  });

  test('strips thinking blocks when enableThinking is false', () => {
    const msgs = anthropicMessagesToOpenAI(
      [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'hmm...', signature: 'sig' },
            { type: 'text', text: 'Answer' },
          ],
        },
      ],
      '',
    );
    expect(msgs[0].reasoning_content).toBeUndefined();
    expect(msgs[0].content).toBe('Answer');
  });

  test('preserves reasoning_content when enableThinking is true', () => {
    const msgs = anthropicMessagesToOpenAI(
      [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'deep thought', signature: 'sig' },
            { type: 'text', text: 'Answer' },
          ],
        },
      ],
      '',
      { enableThinking: true },
    );
    expect(msgs[0].reasoning_content).toBe('deep thought');
  });
});

describe('OpenAI convertTools', () => {
  test('converts Anthropic tools to OpenAI function tools', () => {
    const result = anthropicToolsToOpenAI([
      { name: 'search', description: 'Search', input_schema: { type: 'object' } },
    ]);
    expect(result).toEqual([{
      type: 'function',
      function: {
        name: 'search',
        description: 'Search',
        parameters: { type: 'object' },
      },
    }]);
  });

  test('converts tool_choice types', () => {
    expect(anthropicToolChoiceToOpenAI({ type: 'auto' })).toBe('auto');
    expect(anthropicToolChoiceToOpenAI({ type: 'none' })).toBe('none');
    expect(anthropicToolChoiceToOpenAI({ type: 'any' })).toBe('required');
    expect(anthropicToolChoiceToOpenAI({ type: 'tool', name: 'foo' }))
      .toEqual({ type: 'function', function: { name: 'foo' } });
    expect(anthropicToolChoiceToOpenAI()).toBeUndefined();
  });
});

describe('OpenAI streamAdapter', () => {
  test('adapts text-only stream', async () => {
    const chunks: ChatCompletionChunk[] = [
      {
        id: 'chatcmpl-1', object: 'chat.completion.chunk', model: 'gpt-4o',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' } }],
      },
      {
        id: 'chatcmpl-1', object: 'chat.completion.chunk', model: 'gpt-4o',
        choices: [{ index: 0, delta: { content: ' World' } }],
      },
      {
        id: 'chatcmpl-1', object: 'chat.completion.chunk', model: 'gpt-4o',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    ];

    const events = await collect(adaptOpenAIStreamToAnthropic(fromArray(chunks), 'gpt-4o'));
    expect(events[0].type).toBe('message_start');
    expect(events[1].type).toBe('content_block_start');
    expect(events[2].type).toBe('content_block_delta');
    expect(events[3].type).toBe('content_block_delta');

    // Verify text content
    const deltas = events.filter(e => e.type === 'content_block_delta');
    expect((deltas[0] as any).delta.text).toBe('Hello');
    expect((deltas[1] as any).delta.text).toBe(' World');

    // Verify stop
    const msgDelta = events.find(e => e.type === 'message_delta');
    expect((msgDelta as any).delta.stop_reason).toBe('end_turn');
    expect((msgDelta as any).usage.input_tokens).toBe(10);
  });

  test('adapts tool call stream', async () => {
    const chunks: ChatCompletionChunk[] = [
      {
        id: 'chatcmpl-2', object: 'chat.completion.chunk', model: 'gpt-4o',
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0, id: 'call_1', type: 'function',
              function: { name: 'search', arguments: '' },
            }],
          },
        }],
      },
      {
        id: 'chatcmpl-2', object: 'chat.completion.chunk', model: 'gpt-4o',
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":"hi"}' } }] },
        }],
      },
      {
        id: 'chatcmpl-2', object: 'chat.completion.chunk', model: 'gpt-4o',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      },
    ];

    const events = await collect(adaptOpenAIStreamToAnthropic(fromArray(chunks), 'gpt-4o'));
    const blockStart = events.find(e => e.type === 'content_block_start' && (e as any).content_block?.type === 'tool_use');
    expect((blockStart as any).content_block.name).toBe('search');
    expect((blockStart as any).content_block.id).toBe('call_1');

    const inputDelta = events.find(e => e.type === 'content_block_delta' && (e as any).delta?.type === 'input_json_delta');
    expect((inputDelta as any).delta.partial_json).toBe('{"q":"hi"}');

    const msgDelta = events.find(e => e.type === 'message_delta');
    expect((msgDelta as any).delta.stop_reason).toBe('tool_use');
  });

  test('adapts DeepSeek thinking mode', async () => {
    const chunks: ChatCompletionChunk[] = [
      {
        id: 'chatcmpl-3', object: 'chat.completion.chunk', model: 'deepseek-reasoner',
        choices: [{ index: 0, delta: { reasoning_content: 'thinking...' } }],
      },
      {
        id: 'chatcmpl-3', object: 'chat.completion.chunk', model: 'deepseek-reasoner',
        choices: [{ index: 0, delta: { content: 'Answer!' } }],
      },
      {
        id: 'chatcmpl-3', object: 'chat.completion.chunk', model: 'deepseek-reasoner',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 15, total_tokens: 20 },
      },
    ];

    const events = await collect(adaptOpenAIStreamToAnthropic(fromArray(chunks), 'deepseek-reasoner'));
    const thinkStart = events.find(e => e.type === 'content_block_start' && (e as any).content_block?.type === 'thinking');
    expect(thinkStart).toBeDefined();

    const thinkDelta = events.find(e => e.type === 'content_block_delta' && (e as any).delta?.type === 'thinking_delta');
    expect((thinkDelta as any).delta.thinking).toBe('thinking...');
  });
});

describe('OpenAI modelMapping', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('maps claude models to openai defaults', () => {
    expect(resolveOpenAIModel('claude-sonnet-4-20250514')).toBe('gpt-4o');
    expect(resolveOpenAIModel('claude-3-5-haiku-20241022')).toBe('gpt-4o-mini');
  });

  test('OPENAI_MODEL overrides all', () => {
    process.env.OPENAI_MODEL = 'custom-model';
    expect(resolveOpenAIModel('claude-sonnet-4-20250514')).toBe('custom-model');
  });

  test('per-family override works', () => {
    process.env.OPENAI_DEFAULT_SONNET_MODEL = 'deepseek-chat';
    expect(resolveOpenAIModel('claude-sonnet-4-20250514')).toBe('deepseek-chat');
  });

  test('unknown model passes through', () => {
    expect(resolveOpenAIModel('unknown-model')).toBe('unknown-model');
  });
});

describe('OpenAI thinking detection', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('auto-detects DeepSeek', () => {
    expect(isOpenAIThinkingEnabled('deepseek-reasoner')).toBe(true);
    expect(isOpenAIThinkingEnabled('gpt-4o')).toBe(false);
  });

  test('env override', () => {
    process.env.OPENAI_ENABLE_THINKING = '1';
    expect(isOpenAIThinkingEnabled('gpt-4o')).toBe(true);
  });

  test('env explicit disable', () => {
    process.env.OPENAI_ENABLE_THINKING = '0';
    expect(isOpenAIThinkingEnabled('deepseek-reasoner')).toBe(false);
  });
});

describe('Gemini modelMapping', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('maps claude to gemini defaults', () => {
    expect(resolveGeminiModel('claude-opus-4-20250514')).toBe('gemini-2.5-pro');
    expect(resolveGeminiModel('claude-sonnet-4-20250514')).toBe('gemini-2.5-flash');
  });

  test('GEMINI_MODEL overrides all', () => {
    process.env.GEMINI_MODEL = 'gemini-custom';
    expect(resolveGeminiModel('claude-opus-4-20250514')).toBe('gemini-custom');
  });
});

describe('Gemini streamAdapter', () => {
  test('adapts text-only Gemini stream', async () => {
    const chunks: GeminiChunk[] = [
      {
        candidates: [{
          content: { parts: [{ text: 'Hello from Gemini' }], role: 'model' },
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0, totalTokenCount: 10 },
      },
      {
        candidates: [{
          content: { parts: [{ text: '!' }], role: 'model' },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      },
    ];

    const events = await collect(adaptGeminiStreamToAnthropic(fromArray(chunks), 'gemini-2.5-flash'));
    expect(events[0].type).toBe('message_start');

    const textDeltas = events.filter(e => e.type === 'content_block_delta');
    expect(textDeltas.length).toBe(2);
    expect((textDeltas[0] as any).delta.text).toBe('Hello from Gemini');

    const msgDelta = events.find(e => e.type === 'message_delta');
    expect((msgDelta as any).delta.stop_reason).toBe('end_turn');
  });

  test('adapts Gemini thinking mode', async () => {
    const chunks: GeminiChunk[] = [
      {
        candidates: [{
          content: { parts: [{ text: 'thinking...', thought: true }], role: 'model' },
        }],
      },
      {
        candidates: [{
          content: { parts: [{ text: 'Result' }], role: 'model' },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, totalTokenCount: 15 },
      },
    ];

    const events = await collect(adaptGeminiStreamToAnthropic(fromArray(chunks), 'gemini-2.5-pro'));
    const thinkStart = events.find(e => e.type === 'content_block_start' && (e as any).content_block?.type === 'thinking');
    expect(thinkStart).toBeDefined();
  });

  test('adapts Gemini function calls', async () => {
    const chunks: GeminiChunk[] = [
      {
        candidates: [{
          content: {
            parts: [{ functionCall: { name: 'get_weather', args: { city: 'Tokyo' } } }],
            role: 'model',
          },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, totalTokenCount: 15 },
      },
    ];

    const events = await collect(adaptGeminiStreamToAnthropic(fromArray(chunks), 'gemini-2.5-flash'));
    const toolStart = events.find(e => e.type === 'content_block_start' && (e as any).content_block?.type === 'tool_use');
    expect((toolStart as any).content_block.name).toBe('get_weather');
  });
});

describe('Grok modelMapping', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('maps claude to grok defaults', () => {
    expect(resolveGrokModel('claude-opus-4-20250514')).toBe('grok-3');
    expect(resolveGrokModel('claude-sonnet-4-20250514')).toBe('grok-3-mini');
  });

  test('GROK_MODEL overrides all', () => {
    process.env.GROK_MODEL = 'grok-custom';
    expect(resolveGrokModel('claude-opus-4-20250514')).toBe('grok-custom');
  });

  test('GROK_MODEL_MAP JSON override', () => {
    process.env.GROK_MODEL_MAP = '{"opus":"grok-4","sonnet":"grok-3"}';
    expect(resolveGrokModel('claude-opus-4-20250514')).toBe('grok-4');
    expect(resolveGrokModel('claude-sonnet-4-20250514')).toBe('grok-3');
  });
});

describe('detectProvider', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('defaults to anthropic', () => {
    delete process.env.CLAUDE_CODE_USE_OPENAI;
    delete process.env.CLAUDE_CODE_USE_GEMINI;
    delete process.env.CLAUDE_CODE_USE_GROK;
    expect(detectProvider()).toBe('anthropic');
  });

  test('detects openai', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1';
    expect(detectProvider()).toBe('openai');
  });

  test('detects gemini', () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1';
    expect(detectProvider()).toBe('gemini');
  });

  test('detects grok', () => {
    process.env.CLAUDE_CODE_USE_GROK = '1';
    expect(detectProvider()).toBe('grok');
  });
});

describe('FallbackTriggeredError', () => {
  test('creates with model info', () => {
    const err = new FallbackTriggeredError('claude-opus-4-20250514', 'claude-sonnet-4-20250514');
    expect(err.originalModel).toBe('claude-opus-4-20250514');
    expect(err.fallbackModel).toBe('claude-sonnet-4-20250514');
    expect(err.name).toBe('FallbackTriggeredError');
  });
});
