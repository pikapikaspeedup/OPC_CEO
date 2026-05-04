import { streamQueryWithRetry } from '../api/retry';
import type { APIMessage, ModelConfig } from '../api/types';

/**
 * Estimate token count for a message array.
 * Uses a rough heuristic (4 chars ≈ 1 token) — good enough for preemptive checks.
 */
export function estimateTokenCount(messages: APIMessage[]): number {
  let totalChars = 0;

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text') {
          totalChars += (block.text ?? '').length;
        } else if (block.type === 'thinking') {
          totalChars += (block.thinking ?? '').length;
        } else if (block.type === 'tool_use') {
          totalChars += JSON.stringify(block.input ?? {}).length;
        } else if (block.type === 'tool_result') {
          totalChars += (typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '')).length;
        }
      }
    }
  }

  return Math.ceil(totalChars / 4);
}

/**
 * Compact conversation history by summarizing old turns.
 *
 * Strategy:
 * 1. Keep first message (user's original prompt) and last N messages (recent context)
 * 2. Summarize middle messages into a compact system-injected message
 * 3. If an API key is available, use Claude Haiku for summarization
 * 4. Otherwise, do a simple extractive summary
 */
export async function compactMessages(
  messages: APIMessage[],
  options: {
    model?: ModelConfig;
    keepLastN?: number;
    targetTokens?: number;
    /** Target ratio of original message count to keep after compaction (default: 0.3) */
    targetRatio?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ compacted: APIMessage[]; removedCount: number; summaryTokens: number }> {
  const keepLastN = options.keepLastN ?? 6;

  if (messages.length <= keepLastN + 1) {
    return { compacted: messages, removedCount: 0, summaryTokens: 0 };
  }

  const firstMessage = messages[0];
  const middleMessages = messages.slice(1, messages.length - keepLastN);
  const recentMessages = messages.slice(messages.length - keepLastN);

  if (middleMessages.length === 0) {
    return { compacted: messages, removedCount: 0, summaryTokens: 0 };
  }

  let summary: string;

  if (options.model?.apiKey || options.model?.providerId === 'native-codex') {
    summary = await apiSummarize(middleMessages, options.model, options.signal);
  } else {
    summary = extractiveSummarize(middleMessages);
  }

  const summaryMessage: APIMessage = {
    role: 'user',
    content: `[Compacted context — ${middleMessages.length} earlier messages summarized]\n\n${summary}`,
  };

  const compacted = [firstMessage, summaryMessage, ...recentMessages];
  const summaryTokens = estimateTokenCount([summaryMessage]);

  return {
    compacted,
    removedCount: middleMessages.length,
    summaryTokens,
  };
}

/**
 * Use Haiku to summarize middle messages
 */
async function apiSummarize(
  messages: APIMessage[],
  model: ModelConfig,
  signal?: AbortSignal,
): Promise<string> {
  const formatted = messages.map(formatMessageForSummary).join('\n\n');
  const prompt = `Summarize this conversation excerpt concisely. Focus on: decisions made, tools used and their results, key facts discovered. Be brief but preserve critical context.\n\n${formatted}`;

  const summaryModel: ModelConfig = {
    ...model,
    model: 'claude-3-5-haiku-20241022',
    maxOutputTokens: 1024,
  };

  try {
    const chunks: string[] = [];

    for await (const event of streamQueryWithRetry({
      model: summaryModel,
      systemPrompt: 'You are a conversation summarizer. Be extremely concise.',
      messages: [{ role: 'user', content: prompt }],
      tools: [],
      signal,
    })) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        chunks.push(event.delta.text);
      }
    }

    return chunks.join('') || extractiveSummarize(messages);
  } catch {
    return extractiveSummarize(messages);
  }
}

/**
 * Fallback extractive summary — grab text blocks from messages
 */
function extractiveSummarize(messages: APIMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      parts.push(`[${msg.role}]: ${msg.content.slice(0, 200)}`);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          parts.push(`[${msg.role}]: ${block.text.slice(0, 200)}`);
        } else if (block.type === 'tool_use') {
          parts.push(`[tool_use: ${block.name}]`);
        } else if (block.type === 'tool_result') {
          const content = typeof block.content === 'string' ? block.content : '';
          parts.push(`[tool_result]: ${content.slice(0, 100)}`);
        }
      }
    }
  }

  return parts.join('\n');
}

function formatMessageForSummary(msg: APIMessage): string {
  if (typeof msg.content === 'string') {
    return `${msg.role}: ${msg.content}`;
  }

  if (!Array.isArray(msg.content)) {
    return `${msg.role}: [empty]`;
  }

  const parts: string[] = [];

  for (const block of msg.content) {
    if (block.type === 'text') {
      parts.push(block.text ?? '');
    } else if (block.type === 'tool_use') {
      parts.push(`[Used tool: ${block.name}(${JSON.stringify(block.input).slice(0, 200)})]`);
    } else if (block.type === 'tool_result') {
      const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
      parts.push(`[Tool result: ${content.slice(0, 200)}]`);
    }
  }

  return `${msg.role}: ${parts.join(' ')}`;
}
