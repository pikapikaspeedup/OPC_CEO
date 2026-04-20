export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type JsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
};

export function createIdGenerator(): () => number {
  let currentId = 0;

  return () => {
    currentId += 1;
    return currentId;
  };
}

export function serializeRequest(
  method: string,
  params: Record<string, unknown> | undefined,
  id: number,
): string {
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    id,
    method,
    ...(params ? { params } : {}),
  };

  return JSON.stringify(request);
}

export function parseResponse(
  data: string,
): JsonRpcResponse | JsonRpcNotification {
  let parsed: unknown;

  try {
    parsed = JSON.parse(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON-RPC payload: ${message}`);
  }

  if (isNotification(parsed)) {
    return parsed;
  }

  if (isResponse(parsed)) {
    return parsed;
  }

  throw new Error('Invalid JSON-RPC message');
}

export function isNotification(msg: unknown): msg is JsonRpcNotification {
  if (!isRecord(msg)) {
    return false;
  }

  return (
    msg.jsonrpc === '2.0' &&
    typeof msg.method === 'string' &&
    !('id' in msg)
  );
}

function isResponse(msg: unknown): msg is JsonRpcResponse {
  if (!isRecord(msg)) {
    return false;
  }

  if (msg.jsonrpc !== '2.0' || typeof msg.id !== 'number') {
    return false;
  }

  if (!('result' in msg) && !('error' in msg)) {
    return false;
  }

  if ('error' in msg && msg.error !== undefined) {
    if (!isRecord(msg.error)) {
      return false;
    }

    if (
      typeof msg.error.code !== 'number' ||
      typeof msg.error.message !== 'string'
    ) {
      return false;
    }
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}