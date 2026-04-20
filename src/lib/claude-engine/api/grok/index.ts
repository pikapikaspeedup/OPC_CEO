/**
 * Grok (xAI) 兼容层入口
 * Grok 使用 OpenAI-compatible API，复用 OpenAI 的流适配器。
 * 
 * 环境变量:
 * - CLAUDE_CODE_USE_GROK=1    启用 Grok 模式
 * - GROK_API_KEY              API Key
 * - GROK_BASE_URL             自定义端点（默认 https://api.x.ai/v1）
 * - GROK_MODEL                全局模型覆盖
 */

import type { QueryOptions, StreamEvent } from '../types';
import { APIClientError } from '../client';
import { resolveGrokModel } from './modelMapping';
import { anthropicMessagesToOpenAI } from '../openai/convertMessages';
import { anthropicToolsToOpenAI, anthropicToolChoiceToOpenAI } from '../openai/convertTools';
import { adaptOpenAIStreamToAnthropic, type ChatCompletionChunk } from '../openai/streamAdapter';

const DEFAULT_GROK_BASE_URL = 'https://api.x.ai/v1';

export async function* streamQueryGrok(
  options: QueryOptions,
): AsyncGenerator<StreamEvent> {
  const apiKey = process.env.GROK_API_KEY;
  const baseUrl = (process.env.GROK_BASE_URL ?? DEFAULT_GROK_BASE_URL).replace(/\/+$/, '');

  if (!apiKey) {
    throw new APIClientError('GROK_API_KEY is required for Grok provider', {
      statusCode: 401,
    });
  }

  const model = resolveGrokModel(options.model.model);

  // Convert messages and tools (reuse OpenAI converters)
  const openaiMessages = anthropicMessagesToOpenAI(options.messages, options.systemPrompt);
  const openaiTools = options.tools ? anthropicToolsToOpenAI(options.tools) : [];

  const body: Record<string, unknown> = {
    model,
    messages: openaiMessages,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (openaiTools.length > 0) {
    body.tools = openaiTools;
    const toolChoice = anthropicToolChoiceToOpenAI();
    if (toolChoice) body.tool_choice = toolChoice;
  }

  if (options.model.temperature !== undefined) {
    body.temperature = options.model.temperature;
  }

  if (options.maxOutputTokens) {
    body.max_tokens = options.maxOutputTokens;
  }

  const url = `${baseUrl}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new APIClientError(
      `Grok API request failed (${response.status}): ${errorBody}`,
      { statusCode: response.status, responseBody: errorBody },
    );
  }

  if (!response.body) {
    throw new APIClientError('Grok API returned no response body');
  }

  const chunkStream = parseGrokSSE(response.body);
  yield* adaptOpenAIStreamToAnthropic(chunkStream, model);
}

async function* parseGrokSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatCompletionChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') return;
        if (trimmed.startsWith('data: ')) {
          try {
            yield JSON.parse(trimmed.slice(6)) as ChatCompletionChunk;
          } catch { /* skip */ }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
