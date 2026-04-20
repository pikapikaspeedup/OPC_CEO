/**
 * Gemini 兼容层入口
 * 从 claude-code/src/services/api/gemini/index.ts 移植
 * 
 * 使用 Gemini REST API (generateContent) 的流式端点。
 * 
 * 环境变量:
 * - CLAUDE_CODE_USE_GEMINI=1   启用 Gemini 模式
 * - GEMINI_API_KEY             API Key（必填）
 * - GEMINI_MODEL               全局模型覆盖
 */

import type { QueryOptions, StreamEvent, APIMessage, APIContentBlock } from '../types';
import { APIClientError } from '../client';
import { resolveGeminiModel } from './modelMapping';
import { adaptGeminiStreamToAnthropic, type GeminiChunk } from './streamAdapter';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export async function* streamQueryGemini(
  options: QueryOptions,
): AsyncGenerator<StreamEvent> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new APIClientError('GEMINI_API_KEY is required for Gemini provider', {
      statusCode: 401,
    });
  }

  const model = resolveGeminiModel(options.model.model);

  // Build Gemini request
  const contents = anthropicMessagesToGemini(options.messages);
  const tools = options.tools?.map(t => ({
    functionDeclarations: [{
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    }],
  })) ?? [];

  const body: Record<string, unknown> = {
    contents,
    ...(options.systemPrompt && {
      systemInstruction: { parts: [{ text: options.systemPrompt }] },
    }),
    ...(tools.length > 0 && { tools }),
    generationConfig: {
      ...(options.maxOutputTokens && { maxOutputTokens: options.maxOutputTokens }),
      ...(options.model.temperature !== undefined && { temperature: options.model.temperature }),
      ...(options.thinking?.type === 'enabled' && {
        thinkingConfig: { thinkingBudget: options.thinking.budgetTokens },
      }),
    },
  };

  const url = `${GEMINI_API_BASE}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new APIClientError(
      `Gemini API request failed (${response.status}): ${errorBody}`,
      { statusCode: response.status, responseBody: errorBody },
    );
  }

  if (!response.body) {
    throw new APIClientError('Gemini API returned no response body');
  }

  const chunkStream = parseGeminiSSE(response.body);
  yield* adaptGeminiStreamToAnthropic(chunkStream, model);
}

/**
 * Convert Anthropic messages to Gemini format.
 */
function anthropicMessagesToGemini(
  messages: APIMessage[],
): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
  return messages.map(msg => {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts = contentToGeminiParts(msg.content);
    return { role, parts };
  });
}

function contentToGeminiParts(
  content: string | APIContentBlock[],
): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return [{ text: content }];
  }

  const parts: Array<Record<string, unknown>> = [];
  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ text: block.text });
    } else if (block.type === 'tool_use') {
      parts.push({
        functionCall: {
          name: block.name,
          args: block.input,
        },
      });
    } else if (block.type === 'tool_result') {
      const text = typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
          ? block.content
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map(b => b.text)
              .join('\n')
          : '';
      parts.push({
        functionResponse: {
          name: 'tool_result',
          response: { content: text },
        },
      });
    }
    // Skip thinking blocks
  }
  return parts.length > 0 ? parts : [{ text: '' }];
}

/**
 * Parse Gemini SSE stream.
 */
async function* parseGeminiSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<GeminiChunk> {
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
        if (trimmed.startsWith('data: ')) {
          const json = trimmed.slice(6);
          try {
            yield JSON.parse(json) as GeminiChunk;
          } catch {
            // Skip malformed
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
