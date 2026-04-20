import type {
  APIContentBlock,
  APIResponse,
  ContentDelta,
  QueryOptions,
  StreamEvent,
  TokenUsage,
} from './types';

const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 1;
const STREAM_DECODE_OPTIONS: TextDecodeOptions = { stream: true };

type SSEFrame = {
  event?: string;
  data?: string;
};

export class APIClientError extends Error {
  readonly statusCode?: number;
  readonly responseBody?: string;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      responseBody?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'APIClientError';
    this.statusCode = options.statusCode;
    this.responseBody = options.responseBody;
  }
}

/**
 * 流式调用 Anthropic Messages API
 * 返回 AsyncGenerator<StreamEvent>
 */
export async function* streamQuery(
  options: QueryOptions,
): AsyncGenerator<StreamEvent> {
  assertSupportedProvider(options);

  const response = await fetch(resolveMessagesUrl(options), {
    method: 'POST',
    headers: buildHeaders(options),
    body: JSON.stringify(buildRequestBody(options)),
    signal: options.signal,
  });

  if (!response.ok) {
    const responseBody = await safeReadText(response);
    throw new APIClientError(
      `Anthropic API request failed (${response.status} ${response.statusText || 'Error'}): ${responseBody || 'empty response body'}`,
      {
        statusCode: response.status,
        responseBody,
      },
    );
  }

  if (!response.body) {
    throw new APIClientError('Anthropic API returned no response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, STREAM_DECODE_OPTIONS);
      const { frames, remaining } = parseSSEFrames(buffer);
      buffer = remaining;

      for (const frame of frames) {
        const event = parseFrameToStreamEvent(frame);

        if (event) {
          yield event;
        }
      }
    }

    buffer += decoder.decode();
    const { frames } = parseSSEFrames(buffer);

    for (const frame of frames) {
      const event = parseFrameToStreamEvent(frame);

      if (event) {
        yield event;
      }
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new APIClientError(`Failed to read Anthropic SSE stream: ${message}`, {
      cause: error,
    });
  } finally {
    reader.releaseLock();
  }
}

/**
 * 非流式调用
 */
export async function query(options: QueryOptions): Promise<APIResponse> {
  const contentBlocks: APIContentBlock[] = [];
  const toolInputBuffers = new Map<number, string>();
  let id = '';
  let stopReason: string | null = null;
  let usage: TokenUsage = { input_tokens: 0, output_tokens: 0 };

  for await (const event of streamQuery(options)) {
    switch (event.type) {
      case 'message_start': {
        id = event.message.id;
        usage = mergeUsage(usage, event.message.usage);
        break;
      }

      case 'content_block_start': {
        contentBlocks[event.index] = cloneContentBlock(event.content_block);
        break;
      }

      case 'content_block_delta': {
        const contentBlock = contentBlocks[event.index];

        if (!contentBlock) {
          break;
        }

        applyDelta(contentBlock, event.delta, toolInputBuffers, event.index);
        break;
      }

      case 'content_block_stop': {
        finalizeToolInput(contentBlocks[event.index], toolInputBuffers, event.index);
        break;
      }

      case 'message_delta': {
        stopReason = event.delta.stop_reason;
        usage = mergeUsage(usage, event.usage);
        break;
      }

      case 'message_stop': {
        break;
      }

      case 'error': {
        throw new APIClientError(
          `Anthropic API stream error (${event.error.type}): ${event.error.message}`,
        );
      }
    }
  }

  for (const [index] of toolInputBuffers) {
    finalizeToolInput(contentBlocks[index], toolInputBuffers, index);
  }

  if (!id) {
    throw new APIClientError('Anthropic API stream ended before message_start');
  }

  return {
    id,
    content: contentBlocks.filter(
      (contentBlock): contentBlock is APIContentBlock => Boolean(contentBlock),
    ),
    stop_reason: stopReason,
    usage,
    model: options.model.model,
  };
}

/**
 * 解析 SSE 行
 */
export function parseSSELine(
  line: string,
): { event?: string; data?: string } | null {
  if (!line || line.startsWith(':')) {
    return null;
  }

  const separatorIndex = line.indexOf(':');

  if (separatorIndex === -1) {
    return null;
  }

  const field = line.slice(0, separatorIndex);
  const value = line[separatorIndex + 1] === ' '
    ? line.slice(separatorIndex + 2)
    : line.slice(separatorIndex + 1);

  if (field === 'event') {
    return { event: value };
  }

  if (field === 'data') {
    return { data: value };
  }

  return null;
}

/**
 * 构建请求 headers
 */
export function buildHeaders(options: QueryOptions): Record<string, string> {
  assertSupportedProvider(options);

  const headers: Record<string, string> = {
    'x-api-key': options.model.apiKey,
    'content-type': 'application/json',
    accept: 'text/event-stream',
    'anthropic-version': ANTHROPIC_API_VERSION,
  };

  if (options.betas && options.betas.length > 0) {
    headers['anthropic-beta'] = options.betas.join(',');
  }

  return headers;
}

/**
 * 构建请求 body
 */
export function buildRequestBody(
  options: QueryOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model.model,
    max_tokens:
      options.maxOutputTokens ??
      options.model.maxOutputTokens ??
      DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: options.model.temperature ?? DEFAULT_TEMPERATURE,
    system: options.systemPrompt,
    messages: options.messages,
    stream: true,
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }

  if (options.thinking?.type === 'enabled') {
    body.thinking = {
      type: 'enabled',
      budget_tokens: options.thinking.budgetTokens,
    };
  }

  return body;
}

function parseSSEFrames(buffer: string): {
  frames: SSEFrame[];
  remaining: string;
} {
  const frames: SSEFrame[] = [];
  let cursor = 0;
  const delimiterPattern = /\r?\n\r?\n/g;
  let delimiterMatch: RegExpExecArray | null;

  while ((delimiterMatch = delimiterPattern.exec(buffer)) !== null) {
    const frameSource = buffer.slice(cursor, delimiterMatch.index);
    cursor = delimiterMatch.index + delimiterMatch[0].length;

    if (!frameSource.trim()) {
      continue;
    }

    const frame: SSEFrame = {};

    for (const rawLine of frameSource.split(/\r?\n/)) {
      const parsedLine = parseSSELine(rawLine);

      if (!parsedLine) {
        continue;
      }

      if (parsedLine.event) {
        frame.event = parsedLine.event;
      }

      if (parsedLine.data) {
        frame.data = frame.data
          ? `${frame.data}\n${parsedLine.data}`
          : parsedLine.data;
      }
    }

    if (frame.event || frame.data) {
      frames.push(frame);
    }
  }

  return {
    frames,
    remaining: buffer.slice(cursor),
  };
}

function parseFrameToStreamEvent(frame: SSEFrame): StreamEvent | null {
  if (!frame.data) {
    return null;
  }

  let parsedData: unknown;

  try {
    parsedData = JSON.parse(frame.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new APIClientError(`Failed to parse Anthropic SSE payload: ${message}`, {
      cause: error,
    });
  }

  if (!parsedData || typeof parsedData !== 'object' || !('type' in parsedData)) {
    return null;
  }

  const eventType = frame.event ?? parsedData.type;

  if (eventType === 'ping') {
    return null;
  }

  return parsedData as StreamEvent;
}

function resolveMessagesUrl(options: QueryOptions): string {
  const baseUrl = (options.model.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL).replace(/\/+$/, '');

  return baseUrl.endsWith('/v1/messages')
    ? baseUrl
    : `${baseUrl}/v1/messages`;
}

function assertSupportedProvider(options: QueryOptions): void {
  const provider = options.model.provider ?? 'anthropic';

  if (provider !== 'anthropic') {
    // Non-Anthropic providers are handled by retry.ts provider routing
    // This function is only called for the Anthropic direct path
  }
}

function safeReadText(response: Response): Promise<string> {
  return response.text().catch(() => '');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function cloneContentBlock(contentBlock: APIContentBlock): APIContentBlock {
  if (contentBlock.type === 'text') {
    return { ...contentBlock };
  }

  if (contentBlock.type === 'thinking') {
    return { ...contentBlock };
  }

  if (contentBlock.type === 'tool_use') {
    return {
      ...contentBlock,
      input: { ...contentBlock.input },
    };
  }

  return {
    ...contentBlock,
    content: Array.isArray(contentBlock.content)
      ? contentBlock.content.map(cloneContentBlock)
      : contentBlock.content,
  };
}

function applyDelta(
  contentBlock: APIContentBlock,
  delta: ContentDelta,
  toolInputBuffers: Map<number, string>,
  index: number,
): void {
  if (contentBlock.type === 'text' && delta.type === 'text_delta') {
    contentBlock.text += delta.text;
    return;
  }

  if (contentBlock.type === 'thinking' && delta.type === 'thinking_delta') {
    contentBlock.thinking += delta.thinking;
    return;
  }

  if (contentBlock.type === 'tool_use' && delta.type === 'input_json_delta') {
    const previous = toolInputBuffers.get(index) ?? '';
    toolInputBuffers.set(index, previous + delta.partial_json);
  }
}

function finalizeToolInput(
  contentBlock: APIContentBlock | undefined,
  toolInputBuffers: Map<number, string>,
  index: number,
): void {
  if (!contentBlock || contentBlock.type !== 'tool_use') {
    return;
  }

  const partialJson = toolInputBuffers.get(index);

  if (!partialJson) {
    return;
  }

  try {
    contentBlock.input = JSON.parse(partialJson) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new APIClientError(`Failed to parse tool input JSON: ${message}`, {
      cause: error,
    });
  } finally {
    toolInputBuffers.delete(index);
  }
}

function mergeUsage(current: TokenUsage, next?: TokenUsage): TokenUsage {
  if (!next) {
    return current;
  }

  return {
    input_tokens: next.input_tokens ?? current.input_tokens,
    output_tokens: next.output_tokens ?? current.output_tokens,
    ...(next.cache_creation_input_tokens !== undefined
      ? { cache_creation_input_tokens: next.cache_creation_input_tokens }
      : current.cache_creation_input_tokens !== undefined
        ? { cache_creation_input_tokens: current.cache_creation_input_tokens }
        : {}),
    ...(next.cache_read_input_tokens !== undefined
      ? { cache_read_input_tokens: next.cache_read_input_tokens }
      : current.cache_read_input_tokens !== undefined
        ? { cache_read_input_tokens: current.cache_read_input_tokens }
        : {}),
  };
}