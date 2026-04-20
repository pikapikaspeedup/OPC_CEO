/**
 * OpenAI Chat Completion SSE → Anthropic StreamEvent 适配器
 * 从 claude-code/src/services/api/openai/streamAdapter.ts 移植
 * 
 * 将 OpenAI 的 ChatCompletionChunk 流转换为与 Anthropic SSE 兼容的 StreamEvent，
 * 使下游代码完全不需要修改。
 */
import type { StreamEvent, TokenUsage } from '../types';

/**
 * OpenAI ChatCompletionChunk 的精简类型定义
 * 只定义我们实际使用的字段
 */
export type ChatCompletionChunk = {
  id: string;
  object: string;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
      /** DeepSeek reasoning content */
      reasoning_content?: string;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
};

/**
 * Adapt an OpenAI SSE stream (AsyncIterable<ChatCompletionChunk>) to
 * Anthropic StreamEvent format.
 */
export async function* adaptOpenAIStreamToAnthropic(
  stream: AsyncIterable<ChatCompletionChunk>,
  model: string,
): AsyncGenerator<StreamEvent> {
  let messageStarted = false;
  let contentBlockIndex = 0;
  let currentTextBlockOpen = false;
  let currentThinkingBlockOpen = false;
  const toolCallBlocks = new Map<number, { blockIndex: number; id: string; name: string }>();
  let usage: TokenUsage = { input_tokens: 0, output_tokens: 0 };

  for await (const chunk of stream) {
    // Emit message_start on first chunk
    if (!messageStarted) {
      messageStarted = true;
      yield {
        type: 'message_start',
        message: {
          id: chunk.id,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      };
    }

    const choice = chunk.choices?.[0];
    if (!choice) {
      // Usage-only chunk (final chunk with usage)
      if (chunk.usage) {
        usage = {
          input_tokens: chunk.usage.prompt_tokens ?? 0,
          output_tokens: chunk.usage.completion_tokens ?? 0,
        };
      }
      continue;
    }

    const delta = choice.delta;

    // Handle reasoning_content (DeepSeek thinking mode)
    if (delta.reasoning_content) {
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
        delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
      };
    }

    // Handle text content
    if (delta.content) {
      // Close thinking block if transitioning from thinking to text
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
        delta: { type: 'text_delta', text: delta.content },
      };
    }

    // Handle tool calls
    if (delta.tool_calls) {
      // Close text block if open
      if (currentTextBlockOpen) {
        yield { type: 'content_block_stop', index: contentBlockIndex };
        currentTextBlockOpen = false;
        contentBlockIndex++;
      }
      // Close thinking block if open
      if (currentThinkingBlockOpen) {
        yield { type: 'content_block_stop', index: contentBlockIndex };
        currentThinkingBlockOpen = false;
        contentBlockIndex++;
      }

      for (const tc of delta.tool_calls) {
        const tcIndex = tc.index;

        // New tool call
        if (tc.id && tc.function?.name) {
          const blockIdx = contentBlockIndex + tcIndex;
          toolCallBlocks.set(tcIndex, { blockIndex: blockIdx, id: tc.id, name: tc.function.name });
          yield {
            type: 'content_block_start',
            index: blockIdx,
            content_block: {
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: {},
            },
          };
        }

        // Tool call arguments delta
        if (tc.function?.arguments) {
          const entry = toolCallBlocks.get(tcIndex);
          if (entry) {
            yield {
              type: 'content_block_delta',
              index: entry.blockIndex,
              delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
            };
          }
        }
      }
    }

    // Handle finish
    if (choice.finish_reason) {
      // Close any open blocks
      if (currentTextBlockOpen) {
        yield { type: 'content_block_stop', index: contentBlockIndex };
        currentTextBlockOpen = false;
      }
      if (currentThinkingBlockOpen) {
        yield { type: 'content_block_stop', index: contentBlockIndex };
        currentThinkingBlockOpen = false;
      }
      for (const [, entry] of toolCallBlocks) {
        yield { type: 'content_block_stop', index: entry.blockIndex };
      }

      // Map OpenAI finish_reason to Anthropic stop_reason
      const stopReason = mapFinishReason(choice.finish_reason);

      // Update usage from final chunk
      if (chunk.usage) {
        usage = {
          input_tokens: chunk.usage.prompt_tokens ?? 0,
          output_tokens: chunk.usage.completion_tokens ?? 0,
        };
      }

      yield {
        type: 'message_delta',
        delta: { stop_reason: stopReason },
        usage,
      };

      yield { type: 'message_stop' };
    }
  }

  // If stream ended without finish_reason, close and emit stop
  if (messageStarted) {
    if (currentTextBlockOpen) {
      yield { type: 'content_block_stop', index: contentBlockIndex };
    }
    if (currentThinkingBlockOpen) {
      yield { type: 'content_block_stop', index: contentBlockIndex };
    }
  }
}

function mapFinishReason(reason: string): string {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'end_turn';
    default:
      return 'end_turn';
  }
}
