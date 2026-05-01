/**
 * API 错误分类 + 连接错误处理 + 缓存控制 测试
 */
import { describe, test, expect } from 'vitest';
import {
  classifyAPIError,
  formatAPIError,
  isRetryableError,
  is529Error,
  isStaleConnectionError,
  extractConnectionErrorDetails,
  getRetryAfterSeconds,
  getRateLimitResetDelayMs,
  parsePromptTooLongTokens,
} from '../errors';
import {
  getCacheControl,
  addCacheToSystemBlocks,
  addCacheBreakpoints,
  estimateCacheSavings,
} from '../caching';
import { APIClientError } from '../api-client-error';

// ─── Error Classification ────────────────────────────────────────────────────

describe('classifyAPIError', () => {
  test('classifies abort errors', () => {
    const error = new DOMException('The operation was aborted', 'AbortError');
    expect(classifyAPIError(error)).toBe('aborted');
  });

  test('classifies timeout errors', () => {
    expect(classifyAPIError(new Error('Connection timeout'))).toBe('api_timeout');
    expect(classifyAPIError(new APIClientError('fail', { statusCode: 408 }))).toBe('api_timeout');
  });

  test('classifies rate limit 429', () => {
    expect(classifyAPIError(new APIClientError('rate limited', { statusCode: 429 }))).toBe('rate_limit');
  });

  test('classifies server overload 529', () => {
    expect(classifyAPIError(new APIClientError('overloaded', { statusCode: 529 }))).toBe('server_overload');
  });

  test('classifies 529 from message body', () => {
    expect(classifyAPIError(new Error('"type":"overloaded_error"'))).toBe('server_overload');
  });

  test('classifies prompt too long', () => {
    expect(classifyAPIError(new Error('prompt is too long: 150000 tokens > 128000'))).toBe('prompt_too_long');
  });

  test('classifies max_tokens overflow', () => {
    expect(classifyAPIError(new Error('input length and `max_tokens` exceed context limit: 100000 + 50000 > 128000')))
      .toBe('max_tokens_overflow');
  });

  test('classifies tool_use mismatch', () => {
    expect(classifyAPIError(new Error('`tool_use` ids were found without `tool_result` blocks immediately after')))
      .toBe('tool_use_mismatch');
    expect(classifyAPIError(new Error('`tool_use` ids must be unique')))
      .toBe('tool_use_mismatch');
  });

  test('classifies invalid model', () => {
    expect(classifyAPIError(new Error('Invalid model name: foo-bar'))).toBe('invalid_model');
  });

  test('classifies API key errors', () => {
    expect(classifyAPIError(new Error('x-api-key header is required'))).toBe('invalid_api_key');
  });

  test('classifies auth errors', () => {
    expect(classifyAPIError(new APIClientError('forbidden', { statusCode: 401 }))).toBe('auth_error');
    expect(classifyAPIError(new APIClientError('forbidden', { statusCode: 403 }))).toBe('auth_error');
  });

  test('classifies server errors', () => {
    expect(classifyAPIError(new APIClientError('fail', { statusCode: 500 }))).toBe('server_error');
    expect(classifyAPIError(new APIClientError('fail', { statusCode: 502 }))).toBe('server_error');
  });

  test('classifies client errors', () => {
    expect(classifyAPIError(new APIClientError('fail', { statusCode: 400 }))).toBe('client_error');
  });

  test('classifies connection errors from message', () => {
    expect(classifyAPIError(new Error('fetch failed'))).toBe('connection_error');
  });

  test('classifies SSL errors via cause chain', () => {
    const root = new Error('SSL error');
    (root as unknown as { code: string }).code = 'CERT_HAS_EXPIRED';
    const wrapper = new Error('Connection failed', { cause: root });
    expect(classifyAPIError(wrapper)).toBe('ssl_cert_error');
  });

  test('classifies connection reset via cause chain', () => {
    const root = new Error('connection reset');
    (root as unknown as { code: string }).code = 'ECONNRESET';
    const wrapper = new Error('request failed', { cause: root });
    expect(classifyAPIError(wrapper)).toBe('connection_reset');
  });

  test('returns unknown for unrecognized errors', () => {
    expect(classifyAPIError(new Error('something weird'))).toBe('unknown');
  });
});

// ─── formatAPIError ──────────────────────────────────────────────────────────

describe('formatAPIError', () => {
  test('formats rate limit with retry hint', () => {
    const msg = formatAPIError(new APIClientError('rate limited', { statusCode: 429 }));
    expect(msg).toContain('Rate limited');
    expect(msg).toContain('429');
  });

  test('formats server overload', () => {
    const msg = formatAPIError(new APIClientError('overloaded', { statusCode: 529 }));
    expect(msg).toContain('overloaded');
  });

  test('formats prompt too long with token info', () => {
    const msg = formatAPIError(new Error('prompt is too long: 150000 tokens > 128000'));
    expect(msg).toContain('150000');
    expect(msg).toContain('128000');
  });

  test('formats SSL error with actionable hint', () => {
    const root = new Error('SSL error');
    (root as unknown as { code: string }).code = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
    const wrapper = new Error('Connection failed', { cause: root });
    const msg = formatAPIError(wrapper);
    expect(msg).toContain('SSL');
    expect(msg).toContain('NODE_EXTRA_CA_CERTS');
  });

  test('formats connection reset', () => {
    const root = new Error('reset');
    (root as unknown as { code: string }).code = 'ECONNRESET';
    const wrapper = new Error('fail', { cause: root });
    expect(formatAPIError(wrapper)).toContain('Connection was reset');
  });

  test('sanitizes HTML in error message', () => {
    const msg = formatAPIError(new Error('<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head></html>'));
    expect(msg).toContain('502 Bad Gateway');
    expect(msg).not.toContain('<html');
  });
});

// ─── Retry helpers ───────────────────────────────────────────────────────────

describe('isRetryableError', () => {
  test('429 is retryable', () => {
    expect(isRetryableError(new APIClientError('', { statusCode: 429 }))).toBe(true);
  });

  test('529 is retryable', () => {
    expect(isRetryableError(new APIClientError('', { statusCode: 529 }))).toBe(true);
  });

  test('500 is retryable', () => {
    expect(isRetryableError(new APIClientError('', { statusCode: 500 }))).toBe(true);
  });

  test('timeout is retryable', () => {
    expect(isRetryableError(new Error('Request timeout'))).toBe(true);
  });

  test('connection error is retryable', () => {
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
  });

  test('400 is NOT retryable', () => {
    expect(isRetryableError(new APIClientError('bad request', { statusCode: 400 }))).toBe(false);
  });

  test('invalid model is NOT retryable', () => {
    expect(isRetryableError(new Error('Invalid model name'))).toBe(false);
  });

  test('auth error is NOT retryable', () => {
    expect(isRetryableError(new APIClientError('', { statusCode: 401 }))).toBe(false);
  });
});

describe('is529Error', () => {
  test('detects 529 status code', () => {
    expect(is529Error(new APIClientError('', { statusCode: 529 }))).toBe(true);
  });

  test('detects overloaded_error in message', () => {
    expect(is529Error(new Error('"type":"overloaded_error"'))).toBe(true);
  });

  test('does not false-positive on 500', () => {
    expect(is529Error(new APIClientError('', { statusCode: 500 }))).toBe(false);
  });
});

describe('isStaleConnectionError', () => {
  test('detects ECONNRESET', () => {
    const root = new Error('');
    (root as unknown as { code: string }).code = 'ECONNRESET';
    expect(isStaleConnectionError(new Error('fail', { cause: root }))).toBe(true);
  });

  test('detects EPIPE', () => {
    const root = new Error('');
    (root as unknown as { code: string }).code = 'EPIPE';
    expect(isStaleConnectionError(new Error('fail', { cause: root }))).toBe(true);
  });
});

// ─── Connection Error Details ────────────────────────────────────────────────

describe('extractConnectionErrorDetails', () => {
  test('extracts error code from root cause', () => {
    const root = new Error('connection refused');
    (root as unknown as { code: string }).code = 'ECONNREFUSED';
    const wrapper = new Error('request failed', { cause: root });
    const details = extractConnectionErrorDetails(wrapper);
    expect(details).not.toBeNull();
    expect(details!.code).toBe('ECONNREFUSED');
    expect(details!.isSSLError).toBe(false);
  });

  test('identifies SSL errors', () => {
    const root = new Error('cert expired');
    (root as unknown as { code: string }).code = 'CERT_HAS_EXPIRED';
    const details = extractConnectionErrorDetails(new Error('fail', { cause: root }));
    expect(details!.isSSLError).toBe(true);
  });

  test('returns null for non-connection errors', () => {
    expect(extractConnectionErrorDetails(new Error('regular error'))).toBeNull();
    expect(extractConnectionErrorDetails(null)).toBeNull();
    expect(extractConnectionErrorDetails(undefined)).toBeNull();
  });

  test('handles deeply nested cause chains', () => {
    const root = new Error('deep');
    (root as unknown as { code: string }).code = 'ETIMEDOUT';
    const mid = new Error('mid', { cause: root });
    const outer = new Error('outer', { cause: mid });
    const details = extractConnectionErrorDetails(outer);
    expect(details!.code).toBe('ETIMEDOUT');
  });
});

// ─── Retry-After Parsing ─────────────────────────────────────────────────────

describe('getRetryAfterSeconds', () => {
  test('parses from headers.get()', () => {
    const error = { headers: { get: (k: string) => k === 'retry-after' ? '30' : null } };
    expect(getRetryAfterSeconds(error)).toBe(30);
  });

  test('parses from plain headers', () => {
    const error = { headers: { 'retry-after': '15' } };
    expect(getRetryAfterSeconds(error)).toBe(15);
  });

  test('parses from response body', () => {
    const error = { responseBody: JSON.stringify({ error: { retry_after: 45.2 } }) };
    expect(getRetryAfterSeconds(error)).toBe(46);
  });

  test('returns null for missing headers', () => {
    expect(getRetryAfterSeconds(new Error('no headers'))).toBeNull();
  });
});

describe('getRateLimitResetDelayMs', () => {
  test('parses reset timestamp', () => {
    const futureUnixSec = Math.floor(Date.now() / 1000) + 60;
    const error = { headers: { get: (k: string) => k === 'anthropic-ratelimit-unified-reset' ? String(futureUnixSec) : null } };
    const delay = getRateLimitResetDelayMs(error);
    expect(delay).toBeGreaterThan(50000);
    expect(delay).toBeLessThanOrEqual(60000);
  });

  test('returns null for past timestamp', () => {
    const pastUnixSec = Math.floor(Date.now() / 1000) - 60;
    const error = { headers: { get: () => String(pastUnixSec) } };
    expect(getRateLimitResetDelayMs(error)).toBeNull();
  });
});

// ─── Prompt Too Long Parsing ─────────────────────────────────────────────────

describe('parsePromptTooLongTokens', () => {
  test('parses standard format', () => {
    const result = parsePromptTooLongTokens('prompt is too long: 150000 tokens > 128000');
    expect(result).toEqual({ actual: 150000, limit: 128000 });
  });

  test('parses with extra text', () => {
    const result = parsePromptTooLongTokens('400 Bad Request: prompt is too long 200000 tokens > 100000 maximum');
    expect(result).toEqual({ actual: 200000, limit: 100000 });
  });

  test('returns null for non-matching', () => {
    expect(parsePromptTooLongTokens('some other error')).toBeNull();
  });
});

// ─── Cache Control ───────────────────────────────────────────────────────────

describe('getCacheControl', () => {
  test('returns ephemeral by default', () => {
    expect(getCacheControl()).toEqual({ type: 'ephemeral' });
  });

  test('adds 1h TTL when longTTL is true', () => {
    expect(getCacheControl({ longTTL: true })).toEqual({ type: 'ephemeral', ttl: '1h' });
  });
});

describe('addCacheToSystemBlocks', () => {
  test('adds cache_control to last system block', () => {
    const blocks = [
      { type: 'text' as const, text: 'System prompt part 1' },
      { type: 'text' as const, text: 'System prompt part 2' },
    ];
    const result = addCacheToSystemBlocks(blocks);
    expect(result[0]).not.toHaveProperty('cache_control');
    expect(result[1]).toHaveProperty('cache_control');
    expect(result[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  test('handles empty blocks', () => {
    expect(addCacheToSystemBlocks([])).toEqual([]);
  });

  test('handles single block', () => {
    const result = addCacheToSystemBlocks([{ type: 'text', text: 'only' }]);
    expect(result[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('addCacheBreakpoints', () => {
  test('adds cache_control to last user message', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there' },
      { role: 'user' as const, content: 'How are you?' },
    ];
    const result = addCacheBreakpoints(messages);
    // First user message should NOT have cache
    expect(result[0].content).toBe('Hello');
    // Last user message should have cache
    const lastUser = result[2];
    expect(Array.isArray(lastUser.content)).toBe(true);
    const cachedBlocks = lastUser.content as Array<{ cache_control?: { type: string } }>;
    expect(cachedBlocks[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  test('caches multiple user messages when count > 1', () => {
    const messages = [
      { role: 'user' as const, content: 'First' },
      { role: 'assistant' as const, content: 'Reply 1' },
      { role: 'user' as const, content: 'Second' },
      { role: 'assistant' as const, content: 'Reply 2' },
      { role: 'user' as const, content: 'Third' },
    ];
    const result = addCacheBreakpoints(messages, 2);
    // First user message - no cache
    expect(result[0].content).toBe('First');
    // Second user message - cached (2nd from end)
    expect(Array.isArray(result[2].content)).toBe(true);
    // Third user message - cached (1st from end)
    expect(Array.isArray(result[4].content)).toBe(true);
  });

  test('handles array content blocks', () => {
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Part 1' },
          { type: 'text' as const, text: 'Part 2' },
        ],
      },
    ];
    const result = addCacheBreakpoints(messages);
    const content = result[0].content as Array<{ cache_control?: { type: string } }>;
    expect(content[0]).not.toHaveProperty('cache_control');
    expect(content[1]?.cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('estimateCacheSavings', () => {
  test('calculates with cache hits', () => {
    const result = estimateCacheSavings({
      input_tokens: 1000,
      cache_read_input_tokens: 9000,
      cache_creation_input_tokens: 0,
    });
    expect(result.cacheHitRate).toBe(0.9);
    expect(result.tokensSaved).toBe(8100);
    expect(result.costReductionPercent).toBe(81);
  });

  test('calculates with no cache', () => {
    const result = estimateCacheSavings({
      input_tokens: 10000,
    });
    expect(result.cacheHitRate).toBe(0);
    expect(result.tokensSaved).toBe(0);
    expect(result.costReductionPercent).toBe(0);
  });

  test('handles zero tokens', () => {
    const result = estimateCacheSavings({ input_tokens: 0 });
    expect(result.cacheHitRate).toBe(0);
  });
});
