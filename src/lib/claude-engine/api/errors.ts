/**
 * API 错误分类与连接错误处理
 * 从 claude-code/src/services/api/errors.ts + errorUtils.ts 移植
 * 
 * 提供：
 * - classifyAPIError() — 将各种 API 错误分类为标准错误类型
 * - extractConnectionErrorDetails() — 从 cause 链中提取连接错误详情
 * - formatAPIError() — 生成用户友好的错误消息
 * - is529Error() / isRetryableError() — 重试判断辅助
 */

import { APIClientError } from './client';

// ─── SSL/TLS Error Codes ─────────────────────────────────────────────────────

const SSL_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_SIGNATURE_FAILURE',
  'CERT_NOT_YET_VALID',
  'CERT_HAS_EXPIRED',
  'CERT_REVOKED',
  'CERT_REJECTED',
  'CERT_UNTRUSTED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_CHAIN_TOO_LONG',
  'PATH_LENGTH_EXCEEDED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HOSTNAME_MISMATCH',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC',
]);

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConnectionErrorDetails = {
  code: string;
  message: string;
  isSSLError: boolean;
};

/** Standard API error classification */
export type APIErrorType =
  | 'aborted'
  | 'api_timeout'
  | 'rate_limit'
  | 'server_overload'
  | 'prompt_too_long'
  | 'max_tokens_overflow'
  | 'tool_use_mismatch'
  | 'invalid_model'
  | 'invalid_api_key'
  | 'auth_error'
  | 'server_error'
  | 'client_error'
  | 'ssl_cert_error'
  | 'connection_error'
  | 'connection_reset'
  | 'unknown';

// ─── Connection Error Extraction ─────────────────────────────────────────────

/**
 * Walk the error cause chain to extract the root connection error details.
 * The cause chain is typically: APIClientError → TypeError → SystemError(code)
 */
export function extractConnectionErrorDetails(
  error: unknown,
): ConnectionErrorDetails | null {
  if (!error || typeof error !== 'object') return null;

  let current: unknown = error;
  const maxDepth = 5;
  let depth = 0;

  while (current && depth < maxDepth) {
    if (
      current instanceof Error &&
      'code' in current &&
      typeof (current as { code: unknown }).code === 'string'
    ) {
      const code = (current as { code: string }).code;
      return {
        code,
        message: current.message,
        isSSLError: SSL_ERROR_CODES.has(code),
      };
    }

    if (current instanceof Error && 'cause' in current && current.cause !== current) {
      current = current.cause;
      depth++;
    } else {
      break;
    }
  }

  return null;
}

// ─── Error Classification ────────────────────────────────────────────────────

/**
 * Classify an API error into a standard error type.
 * Works with both APIClientError and generic errors.
 */
export function classifyAPIError(error: unknown): APIErrorType {
  const msg = error instanceof Error ? error.message : String(error);
  const status = extractStatusCode(error);

  // Aborted
  if (error instanceof Error && (
    error.name === 'AbortError' ||
    msg === 'Request was aborted.' ||
    msg.includes('The operation was aborted')
  )) {
    return 'aborted';
  }

  // Timeout
  if (msg.toLowerCase().includes('timeout') || status === 408) {
    return 'api_timeout';
  }

  // Connection errors
  const connDetails = extractConnectionErrorDetails(error);
  if (connDetails) {
    if (connDetails.isSSLError) return 'ssl_cert_error';
    if (connDetails.code === 'ECONNRESET' || connDetails.code === 'EPIPE') return 'connection_reset';
    if (connDetails.code === 'ECONNREFUSED' || connDetails.code === 'ENOTFOUND') return 'connection_error';
  }

  // Status-based classification
  if (status === 429) return 'rate_limit';
  if (status === 529 || msg.includes('"type":"overloaded_error"')) return 'server_overload';

  // Content-based classification
  if (msg.toLowerCase().includes('prompt is too long')) return 'prompt_too_long';
  if (msg.includes('input length and `max_tokens` exceed context limit')) return 'max_tokens_overflow';
  if (msg.includes('tool_use` ids were found without `tool_result`')) return 'tool_use_mismatch';
  if (msg.includes('tool_use` ids must be unique')) return 'tool_use_mismatch';
  if (msg.toLowerCase().includes('invalid model name') || msg.toLowerCase().includes('invalid model')) return 'invalid_model';
  if (msg.toLowerCase().includes('x-api-key') || msg.toLowerCase().includes('api key')) return 'invalid_api_key';

  // Auth errors
  if (status === 401 || status === 403) return 'auth_error';

  // Server errors
  if (status !== null && status >= 500) return 'server_error';
  if (status !== null && status >= 400) return 'client_error';

  // Connection fallback (no status, fetch failed)
  if (msg.includes('fetch failed') || msg.includes('Unable to connect')) return 'connection_error';

  return 'unknown';
}

// ─── Error Formatting ────────────────────────────────────────────────────────

/**
 * Generate a user-friendly error message from an API error.
 */
export function formatAPIError(error: unknown): string {
  const errorType = classifyAPIError(error);
  const status = extractStatusCode(error);
  const msg = error instanceof Error ? error.message : String(error);

  switch (errorType) {
    case 'aborted':
      return 'Request was cancelled';

    case 'api_timeout':
      return 'Request timed out. Check your internet connection and proxy settings';

    case 'ssl_cert_error': {
      const details = extractConnectionErrorDetails(error);
      const code = details?.code ?? 'unknown';
      switch (code) {
        case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
        case 'UNABLE_TO_GET_ISSUER_CERT':
        case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
          return 'SSL certificate verification failed. If behind a corporate proxy, set NODE_EXTRA_CA_CERTS';
        case 'CERT_HAS_EXPIRED':
          return 'SSL certificate has expired';
        case 'DEPTH_ZERO_SELF_SIGNED_CERT':
        case 'SELF_SIGNED_CERT_IN_CHAIN':
          return 'Self-signed certificate detected. If behind a corporate proxy, set NODE_EXTRA_CA_CERTS';
        default:
          return `SSL error (${code}). Check your certificate configuration`;
      }
    }

    case 'connection_reset':
      return 'Connection was reset. Retrying...';

    case 'connection_error':
      return 'Unable to connect to API. Check your internet connection';

    case 'rate_limit':
      return `Rate limited (429). ${getRetryAfterHint(error)}`;

    case 'server_overload':
      return 'Server is overloaded (529). Retrying with backoff...';

    case 'prompt_too_long': {
      const tokenInfo = parsePromptTooLongTokens(msg);
      return tokenInfo
        ? `Prompt too long (${tokenInfo.actual} tokens, limit ${tokenInfo.limit}). Consider compacting the conversation`
        : 'Prompt too long. Consider compacting the conversation';
    }

    case 'max_tokens_overflow':
      return 'Input + max_tokens exceeds context limit. Reducing max_tokens...';

    case 'tool_use_mismatch':
      return 'Tool use/result mismatch in conversation. This is a protocol error';

    case 'invalid_model':
      return `Invalid model name. Check your ANTHROPIC_MODEL / OPENAI_MODEL / GEMINI_MODEL setting`;

    case 'invalid_api_key':
      return 'Invalid API key. Check your API key configuration';

    case 'auth_error':
      return `Authentication error (${status}). Check your API key or credentials`;

    case 'server_error':
      return `Server error (${status}). ${sanitizeHTML(msg)}`;

    case 'client_error':
      return `API error (${status}): ${sanitizeHTML(msg)}`;

    default:
      return `API error: ${sanitizeHTML(msg)}`;
  }
}

// ─── Retry Helpers ───────────────────────────────────────────────────────────

/**
 * Is this a 529 overloaded error?
 */
export function is529Error(error: unknown): boolean {
  const status = extractStatusCode(error);
  if (status === 529) return true;
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('"type":"overloaded_error"');
}

/**
 * Is this error retryable?
 */
export function isRetryableError(error: unknown): boolean {
  const errorType = classifyAPIError(error);
  return [
    'rate_limit',
    'server_overload',
    'server_error',
    'api_timeout',
    'connection_error',
    'connection_reset',
  ].includes(errorType);
}

/**
 * Is this a stale connection (ECONNRESET/EPIPE)?
 * These need a fresh connection, not just a retry.
 */
export function isStaleConnectionError(error: unknown): boolean {
  return classifyAPIError(error) === 'connection_reset';
}

/**
 * Extract retry-after hint from error headers/body.
 */
function getRetryAfterHint(error: unknown): string {
  const retryAfter = getRetryAfterSeconds(error);
  if (retryAfter !== null) {
    return `Retry after ${retryAfter}s`;
  }
  return 'Will retry with backoff';
}

/**
 * Parse retry-after seconds from error headers.
 */
export function getRetryAfterSeconds(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;

  // Check headers property (APIError style)
  const headers = (error as Record<string, unknown>).headers;
  if (headers && typeof headers === 'object') {
    // Standard Header object with get()
    if ('get' in headers && typeof (headers as { get: unknown }).get === 'function') {
      const val = (headers as { get: (key: string) => string | null }).get('retry-after');
      if (val) {
        const seconds = parseInt(val, 10);
        if (!isNaN(seconds)) return seconds;
      }
    }
    // Plain object
    const retryAfter = (headers as Record<string, string>)['retry-after'];
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) return seconds;
    }
  }

  // Check responseBody for retry-after info
  const body = (error as { responseBody?: string }).responseBody;
  if (body) {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.error?.retry_after) {
        return Math.ceil(parsed.error.retry_after);
      }
    } catch { /* ignore */ }
  }

  return null;
}

/**
 * Parse rate-limit reset timestamp from error headers.
 * Returns delay in ms until reset, or null.
 */
export function getRateLimitResetDelayMs(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const headers = (error as Record<string, unknown>).headers;
  if (!headers || typeof headers !== 'object') return null;

  let resetHeader: string | null = null;
  if ('get' in headers && typeof (headers as { get: unknown }).get === 'function') {
    resetHeader = (headers as { get: (key: string) => string | null }).get('anthropic-ratelimit-unified-reset');
  }
  if (!resetHeader) {
    resetHeader = (headers as Record<string, string>)['anthropic-ratelimit-unified-reset'] ?? null;
  }

  if (!resetHeader) return null;
  const resetUnixSec = Number(resetHeader);
  if (!Number.isFinite(resetUnixSec)) return null;
  const delayMs = resetUnixSec * 1000 - Date.now();
  return delayMs > 0 ? delayMs : null;
}

// ─── Prompt Too Long Parsing ─────────────────────────────────────────────────

/**
 * Parse token counts from "prompt is too long" error messages.
 */
export function parsePromptTooLongTokens(rawMessage: string): {
  actual: number;
  limit: number;
} | null {
  const match = rawMessage.match(
    /prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i,
  );
  if (!match?.[1] || !match?.[2]) return null;
  return {
    actual: parseInt(match[1], 10),
    limit: parseInt(match[2], 10),
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function extractStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  if ('statusCode' in error && typeof (error as { statusCode: unknown }).statusCode === 'number') {
    return (error as { statusCode: number }).statusCode;
  }
  if ('status' in error && typeof (error as { status: unknown }).status === 'number') {
    return (error as { status: number }).status;
  }
  return null;
}

/**
 * Strip HTML from error messages (e.g., CloudFlare error pages).
 */
function sanitizeHTML(message: string): string {
  if (message.includes('<!DOCTYPE html') || message.includes('<html')) {
    const titleMatch = message.match(/<title>([^<]+)<\/title>/);
    if (titleMatch?.[1]) return titleMatch[1].trim();
    return '(HTML error page received)';
  }
  return message;
}
