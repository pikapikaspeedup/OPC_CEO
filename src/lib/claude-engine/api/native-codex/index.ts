import { nativeCodexComplete, type ChatMessage, type FunctionTool } from '../../../bridge/native-codex-adapter';

import { APIClientError } from '../client';
import type { APIContentBlock, APITool, QueryOptions, StreamEvent, TokenUsage } from '../types';

function flattenTextBlocks(content: string | APIContentBlock[]): string {
  if (typeof content === 'string') {
    return content;
  }

  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      if (block.text.trim()) {
        parts.push(block.text);
      }
      continue;
    }

    if (block.type === 'tool_use') {
      parts.push([
        `<tool-use id="${block.id}" name="${block.name}">`,
        JSON.stringify(block.input),
        '</tool-use>',
      ].join('\n'));
      continue;
    }

    if (block.type === 'tool_result') {
      const nested = typeof block.content === 'string'
        ? block.content
        : flattenTextBlocks(block.content);
      parts.push([
        `<tool-result id="${block.tool_use_id}"${block.is_error ? ' error="true"' : ''}>`,
        nested,
        '</tool-result>',
      ].join('\n'));
      continue;
    }

    if (block.type === 'thinking' && block.thinking.trim()) {
      parts.push(block.thinking);
    }
  }

  return parts.join('\n\n').trim();
}

function toNativeCodexMessages(
  messages: QueryOptions['messages'],
  systemPrompt: string,
): ChatMessage[] {
  const converted: ChatMessage[] = [];

  if (systemPrompt.trim()) {
    converted.push({
      role: 'system',
      content: systemPrompt,
    });
  }

  for (const message of messages) {
    const content = flattenTextBlocks(message.content);
    if (!content.trim()) {
      continue;
    }

    converted.push({
      role: message.role,
      content,
    });
  }

  return converted;
}

function toNativeCodexTools(tools?: APITool[]): FunctionTool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

function buildUsage(usage: {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} | null): TokenUsage {
  return {
    input_tokens: usage?.promptTokens ?? 0,
    output_tokens: usage?.completionTokens ?? 0,
  };
}

function parseToolArguments(argumentsText: string): Record<string, unknown> {
  if (!argumentsText.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { __raw_arguments: argumentsText };
  }
}

function mapStopReason(
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error',
  toolCallCount: number,
): string | null {
  if (toolCallCount > 0 || finishReason === 'tool_calls') {
    return 'tool_use';
  }
  if (finishReason === 'length') {
    return 'max_tokens';
  }
  return 'end_turn';
}

export async function* streamQueryNativeCodex(
  options: QueryOptions,
): AsyncGenerator<StreamEvent> {
  const messageId = `native-codex-${Date.now()}`;

  try {
    const response = await nativeCodexComplete({
      messages: toNativeCodexMessages(options.messages, options.systemPrompt),
      model: options.model.model,
      tools: toNativeCodexTools(options.tools),
      signal: options.signal,
    });

    const usage = buildUsage(response.usage);
    yield {
      type: 'message_start',
      message: {
        id: messageId,
        usage,
      },
    };

    let blockIndex = 0;

    if (response.content?.trim()) {
      yield {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'text', text: '' },
      };
      yield {
        type: 'content_block_delta',
        index: blockIndex,
        delta: {
          type: 'text_delta',
          text: response.content,
        },
      };
      yield {
        type: 'content_block_stop',
        index: blockIndex,
      };
      blockIndex += 1;
    }

    for (const toolCall of response.toolCalls) {
      yield {
        type: 'content_block_start',
        index: blockIndex,
        content_block: {
          type: 'tool_use',
          id: toolCall.id || `native-codex-tool-${blockIndex}`,
          name: toolCall.function.name,
          input: parseToolArguments(toolCall.function.arguments),
        },
      };
      yield {
        type: 'content_block_stop',
        index: blockIndex,
      };
      blockIndex += 1;
    }

    yield {
      type: 'message_delta',
      delta: {
        stop_reason: mapStopReason(response.finishReason, response.toolCalls.length),
      },
      usage,
    };
    yield { type: 'message_stop' };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new APIClientError(`Native Codex request failed: ${message}`, {
      cause: error,
      statusCode: error && typeof error === 'object'
        && 'statusCode' in error
        && typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : undefined,
    });
  }
}
