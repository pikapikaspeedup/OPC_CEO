/**
 * Prompt 缓存控制
 * 从 claude-code/src/services/api/claude.ts getCacheControl() 移植
 * 
 * 在 Anthropic API 中，cache_control 标记可以让系统提示和早期消息保持在 KV 缓存中，
 * 减少重复 token 处理。其他 provider（OpenAI/Gemini）原生不支持此特性，但会被自动忽略。
 * 
 * 使用方式：
 * - 对系统提示的最后一个 block 添加 cache_control
 * - 对最近一轮用户消息的最后一个 block 添加 cache_control
 * - 通常 1 个请求最多 2-3 个 cache_control 标记
 */

import type { APIMessage, APIContentBlock } from './types';

export type CacheControl = {
  type: 'ephemeral';
  ttl?: '1h';
};

/**
 * Get default cache_control marker.
 */
export function getCacheControl(opts?: { longTTL?: boolean }): CacheControl {
  return {
    type: 'ephemeral',
    ...(opts?.longTTL && { ttl: '1h' }),
  };
}

/**
 * Content block with optional cache_control.
 */
export type CachedContentBlock = APIContentBlock & {
  cache_control?: CacheControl;
};

/**
 * Add cache_control markers to system prompt blocks.
 * Marks the last block with ephemeral cache.
 */
export function addCacheToSystemBlocks(
  blocks: Array<{ type: 'text'; text: string }>,
  options?: { longTTL?: boolean },
): Array<{ type: 'text'; text: string; cache_control?: CacheControl }> {
  if (blocks.length === 0) return blocks;

  return blocks.map((block, i) => {
    if (i === blocks.length - 1) {
      return { ...block, cache_control: getCacheControl(options) };
    }
    return block;
  });
}

/**
 * Add cache_control to the last content block of user messages.
 * Only adds to the N most recent user messages (default 1).
 * 
 * @param messages - All conversation messages
 * @param cacheCount - Number of recent user messages to cache (default 1)
 * @returns Messages with cache_control added
 */
export function addCacheBreakpoints(
  messages: APIMessage[],
  cacheCount: number = 1,
  options?: { longTTL?: boolean },
): APIMessage[] {
  // Find the last N user message indices
  const userIndices: number[] = [];
  for (let i = messages.length - 1; i >= 0 && userIndices.length < cacheCount; i--) {
    if (messages[i].role === 'user') {
      userIndices.push(i);
    }
  }

  return messages.map((msg, idx) => {
    if (!userIndices.includes(idx)) return msg;

    // Add cache_control to the last content block
    if (typeof msg.content === 'string') {
      return {
        role: msg.role,
        content: [{
          type: 'text' as const,
          text: msg.content,
          cache_control: getCacheControl(options),
        }],
      };
    }

    if (!Array.isArray(msg.content) || msg.content.length === 0) return msg;

    return {
      role: msg.role,
      content: msg.content.map((block, i) => {
        if (i === msg.content.length - 1) {
          return { ...block, cache_control: getCacheControl(options) } as CachedContentBlock;
        }
        return block;
      }),
    };
  });
}

/**
 * Estimate cache savings from usage data.
 * Anthropic returns cache_creation_input_tokens and cache_read_input_tokens.
 */
export function estimateCacheSavings(usage: {
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  input_tokens: number;
}): {
  cacheHitRate: number;
  tokensSaved: number;
  costReductionPercent: number;
} {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const totalInput = usage.input_tokens + cacheRead;

  if (totalInput === 0) {
    return { cacheHitRate: 0, tokensSaved: 0, costReductionPercent: 0 };
  }

  const cacheHitRate = totalInput > 0 ? cacheRead / totalInput : 0;
  // Cache reads cost 10% of normal input tokens
  const tokensSaved = Math.round(cacheRead * 0.9);
  const costReductionPercent = Math.round(cacheHitRate * 90);

  return { cacheHitRate, tokensSaved, costReductionPercent };
}
