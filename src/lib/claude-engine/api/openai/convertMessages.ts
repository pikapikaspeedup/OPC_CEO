/**
 * Anthropic 消息格式 → OpenAI Chat Completion 消息格式转换
 * 从 claude-code/src/services/api/openai/convertMessages.ts 移植
 */
import type { APIMessage, APIContentBlock } from '../types';

export type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  /** DeepSeek thinking mode: reasoning content from previous turns */
  reasoning_content?: string;
};

export type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export function anthropicMessagesToOpenAI(
  messages: APIMessage[],
  systemPrompt: string | string[],
  options?: { enableThinking?: boolean },
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  // System prompt → system message
  const system = Array.isArray(systemPrompt)
    ? systemPrompt.filter(Boolean).join('\n\n')
    : systemPrompt;
  if (system) {
    result.push({ role: 'system', content: system });
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push(...convertUserMessage(msg));
    } else if (msg.role === 'assistant') {
      result.push(...convertAssistantMessage(msg, options));
    }
  }

  return result;
}

function convertUserMessage(msg: APIMessage): OpenAIMessage[] {
  if (typeof msg.content === 'string') {
    return [{ role: 'user', content: msg.content }];
  }

  const results: OpenAIMessage[] = [];
  const textParts: string[] = [];
  const toolResults: Array<{ tool_use_id: string; content: string; is_error?: boolean }> = [];

  for (const block of msg.content) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'tool_result') {
      const contentStr = typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
          ? block.content
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map(b => b.text)
              .join('\n')
          : '';
      toolResults.push({
        tool_use_id: block.tool_use_id,
        content: contentStr,
        is_error: block.is_error,
      });
    }
  }

  // Emit tool results as tool messages
  for (const tr of toolResults) {
    results.push({
      role: 'tool',
      content: tr.content,
      tool_call_id: tr.tool_use_id,
    });
  }

  // Emit text content as user message
  if (textParts.length > 0) {
    results.push({ role: 'user', content: textParts.join('\n') });
  }

  // If no text and no tool results, emit empty user message
  if (results.length === 0) {
    results.push({ role: 'user', content: '' });
  }

  return results;
}

function convertAssistantMessage(
  msg: APIMessage,
  options?: { enableThinking?: boolean },
): OpenAIMessage[] {
  if (typeof msg.content === 'string') {
    return [{ role: 'assistant', content: msg.content }];
  }

  const textParts: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];
  let reasoningContent: string | undefined;

  for (const block of msg.content) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: typeof block.input === 'string'
            ? block.input
            : JSON.stringify(block.input),
        },
      });
    } else if (block.type === 'thinking' && options?.enableThinking) {
      // Preserve thinking as reasoning_content for DeepSeek
      reasoningContent = block.thinking;
    }
    // Strip thinking blocks when enableThinking is false (default)
  }

  const result: OpenAIMessage = {
    role: 'assistant',
    content: textParts.length > 0 ? textParts.join('\n') : null,
  };

  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls;
  }

  if (reasoningContent) {
    result.reasoning_content = reasoningContent;
  }

  return [result];
}
