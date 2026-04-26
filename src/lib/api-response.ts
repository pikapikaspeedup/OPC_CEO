export class ApiResponseError extends Error {
  readonly status: number;
  readonly payload: unknown;
  readonly role?: string;
  readonly path?: string;

  constructor(message: string, options: { status: number; payload?: unknown; role?: string; path?: string }) {
    super(message);
    this.name = 'ApiResponseError';
    this.status = options.status;
    this.payload = options.payload;
    this.role = options.role;
    this.path = options.path;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

export async function readJsonOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (response.ok) {
    return response.json() as Promise<T>;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  const record = asRecord(payload);
  const message = typeof record?.error === 'string' ? record.error : fallbackMessage;
  throw new ApiResponseError(message, {
    status: response.status,
    payload,
    role: typeof record?.role === 'string' ? record.role : undefined,
    path: typeof record?.path === 'string' ? record.path : undefined,
  });
}

export function isUnconfiguredWebApiError(error: unknown): error is ApiResponseError {
  return error instanceof ApiResponseError
    && error.status === 503
    && error.role === 'web'
    && typeof error.path === 'string';
}
