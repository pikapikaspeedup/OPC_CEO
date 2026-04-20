/**
 * Gemini 流适配器 — Gemini REST API SSE → Anthropic StreamEvent
 * 从 claude-code/src/services/api/gemini/streamAdapter.ts 移植
 */
import type { StreamEvent, TokenUsage } from '../types';

/** Gemini generateContent 响应 chunk 类型 */
export type GeminiChunk = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: { name: string; args: Record<string, unknown> };
        thought?: boolean;
      }>;
      role?: string;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
};

export async function* adaptGeminiStreamToAnthropic(
  stream: AsyncIterable<GeminiChunk>,
  model: string,
): AsyncGenerator<StreamEvent> {
  let messageStarted = false;
  let contentBlockIndex = 0;
  let currentTextBlockOpen = false;
  let currentThinkingBlockOpen = false;
  let usage: TokenUsage = { input_tokens: 0, output_tokens: 0 };

  for await (const chunk of stream) {
    if (!messageStarted) {
      messageStarted = true;
      const initialUsage: TokenUsage = {
        input_tokens: chunk.usageMetadata?.promptTokenCount ?? 0,
        output_tokens: 0,
      };
      yield {
        type: 'message_start',
        message: { id: `gem-${Date.now()}`, usage: initialUsage },
      };
      usage = initialUsage;
    }

    const candidate = chunk.candidates?.[0];
    if (!candidate?.content?.parts) {
      // Usage-only chunk
      if (chunk.usageMetadata) {
        usage = {
          input_tokens: chunk.usageMetadata.promptTokenCount ?? usage.input_tokens,
          output_tokens: chunk.usageMetadata.candidatesTokenCount ?? usage.output_tokens,
        };
      }
      continue;
    }

    for (const part of candidate.content.parts) {
      // Thinking part
      if (part.thought && part.text) {
        if (!currentThinkingBlockOpen) {
          currentThinkingBlockOpen = true;
          yield {
            type: 'content_block_start',
            index: contentBlockIndex,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          };
        }
        yield {
          type: 'content_block_delta',
          index: contentBlockIndex,
          delta: { type: 'thinking_delta', thinking: part.text },
        };
        continue;
      }

      // Text part
      if (part.text !== undefined) {
        if (currentThinkingBlockOpen) {
          yield { type: 'content_block_stop', index: contentBlockIndex };
          currentThinkingBlockOpen = false;
          contentBlockIndex++;
        }
        if (!currentTextBlockOpen) {
          currentTextBlockOpen = true;
          yield {
            type: 'content_block_start',
            index: contentBlockIndex,
            content_block: { type: 'text', text: '' },
          };
        }
        yield {
          type: 'content_block_delta',
          index: contentBlockIndex,
          delta: { type: 'text_delta', text: part.text },
        };
        continue;
      }

      // Function call
      if (part.functionCall) {
        if (currentTextBlockOpen) {
          yield { type: 'content_block_stop', index: contentBlockIndex };
          currentTextBlockOpen = false;
          contentBlockIndex++;
        }
        if (currentThinkingBlockOpen) {
          yield { type: 'content_block_stop', index: contentBlockIndex };
          currentThinkingBlockOpen = false;
          contentBlockIndex++;
        }
        const toolId = `tool_${contentBlockIndex}_${Date.now()}`;
        yield {
          type: 'content_block_start',
          index: contentBlockIndex,
          content_block: {
            type: 'tool_use',
            id: toolId,
            name: part.functionCall.name,
            input: {},
          },
        };
        yield {
          type: 'content_block_delta',
          index: contentBlockIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: JSON.stringify(part.functionCall.args),
          },
        };
        yield { type: 'content_block_stop', index: contentBlockIndex };
        contentBlockIndex++;
      }
    }

    // Handle finish
    if (candidate.finishReason) {
      if (currentTextBlockOpen) {
        yield { type: 'content_block_stop', index: contentBlockIndex };
        currentTextBlockOpen = false;
      }
      if (currentThinkingBlockOpen) {
        yield { type: 'content_block_stop', index: contentBlockIndex };
        currentThinkingBlockOpen = false;
      }

      if (chunk.usageMetadata) {
        usage = {
          input_tokens: chunk.usageMetadata.promptTokenCount ?? usage.input_tokens,
          output_tokens: chunk.usageMetadata.candidatesTokenCount ?? usage.output_tokens,
        };
      }

      const stopReason = mapGeminiFinishReason(candidate.finishReason);
      yield { type: 'message_delta', delta: { stop_reason: stopReason }, usage };
      yield { type: 'message_stop' };
    }
  }
}

function mapGeminiFinishReason(reason: string): string {
  switch (reason) {
    case 'STOP': return 'end_turn';
    case 'MAX_TOKENS': return 'max_tokens';
    case 'SAFETY': return 'end_turn';
    default: return 'end_turn';
  }
}
