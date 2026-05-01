import { createLogger } from '../../logger';
import { APIClientError } from './api-client-error';
import { streamQueryViaPi } from './pi-transport';
import {
  classifyAPIError,
  isRetryableError,
  isStaleConnectionError,
  is529Error,
  formatAPIError,
  getRetryAfterSeconds,
  getRateLimitResetDelayMs,
  type APIErrorType,
} from './errors';
import type { TokenManager } from './auth';
import type { QueryOptions, StreamEvent } from './types';

const log = createLogger('ClaudeEngineRetry');

export type RetryOptions = {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  retryableStatusCodes?: number[];
  /** Fallback model to use after consecutive 529 errors */
  fallbackModel?: string;
  /** Max consecutive 529 errors before triggering fallback */
  max529Retries?: number;
  /** Token manager for OAuth token refresh on auth errors */
  tokenManager?: TokenManager;
  /** Provider name for token refresh (matches tokenManager registration) */
  authProvider?: string;
};

export type RetryEvent = {
  type: 'retry';
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  statusCode: number;
  errorMessage: string;
  /** Classified error type */
  errorType: APIErrorType;
  /** User-friendly formatted message */
  formattedMessage: string;
};

export class FallbackTriggeredError extends Error {
  constructor(
    public readonly originalModel: string,
    public readonly fallbackModel: string,
  ) {
    super(`Model fallback triggered: ${originalModel} -> ${fallbackModel}`);
    this.name = 'FallbackTriggeredError';
  }
}

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'fallbackModel' | 'tokenManager' | 'authProvider'>> & { fallbackModel?: string; tokenManager?: TokenManager; authProvider?: string } = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 60_000,
  retryableStatusCodes: [429, 529, 502, 503, 408, 409],
  max529Retries: 3,
  fallbackModel: undefined,
};

/**
 * 包装 streamQuery，添加智能重试 + 多 provider 路由
 * 
 * 增强重试策略（从 claude-code withRetry.ts 移植）：
 * 1. 错误分类驱动的重试决策（classifyAPIError）
 * 2. retry-after / rate-limit-reset 头解析
 * 3. 连续 529 追踪 + fallback model 切换
 * 4. max_tokens 上下文溢出自适应
 * 5. 连接断开（ECONNRESET）自动恢复
 */
export async function* streamQueryWithRetry(
  queryOptions: QueryOptions,
  retryOptions: RetryOptions = {},
): AsyncGenerator<StreamEvent | RetryEvent> {
  const mergedOptions = {
    ...DEFAULT_RETRY_OPTIONS,
    ...retryOptions,
  };
  const maxAttempts = mergedOptions.maxRetries + 1;
  let consecutive529Errors = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let yieldedAnyStreamEvent = false;

    try {
      const provider = queryOptions.model.provider ?? 'anthropic';
      const stream = selectProviderStream(provider, queryOptions);

      for await (const event of stream) {
        yieldedAnyStreamEvent = true;
        yield event;
      }

      return;
    } catch (error) {
      if (isAbortError(error) || yieldedAnyStreamEvent) {
        throw error;
      }

      const errorType = classifyAPIError(error);
      const statusCode = extractStatusCode(error);

      // Track 529 (overloaded) errors for fallback
      if (is529Error(error)) {
        consecutive529Errors++;
        if (consecutive529Errors >= mergedOptions.max529Retries && mergedOptions.fallbackModel) {
          throw new FallbackTriggeredError(
            queryOptions.model.model,
            mergedOptions.fallbackModel,
          );
        }
      } else {
        consecutive529Errors = 0;
      }

      // Handle max_tokens context overflow — reduce and retry without counting as error
      if (errorType === 'max_tokens_overflow') {
        const overflow = parseMaxTokensOverflow(error);
        if (overflow) {
          const available = Math.max(3000, overflow.contextLimit - overflow.inputTokens - 1000);
          queryOptions.maxOutputTokens = available;
          continue;
        }
      }

      // Handle auth errors — try token refresh before giving up
      // Mirrors claude-code's handleOAuth401Error pattern:
      // 1. Check if another process already refreshed
      // 2. Force refresh if not
      // 3. Update API key and retry
      if (errorType === 'auth_error' && mergedOptions.tokenManager && mergedOptions.authProvider) {
        const result = await mergedOptions.tokenManager.handleAuthError(
          mergedOptions.authProvider,
          queryOptions.model.apiKey,
        );
        if (result.ok) {
          // Update the API key with the refreshed token
          queryOptions.model.apiKey = result.tokens.accessToken;
          // Auth refresh doesn't count as a normal retry attempt
          continue;
        }
        // If refresh failed, fall through to normal error handling
      }

      // Determine if retryable using error classification
      if (!isRetryableError(error) || attempt >= maxAttempts) {
        throw error;
      }

      // Calculate delay with multiple strategies
      let delayMs: number;

      // 1. Try retry-after header (rate limit)
      const retryAfterSec = getRetryAfterSeconds(error);
      if (retryAfterSec !== null) {
        delayMs = retryAfterSec * 1000;
      }
      // 2. Try rate-limit reset timestamp
      else {
        const resetDelay = getRateLimitResetDelayMs(error);
        if (resetDelay !== null) {
          delayMs = Math.min(resetDelay, mergedOptions.maxDelayMs);
        }
        // 3. Connection reset — short delay for fresh connection
        else if (isStaleConnectionError(error)) {
          delayMs = Math.min(1000, mergedOptions.initialDelayMs);
        }
        // 4. Default exponential backoff
        else {
          delayMs = calculateBackoff(attempt, mergedOptions as Required<RetryOptions>);
        }
      }

      yield {
        type: 'retry',
        attempt,
        maxAttempts,
        delayMs,
        statusCode: statusCode ?? 0,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorType,
        formattedMessage: formatAPIError(error),
      };

      await sleep(delayMs, queryOptions.signal);
    }
  }
}

/**
 * Route to the correct provider stream based on model config.
 */
function selectProviderStream(
  provider: string,
  options: QueryOptions,
): AsyncGenerator<StreamEvent> {
  switch (provider) {
    case 'anthropic':
    case 'openai':
    case 'gemini':
    case 'grok':
    case 'custom':
    case 'native-codex':
      if (options.model.transport && options.model.transport !== 'pi-ai') {
        log.warn(
          {
            provider,
            requestedTransport: options.model.transport,
            model: options.model.model,
          },
          'Claude Engine mainline coerced API-backed provider transport to pi-ai',
        );
      }
      return streamQueryViaPi({
        ...options,
        model: {
          ...options.model,
          transport: 'pi-ai',
        },
      });
    default:
      return unsupportedProviderStream(provider, options);
  }
}

async function* unsupportedProviderStream(
  provider: string,
  options: QueryOptions,
): AsyncGenerator<StreamEvent> {
  throw new APIClientError(
    `Claude Engine mainline does not support provider "${provider}" outside pi-ai routing`,
    {
      responseBody: JSON.stringify({
        provider,
        requestedTransport: options.model.transport ?? null,
        model: options.model.model,
      }),
    },
  );
}

/**
 * Detect provider from environment variables.
 * Priority: explicit provider > env vars > default anthropic.
 */
export function detectProvider(): string {
  if (process.env.CLAUDE_CODE_USE_OPENAI === '1') return 'openai';
  if (process.env.CLAUDE_CODE_USE_GEMINI === '1') return 'gemini';
  if (process.env.CLAUDE_CODE_USE_GROK === '1') return 'grok';
  return 'anthropic';
}

/**
 * Parse max_tokens context overflow error for auto-adjustment.
 * From claude-code/src/services/api/withRetry.ts
 */
function parseMaxTokensOverflow(error: unknown): {
  inputTokens: number;
  maxTokens: number;
  contextLimit: number;
} | null {
  if (!error || typeof error !== 'object') return null;
  const msg = 'message' in error ? String((error as { message: string }).message) : '';
  const match = msg.match(
    /input length and `max_tokens` exceed context limit: (\d+) \+ (\d+) > (\d+)/,
  );
  if (!match?.[1] || !match?.[2] || !match?.[3]) return null;
  return {
    inputTokens: parseInt(match[1], 10),
    maxTokens: parseInt(match[2], 10),
    contextLimit: parseInt(match[3], 10),
  };
}

/**
 * 计算退避延迟（指数退避 + jitter）
 */
export function calculateBackoff(
  attempt: number,
  options: Required<RetryOptions>,
): number {
  const baseDelay = Math.min(
    options.maxDelayMs,
    options.initialDelayMs * 2 ** Math.max(0, attempt - 1),
  );
  const jitterFactor = 0.5 + Math.random();

  return Math.min(options.maxDelayMs, Math.round(baseDelay * jitterFactor));
}

/**
 * 判断是否应该重试
 */
export function shouldRetry(
  statusCode: number,
  retryableStatusCodes: number[],
): boolean {
  return retryableStatusCodes.includes(statusCode);
}

function extractStatusCode(error: unknown): number | null {
  if (
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  ) {
    return error.statusCode;
  }

  return null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function sleep(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (durationMs <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, durationMs);

    function onAbort(): void {
      cleanup();
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }

    function cleanup(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
