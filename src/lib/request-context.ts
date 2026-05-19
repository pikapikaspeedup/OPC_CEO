import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import type { IncomingHttpHeaders } from 'http';

export const CORRELATION_ID_HEADER = 'x-ag-correlation-id';

type RequestContextStore = {
  correlationId: string;
};

const requestContextStorage = new AsyncLocalStorage<RequestContextStore>();

function normalizeCorrelationId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 128);
}

function readCorrelationIdFromHeaders(headers: Headers | IncomingHttpHeaders): string | undefined {
  if (headers instanceof Headers) {
    return normalizeCorrelationId(headers.get(CORRELATION_ID_HEADER));
  }

  const raw = headers[CORRELATION_ID_HEADER];
  if (Array.isArray(raw)) {
    return normalizeCorrelationId(raw[0]);
  }
  return normalizeCorrelationId(raw);
}

export function resolveCorrelationId(input?: Request | Headers | IncomingHttpHeaders | string | null): string {
  if (typeof input === 'string' || input === null) {
    return normalizeCorrelationId(input) || randomUUID();
  }

  if (input instanceof Request) {
    return readCorrelationIdFromHeaders(input.headers) || randomUUID();
  }

  if (input instanceof Headers) {
    return readCorrelationIdFromHeaders(input) || randomUUID();
  }

  if (input) {
    return readCorrelationIdFromHeaders(input) || randomUUID();
  }

  return randomUUID();
}

export function runWithRequestContext<T>(
  correlationId: string,
  callback: () => T,
): T {
  return requestContextStorage.run({ correlationId }, callback);
}

export function getCorrelationId(): string | undefined {
  return requestContextStorage.getStore()?.correlationId;
}
