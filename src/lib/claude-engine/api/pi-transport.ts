import type {
  Api as PiApi,
  AssistantMessage as PiAssistantMessage,
  Context as PiContext,
  Model as PiModel,
  TSchema,
  Tool as PiTool,
} from '@mariozechner/pi-ai';

import { createLogger } from '../../logger';
import { resolveCodexAccessToken } from '../../bridge/native-codex-auth';
import type { ProviderId } from '../../providers/types';

import { APIClientError } from './api-client-error';
import type { APIContentBlock, QueryOptions, StreamEvent, TokenUsage } from './types';

const log = createLogger('PiTransport');

let piAiModulePromise: Promise<typeof import('@mariozechner/pi-ai')> | null = null;

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
} as const;

function inferProviderId(options: QueryOptions): ProviderId {
  const explicit = options.model.providerId;
  if (explicit) {
    return explicit;
  }

  switch (options.model.provider) {
    case 'anthropic':
      return 'claude-api';
    case 'openai':
      return 'openai-api';
    case 'gemini':
      return 'gemini-api';
    case 'grok':
      return 'grok-api';
    case 'native-codex':
      return 'native-codex';
    case 'custom':
      return 'custom';
    default:
      return 'openai-api';
  }
}

async function loadPiAi() {
  if (!piAiModulePromise) {
    piAiModulePromise = import('@mariozechner/pi-ai');
  }
  return piAiModulePromise;
}

function buildPiUsage(usage: PiAssistantMessage['usage']): TokenUsage {
  return {
    input_tokens: usage.input ?? 0,
    output_tokens: usage.output ?? 0,
    cache_creation_input_tokens: usage.cacheWrite ?? 0,
    cache_read_input_tokens: usage.cacheRead ?? 0,
  };
}

function normalizeText(content: string | APIContentBlock[]): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .flatMap((block) => {
      if (block.type === 'text') return [block.text];
      if (block.type === 'thinking') return [block.thinking];
      if (block.type === 'tool_use') {
        return [`<tool-use name="${block.name}">${JSON.stringify(block.input)}</tool-use>`];
      }
      if (block.type === 'tool_result') {
        const nested = typeof block.content === 'string'
          ? block.content
          : normalizeText(block.content);
        return [`<tool-result id="${block.tool_use_id}">${nested}</tool-result>`];
      }
      return [];
    })
    .join('\n\n')
    .trim();
}

function toPiAssistantContent(blocks: APIContentBlock[]): PiAssistantMessage['content'] {
  return blocks.flatMap<PiAssistantMessage['content'][number]>((block) => {
    if (block.type === 'text') {
      return [{ type: 'text' as const, text: block.text }];
    }
    if (block.type === 'thinking') {
      return [{
        type: 'thinking' as const,
        thinking: block.thinking,
        ...(block.signature ? { thinkingSignature: block.signature } : {}),
      }];
    }
    if (block.type === 'tool_use') {
      return [{
        type: 'toolCall' as const,
        id: block.id,
        name: block.name,
        arguments: block.input,
      }];
    }
    return [];
  });
}

function toPiUserContent(blocks: APIContentBlock[]): string | Array<{ type: 'text'; text: string }> {
  const normalized = blocks.flatMap((block) => {
    if (block.type === 'text') {
      return [{ type: 'text' as const, text: block.text }];
    }
    if (block.type === 'thinking') {
      return [{ type: 'text' as const, text: block.thinking }];
    }
    return [];
  });
  return normalized.length === 1 ? normalized[0]!.text : normalized;
}

function extractToolResultMessages(
  blocks: APIContentBlock[],
  timestamp: number,
): Array<{
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: Array<{ type: 'text'; text: string }>;
  isError: boolean;
  timestamp: number;
}> {
  return blocks
    .filter((block): block is Extract<APIContentBlock, { type: 'tool_result' }> => block.type === 'tool_result')
    .map((block) => ({
      role: 'toolResult' as const,
      toolCallId: block.tool_use_id,
      toolName: block.tool_use_id,
      content: [{
        type: 'text' as const,
        text: typeof block.content === 'string' ? block.content : normalizeText(block.content),
      }],
      isError: Boolean(block.is_error),
      timestamp,
    }));
}

function toPiContext(options: QueryOptions): PiContext {
  const messages: PiContext['messages'] = [];
  let timestamp = Date.now();

  for (const message of options.messages) {
    if (message.role === 'assistant') {
      const blocks = typeof message.content === 'string'
        ? [{ type: 'text', text: message.content } satisfies APIContentBlock]
        : message.content;
      messages.push({
        role: 'assistant',
        content: toPiAssistantContent(blocks),
        api: 'openai-completions',
        provider: 'openai',
        model: options.model.model,
        usage: { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } },
        stopReason: 'stop',
        timestamp: timestamp++,
      });
      continue;
    }

    const blocks = typeof message.content === 'string'
      ? [{ type: 'text', text: message.content } satisfies APIContentBlock]
      : message.content;

    const toolResults = extractToolResultMessages(blocks, timestamp++);
    for (const toolResult of toolResults) {
      messages.push(toolResult);
    }

    const userBlocks = blocks.filter((block) => block.type !== 'tool_result');
    const hasUserContent = userBlocks.some((block) => {
      if (block.type === 'text') return Boolean(block.text.trim());
      if (block.type === 'thinking') return Boolean(block.thinking.trim());
      return false;
    });

    if (hasUserContent) {
      messages.push({
        role: 'user',
        content: toPiUserContent(userBlocks),
        timestamp: timestamp++,
      });
    }
  }

  const tools: PiTool<TSchema>[] | undefined = options.tools?.length
    ? options.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema as TSchema,
      }))
    : undefined;

  return {
    ...(options.systemPrompt.trim() ? { systemPrompt: options.systemPrompt } : {}),
    messages,
    ...(tools?.length ? { tools } : {}),
  };
}

function buildCustomOpenAiModel(options: QueryOptions): PiModel<'openai-completions'> {
  const baseUrl = options.model.baseUrl?.trim();
  if (!baseUrl) {
    throw new APIClientError('Custom provider requires a baseUrl for pi-ai transport');
  }

  return {
    id: options.model.model,
    name: options.model.model,
    api: 'openai-completions',
    provider: 'custom',
    baseUrl: baseUrl.replace(/\/+$/, ''),
    reasoning: /reason|think|gpt-5|deepseek/i.test(options.model.model),
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: options.maxOutputTokens ?? options.model.maxOutputTokens ?? 8192,
  };
}

async function resolvePiModel(options: QueryOptions): Promise<PiModel<PiApi>> {
  const piAi = await loadPiAi();
  const providerId = inferProviderId(options);
  const requestedModel = options.model.model;

  if (providerId === 'custom') {
    return buildCustomOpenAiModel(options);
  }

  const providerMap: Partial<Record<ProviderId, 'anthropic' | 'openai' | 'google' | 'xai' | 'openai-codex'>> = {
    'claude-api': 'anthropic',
    'openai-api': 'openai',
    'gemini-api': 'google',
    'grok-api': 'xai',
    'native-codex': 'openai-codex',
  };

  const piProvider = providerMap[providerId];
  if (!piProvider) {
    throw new APIClientError(`pi-ai transport is not available for provider ${providerId}`);
  }

  const models = piAi.getModels(piProvider);
  const match = models.find((model) => model.id === requestedModel);
  if (match) {
    return options.model.baseUrl?.trim()
      ? { ...match, baseUrl: options.model.baseUrl.trim().replace(/\/+$/, '') }
      : match;
  }

  const fallback = models[0];
  if (!fallback) {
    throw new APIClientError(`No pi-ai models registered for provider ${piProvider}`);
  }

  return {
    ...fallback,
    id: requestedModel,
    name: requestedModel,
    ...(options.model.baseUrl?.trim() ? { baseUrl: options.model.baseUrl.trim().replace(/\/+$/, '') } : {}),
  };
}

function mapStopReason(stopReason: PiAssistantMessage['stopReason']): string | null {
  if (stopReason === 'toolUse') return 'tool_use';
  if (stopReason === 'length') return 'max_tokens';
  return 'end_turn';
}

function abortError(message: string): DOMException | Error {
  if (typeof DOMException === 'function') {
    return new DOMException(message, 'AbortError');
  }
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export async function* streamQueryViaPi(options: QueryOptions): AsyncGenerator<StreamEvent> {
  const piAi = await loadPiAi();
  const providerId = inferProviderId(options);
  const model = await resolvePiModel(options);
  const context = toPiContext(options);
  const messageId = `pi-${providerId}-${Date.now()}`;
  const toolDeltaSeen = new Set<number>();
  const apiKey = providerId === 'native-codex'
    ? (
      options.model.apiKey?.trim()
      || await resolveCodexAccessToken()
      || undefined
    )
    : options.model.apiKey?.trim() || undefined;

  if (providerId === 'native-codex' && !apiKey) {
    throw new APIClientError(
      'No Codex credentials available. Run `codex` in your terminal to authenticate.',
    );
  }

  log.debug(
    { providerId, model: model.id, transport: options.model.transport, hasTools: Boolean(options.tools?.length) },
    'Dispatching ClaudeEngine request via pi-ai transport',
  );

  const stream = piAi.stream(model, context, {
    ...(apiKey ? { apiKey } : {}),
    ...(options.model.temperature !== undefined ? { temperature: options.model.temperature } : {}),
    ...(options.maxOutputTokens ? { maxTokens: options.maxOutputTokens } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(providerId === 'native-codex' ? { transport: 'auto' as const } : {}),
    timeoutMs: 90_000,
  });

  yield {
    type: 'message_start',
    message: {
      id: messageId,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };

  for await (const event of stream) {
    switch (event.type) {
      case 'text_start':
        yield {
          type: 'content_block_start',
          index: event.contentIndex,
          content_block: { type: 'text', text: '' },
        };
        break;
      case 'text_delta':
        yield {
          type: 'content_block_delta',
          index: event.contentIndex,
          delta: { type: 'text_delta', text: event.delta },
        };
        break;
      case 'text_end':
        yield { type: 'content_block_stop', index: event.contentIndex };
        break;
      case 'thinking_start':
        yield {
          type: 'content_block_start',
          index: event.contentIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        };
        break;
      case 'thinking_delta':
        yield {
          type: 'content_block_delta',
          index: event.contentIndex,
          delta: { type: 'thinking_delta', thinking: event.delta },
        };
        break;
      case 'thinking_end':
        yield { type: 'content_block_stop', index: event.contentIndex };
        break;
      case 'toolcall_start': {
        const partial = event.partial.content[event.contentIndex];
        const name = partial?.type === 'toolCall' ? partial.name : `tool-${event.contentIndex}`;
        const id = partial?.type === 'toolCall' ? partial.id : `tool-${event.contentIndex}`;
        yield {
          type: 'content_block_start',
          index: event.contentIndex,
          content_block: { type: 'tool_use', id, name, input: {} },
        };
        break;
      }
      case 'toolcall_delta':
        toolDeltaSeen.add(event.contentIndex);
        yield {
          type: 'content_block_delta',
          index: event.contentIndex,
          delta: { type: 'input_json_delta', partial_json: event.delta },
        };
        break;
      case 'toolcall_end':
        if (!toolDeltaSeen.has(event.contentIndex)) {
          yield {
            type: 'content_block_delta',
            index: event.contentIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: JSON.stringify(event.toolCall.arguments ?? {}),
            },
          };
        }
        yield { type: 'content_block_stop', index: event.contentIndex };
        break;
      case 'error': {
        if (event.reason === 'aborted') {
          throw abortError(event.error.errorMessage || 'pi-ai request aborted');
        }
        throw new APIClientError(event.error.errorMessage || 'pi-ai request failed');
      }
      default:
        break;
    }
  }

  const result = await stream.result();
  if (result.stopReason === 'aborted') {
    throw abortError(result.errorMessage || 'pi-ai request aborted');
  }
  if (result.stopReason === 'error') {
    throw new APIClientError(result.errorMessage || 'pi-ai request failed');
  }

  const usage = buildPiUsage(result.usage);
  yield {
    type: 'message_delta',
    delta: { stop_reason: mapStopReason(result.stopReason) },
    usage,
  };
  yield { type: 'message_stop' };
}
