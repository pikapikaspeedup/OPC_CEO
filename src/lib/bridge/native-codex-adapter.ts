/**
 * Native Codex Responses API Adapter
 *
 * Translates standard chat.completions-style requests into OpenAI's
 * Responses Streaming API format, targeting the Codex backend endpoint
 * at chatgpt.com/backend-api/codex.
 *
 * This adapter enables subscription-based (ChatGPT Plus/Pro) API access
 * without consuming API credits, by speaking the same protocol that
 * the official Codex web client uses.
 *
 * Key differences from standard chat.completions:
 *   - Endpoint: chatgpt.com/backend-api/codex (not api.openai.com/v1)
 *   - Format: Responses API (input_text/input_image, not messages array)
 *   - Forbidden params: temperature, max_output_tokens (causes 400)
 *   - Streaming: SSE via responses.stream() or manual SSE parsing
 *   - Auth: Bearer token from OAuth (not sk-* API key)
 *
 * Reference: hermes-agent/agent/auxiliary_client.py (_CodexCompletionsAdapter)
 */

import { createLogger } from '../logger';
import { resolveCodexAccessToken } from './native-codex-auth';
import type {
  AssistantMessage as PiAssistantMessage,
  Context as PiContext,
  TSchema,
  Tool as PiTool,
} from '@mariozechner/pi-ai';

const log = createLogger('NativeCodexAdapter');

// ─── Constants ─────────────────────────────────────────────────────────────

/** Codex backend API endpoint (ChatGPT web backend). */
const CODEX_BASE_URL = process.env.NATIVE_CODEX_BASE_URL?.trim()
  || 'https://chatgpt.com/backend-api/codex';

const DEFAULT_INSTRUCTIONS = 'You are a helpful assistant.';

/** Default model for native Codex. GPT-5.4 is the latest full model. */
const DEFAULT_MODEL = 'gpt-5.4';

/** Fallback model (Codex-optimized). */
export const CODEX_FALLBACK_MODEL = 'gpt-5.3-codex';

/** Available native Codex models. */
export const NATIVE_CODEX_MODELS = [
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2-codex',
] as const;

const INTERNAL_MODEL_FALLBACKS: Record<string, string> = {
  MODEL_PLACEHOLDER_M26: 'gpt-5.4',
  MODEL_PLACEHOLDER_M35: 'gpt-5.4',
  MODEL_PLACEHOLDER_M36: 'gpt-5.4-mini',
  MODEL_PLACEHOLDER_M37: 'gpt-5.4',
  MODEL_PLACEHOLDER_M47: 'gpt-5.4-mini',
  MODEL_AUTO: 'gpt-5.4',
};

const DEFAULT_NATIVE_CODEX_TIMEOUT_MS = 90_000;
let piAiModulePromise: Promise<typeof import('@mariozechner/pi-ai')> | null = null;

function getNativeCodexTimeoutMs(): number {
  const raw = process.env.NATIVE_CODEX_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_NATIVE_CODEX_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_NATIVE_CODEX_TIMEOUT_MS;
}

async function loadPiAi() {
  if (!piAiModulePromise) {
    piAiModulePromise = import('@mariozechner/pi-ai');
  }
  return piAiModulePromise;
}

export function normalizeNativeCodexModel(model?: string): string {
  if (!model) {
    return DEFAULT_MODEL;
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return DEFAULT_MODEL;
  }

  if ((NATIVE_CODEX_MODELS as readonly string[]).includes(trimmed)) {
    return trimmed;
  }

  const mapped = INTERNAL_MODEL_FALLBACKS[trimmed];
  if (mapped) {
    return mapped;
  }

  if (/mini/i.test(trimmed)) {
    return 'gpt-5.4-mini';
  }

  if (/^gpt-[\w.-]+$/i.test(trimmed)) {
    return trimmed;
  }

  return DEFAULT_MODEL;
}

// ─── Types ─────────────────────────────────────────────────────────────────

/** Standard message format (chat.completions-compatible). */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: string };
}

/** Function tool definition (OpenAI format). */
export interface FunctionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** Options for a native Codex completion request. */
export interface NativeCodexRequestOptions {
  /** Messages in standard chat.completions format. */
  messages: ChatMessage[];
  /** Model override. Defaults to gpt-5.4-codex. */
  model?: string;
  /** Function tools (optional). */
  tools?: FunctionTool[];
  /**
   * Whether to store the response in OpenAI's history.
   * Defaults to false for privacy.
   */
  store?: boolean;
  /** Optional abort signal for request cancellation. */
  signal?: AbortSignal;
}

/** Tool call in the response. */
export interface ToolCallResult {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Unified response from native Codex. */
export interface NativeCodexResponse {
  content: string | null;
  toolCalls: ToolCallResult[];
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface NativeCodexImageRequestOptions {
  prompt: string;
  model?: string;
  size?: '256x256' | '512x512' | '1024x1024';
  store?: boolean;
  signal?: AbortSignal;
}

export interface NativeCodexImageResponse {
  model: string;
  size: '1024x1024';
  imageBase64: string;
  mimeType: string;
  revisedPrompt?: string;
}

// ─── SSE Response Parsing ──────────────────────────────────────────────────

interface ResponsesOutputItem {
  type: string;
  role?: string;
  status?: string;
  content?: Array<{ type: string; text?: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
  result?: string;
  revised_prompt?: string;
}

interface ResponsesFinalResponse {
  output: ResponsesOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

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

function toMimeAndData(url: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(url);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
}

async function convertPiContentPart(part: ContentPart): Promise<
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
> {
  if (part.type === 'text') {
    return { type: 'text', text: part.text || '' };
  }

  const imageUrl = part.image_url?.url || '';
  const fromDataUrl = toMimeAndData(imageUrl);
  if (fromDataUrl) {
    return {
      type: 'image',
      data: fromDataUrl.data,
      mimeType: fromDataUrl.mimeType,
    };
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image input for pi-ai transport: HTTP ${response.status}`);
  }

  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    type: 'image',
    data: buffer.toString('base64'),
    mimeType,
  };
}

async function convertContentForPi(
  content: string | ContentPart[],
): Promise<string | Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>> {
  if (typeof content === 'string') {
    return content;
  }

  return Promise.all(content.map((part) => convertPiContentPart(part)));
}

async function toPiContext(
  opts: NativeCodexRequestOptions,
  model: string,
): Promise<PiContext> {
  const messages: PiContext['messages'] = [];
  const systemParts: string[] = [];
  const now = Date.now();

  for (let index = 0; index < opts.messages.length; index += 1) {
    const msg = opts.messages[index];
    if (msg.role === 'system') {
      const content = typeof msg.content === 'string'
        ? msg.content
        : msg.content.map((part) => part.type === 'text' ? (part.text || '') : '').join('\n');
      if (content.trim()) {
        systemParts.push(content.trim());
      }
      continue;
    }

    const timestamp = now + index;
    if (msg.role === 'user') {
      messages.push({
        role: 'user',
        content: await convertContentForPi(msg.content),
        timestamp,
      });
      continue;
    }

    messages.push({
      role: 'assistant',
      content: [{
        type: 'text',
        text: typeof msg.content === 'string'
          ? msg.content
          : msg.content.map((part) => part.type === 'text' ? (part.text || '') : '').join('\n'),
      }],
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      model,
      usage: { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } },
      stopReason: 'stop',
      timestamp,
    } satisfies PiAssistantMessage);
  }

  const tools: PiTool<TSchema>[] | undefined = opts.tools?.length
    ? opts.tools
        .filter((tool) => tool.function?.name)
        .map((tool) => ({
          name: tool.function.name,
          description: tool.function.description || '',
          parameters: (tool.function.parameters || { type: 'object', properties: {} }) as TSchema,
        }))
    : undefined;

  return {
    systemPrompt: systemParts.join('\n\n').trim() || undefined,
    messages,
    tools,
  };
}

function finishReasonFromPi(stopReason: PiAssistantMessage['stopReason']): NativeCodexResponse['finishReason'] {
  if (stopReason === 'toolUse') return 'tool_calls';
  if (stopReason === 'length') return 'length';
  if (stopReason === 'error' || stopReason === 'aborted') return 'error';
  return 'stop';
}

async function nativeCodexCompleteViaPi(
  opts: NativeCodexRequestOptions,
  accessToken: string,
  model: string,
): Promise<NativeCodexResponse> {
  const piAi = await loadPiAi();
  const piContext = await toPiContext(opts, model);
  const piModel = piAi.getModels('openai-codex').find((candidate) => candidate.id === model)
    ?? piAi.getModel('openai-codex', 'gpt-5.4');
  const result = await piAi.complete(piModel, piContext, {
    apiKey: accessToken,
    signal: opts.signal,
    transport: 'auto',
    timeoutMs: getNativeCodexTimeoutMs(),
    sessionId: opts.store ? `ag-native-codex-${Date.now()}` : undefined,
  });

  const text = result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim() || null;

  const toolCalls = result.content
    .filter((block): block is Extract<PiAssistantMessage['content'][number], { type: 'toolCall' }> => block.type === 'toolCall')
    .map((block) => ({
      id: block.id,
      type: 'function' as const,
      function: {
        name: block.name,
        arguments: JSON.stringify(block.arguments ?? {}),
      },
    }));

  return {
    content: text,
    toolCalls,
    model,
    usage: {
      promptTokens: result.usage.input,
      completionTokens: result.usage.output,
      totalTokens: result.usage.totalTokens,
    },
    finishReason: finishReasonFromPi(result.stopReason),
  };
}

/**
 * Parse the Responses API streamed SSE events into a final response.
 *
 * The Codex backend streams Server-Sent Events (SSE) with:
 *   - event: response.output_item.done
 *   - event: response.output_text.delta
 *   - event: response.done
 *
 * We collect all output items and text deltas, then assemble the final result.
 */
async function parseSSEStream(response: Response): Promise<{
  output: ResponsesOutputItem[];
  textDeltas: string[];
  usage: ResponsesFinalResponse['usage'] | null;
  hasFunctionCalls: boolean;
}> {
  const output: ResponsesOutputItem[] = [];
  const textDeltas: string[] = [];
  let usage: ResponsesFinalResponse['usage'] | null = null;
  let hasFunctionCalls = false;

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body from Codex endpoint');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();

        // SSE data lines
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);
            const eventType = event.type || '';

            if (eventType === 'response.output_item.done' && event.item) {
              output.push(event.item);
              if (event.item.type === 'function_call') {
                hasFunctionCalls = true;
              }
            } else if (eventType.includes('output_text.delta') && event.delta) {
              textDeltas.push(event.delta);
            } else if (eventType === 'response.done' && event.response?.usage) {
              usage = event.response.usage;
            }
          } catch {
            // Non-JSON data line, skip
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { output, textDeltas, usage, hasFunctionCalls };
}

// ─── Main Adapter ──────────────────────────────────────────────────────────

function normalizeNativeCodexImageSize(): '1024x1024' {
  return '1024x1024';
}

export async function nativeCodexGenerateImage(
  opts: NativeCodexImageRequestOptions,
): Promise<NativeCodexImageResponse> {
  const accessToken = await resolveCodexAccessToken();
  if (!accessToken) {
    throw new Error(
      'No Codex credentials available. Run `codex` in your terminal to authenticate.',
    );
  }

  const prompt = opts.prompt.trim();
  if (!prompt) {
    throw new Error('prompt is required');
  }

  const model = normalizeNativeCodexModel(opts.model);
  const size = normalizeNativeCodexImageSize();
  const payload: Record<string, unknown> = {
    model,
    instructions: DEFAULT_INSTRUCTIONS,
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: prompt }],
      },
    ],
    store: opts.store ?? false,
    stream: true,
    tool_choice: { type: 'image_generation' },
    tools: [{
      type: 'image_generation',
      size,
    }],
  };

  const timeoutMs = getNativeCodexTimeoutMs();
  const timeoutController = opts.signal ? null : new AbortController();
  const timeout = timeoutController
    ? setTimeout(() => timeoutController.abort(), timeoutMs)
    : null;

  let response: Response;
  try {
    response = await fetch(`${CODEX_BASE_URL}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal: opts.signal || timeoutController?.signal,
    });
  } catch (error: unknown) {
    if (timeoutController?.signal.aborted) {
      throw new Error(`Native Codex image generation timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Native Codex image generation error ${response.status}: ${errBody.slice(0, 300)}`);
  }

  const { output } = await parseSSEStream(response);
  const imageCall = output.find((item) => item.type === 'image_generation_call');
  const imageBase64 = imageCall?.result?.trim();
  if (!imageBase64) {
    throw new Error('Native Codex image generation returned no image payload');
  }

  return {
    model,
    size,
    imageBase64,
    mimeType: 'image/png',
    revisedPrompt: imageCall?.revised_prompt,
  };
}

export async function nativeCodexComplete(
  opts: NativeCodexRequestOptions
): Promise<NativeCodexResponse> {
  const accessToken = await resolveCodexAccessToken();
  if (!accessToken) {
    throw new Error(
      'No Codex credentials available. Run `codex` in your terminal to authenticate.'
    );
  }

  const requestedModel = opts.model;
  const model = normalizeNativeCodexModel(requestedModel);

  log.debug(
    { model, requestedModel, transport: 'pi-ai', messageCount: opts.messages.length, hasTools: !!opts.tools?.length },
    'Routing native Codex text/tool path through pi-ai',
  );

  return nativeCodexCompleteViaPi(opts, accessToken, model);
}

/**
 * Simple text-only completion helper.
 *
 * For quick one-shot prompts without tools or multimodal content.
 */
export async function nativeCodexChat(
  prompt: string,
  opts?: {
    model?: string;
    systemPrompt?: string;
  }
): Promise<string> {
  const messages: ChatMessage[] = [];
  if (opts?.systemPrompt) {
    messages.push({ role: 'system', content: opts.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const result = await nativeCodexComplete({
    messages,
    model: opts?.model,
  });

  return result.content || '';
}
