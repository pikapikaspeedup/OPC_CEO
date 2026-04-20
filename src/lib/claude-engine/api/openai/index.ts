/**
 * OpenAI 兼容层入口
 * 从 claude-code/src/services/api/openai/index.ts 移植
 * 
 * 支持 OpenAI、DeepSeek、Ollama、vLLM 等任意 OpenAI Chat Completions 协议端点。
 * 
 * 环境变量:
 * - CLAUDE_CODE_USE_OPENAI=1    启用 OpenAI 兼容模式
 * - OPENAI_API_KEY              API Key
 * - OPENAI_BASE_URL             自定义端点（默认 https://api.openai.com/v1）
 * - OPENAI_MODEL                全局模型覆盖
 * - OPENAI_ENABLE_THINKING      启用 DeepSeek 思考模式（自动检测 deepseek-reasoner）
 */

import type { QueryOptions, StreamEvent } from '../types';
import { APIClientError } from '../client';
import { resolveOpenAIModel } from './modelMapping';
import { anthropicMessagesToOpenAI } from './convertMessages';
import { anthropicToolsToOpenAI, anthropicToolChoiceToOpenAI } from './convertTools';
import { adaptOpenAIStreamToAnthropic, type ChatCompletionChunk } from './streamAdapter';

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * Detect whether DeepSeek-style thinking mode should be enabled.
 */
export function isOpenAIThinkingEnabled(model: string): boolean {
  const envVal = process.env.OPENAI_ENABLE_THINKING;
  if (envVal === '0' || envVal === 'false' || envVal === 'no') return false;
  if (envVal === '1' || envVal === 'true' || envVal === 'yes') return true;
  const modelLower = model.toLowerCase();
  return modelLower.includes('deepseek-reasoner') || modelLower.includes('deepseek-v3.2');
}

/**
 * Query an OpenAI-compatible endpoint with Anthropic-format messages/tools.
 * Converts inputs to OpenAI format, calls the endpoint, and converts the
 * SSE stream back to Anthropic StreamEvent for consumption by the existing pipeline.
 */
export async function* streamQueryOpenAI(
  options: QueryOptions,
): AsyncGenerator<StreamEvent> {
  const apiKey = process.env.OPENAI_API_KEY ?? options.model.apiKey;
  const baseUrl = (process.env.OPENAI_BASE_URL ?? options.model.baseUrl ?? DEFAULT_OPENAI_BASE_URL)
    .replace(/\/+$/, '');

  if (!apiKey) {
    throw new APIClientError('OPENAI_API_KEY is required for OpenAI provider', {
      statusCode: 401,
    });
  }

  // 1. Resolve model
  const openaiModel = resolveOpenAIModel(options.model.model);
  const enableThinking = isOpenAIThinkingEnabled(openaiModel);

  // 2. Convert messages and tools
  const openaiMessages = anthropicMessagesToOpenAI(
    options.messages,
    options.systemPrompt,
    { enableThinking },
  );
  const openaiTools = options.tools
    ? anthropicToolsToOpenAI(options.tools)
    : [];

  // 3. Build request body
  const body: Record<string, unknown> = {
    model: openaiModel,
    messages: openaiMessages,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (openaiTools.length > 0) {
    body.tools = openaiTools;
    const toolChoice = anthropicToolChoiceToOpenAI();
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
  }

  if (enableThinking) {
    body.thinking = { type: 'enabled' };
    body.enable_thinking = true;
    body.chat_template_kwargs = { thinking: true };
  }

  if (options.model.temperature !== undefined && !enableThinking) {
    body.temperature = options.model.temperature;
  }

  if (options.maxOutputTokens) {
    body.max_tokens = options.maxOutputTokens;
  }

  // 4. Make streaming request
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
      `OpenAI API request failed (${response.status}): ${errorBody}`,
      { statusCode: response.status, responseBody: errorBody },
    );
  }

  if (!response.body) {
    throw new APIClientError('OpenAI API returned no response body');
  }

  // 5. Parse SSE stream into ChatCompletionChunk objects
  const chunkStream = parseOpenAISSE(response.body);

  // 6. Adapt to Anthropic StreamEvent
  yield* adaptOpenAIStreamToAnthropic(chunkStream, openaiModel);
}

/**
 * Parse OpenAI-style SSE (data: {...}\n\n) into ChatCompletionChunk objects.
 */
async function* parseOpenAISSE(
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
          const json = trimmed.slice(6);
          try {
            yield JSON.parse(json) as ChatCompletionChunk;
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
