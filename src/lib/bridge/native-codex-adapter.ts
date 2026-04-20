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

const log = createLogger('NativeCodexAdapter');

// ─── Constants ─────────────────────────────────────────────────────────────

/** Codex backend API endpoint (ChatGPT web backend). */
const CODEX_BASE_URL = process.env.NATIVE_CODEX_BASE_URL?.trim()
  || 'https://chatgpt.com/backend-api/codex';

/** Default model for native Codex. GPT-5.4 is the latest full model. */
const DEFAULT_MODEL = 'gpt-5.4';

/** Fallback model (Codex-optimized). */
export const CODEX_FALLBACK_MODEL = 'gpt-5.3-codex';

/** Available native Codex models. */
export const NATIVE_CODEX_MODELS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
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

// ─── Content Conversion ────────────────────────────────────────────────────

/**
 * Convert chat.completions content to Responses API format.
 *
 * chat.completions uses:
 *   { type: "text", text: "..." }
 *   { type: "image_url", image_url: { url: "..." } }
 *
 * Responses API uses:
 *   { type: "input_text", text: "..." }
 *   { type: "input_image", image_url: "..." }
 */
function convertContentForResponses(
  content: string | ContentPart[]
): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content;

  return content.map((part) => {
    if (part.type === 'text') {
      return { type: 'input_text', text: part.text || '' };
    }
    if (part.type === 'image_url' && part.image_url) {
      const entry: Record<string, unknown> = {
        type: 'input_image',
        image_url: part.image_url.url,
      };
      if (part.image_url.detail) {
        entry.detail = part.image_url.detail;
      }
      return entry;
    }
    // Unknown type, pass through as text
    return { type: 'input_text', text: part.text || '' };
  });
}

/**
 * Convert function tools from chat.completions format to Responses API format.
 */
function convertToolsForResponses(
  tools: FunctionTool[]
): Array<Record<string, unknown>> {
  return tools
    .filter((t) => t.function?.name)
    .map((t) => ({
      type: 'function',
      name: t.function.name,
      description: t.function.description || '',
      parameters: t.function.parameters || {},
    }));
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
}

interface ResponsesFinalResponse {
  output: ResponsesOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
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

/**
 * Send a completion request to the native Codex backend.
 *
 * This is the core function that translates standard chat.completions-style
 * requests into OpenAI's internal Responses API format and sends them to
 * the Codex backend endpoint.
 *
 * @throws Error if no valid Codex auth tokens are available
 * @throws Error if the API call fails
 */
export async function nativeCodexComplete(
  opts: NativeCodexRequestOptions
): Promise<NativeCodexResponse> {
  // 1. Resolve auth token
  const accessToken = await resolveCodexAccessToken();
  if (!accessToken) {
    throw new Error(
      'No Codex credentials available. Run `codex` in your terminal to authenticate.'
    );
  }

  const requestedModel = opts.model;
  const model = normalizeNativeCodexModel(requestedModel);

  // 2. Build Responses API payload
  //    Separate system instructions from conversation messages
  let instructions = 'You are a helpful assistant.';
  const inputMessages: Array<Record<string, unknown>> = [];

  for (const msg of opts.messages) {
    if (msg.role === 'system') {
      instructions = typeof msg.content === 'string' ? msg.content : String(msg.content);
    } else {
      inputMessages.push({
        role: msg.role,
        content: convertContentForResponses(msg.content),
      });
    }
  }

  const payload: Record<string, unknown> = {
    model,
    instructions,
    input: inputMessages.length > 0
      ? inputMessages
      : [{ role: 'user', content: '' }],
    store: opts.store ?? false,
    stream: true,
  };

  // Add tools if provided
  if (opts.tools && opts.tools.length > 0) {
    payload.tools = convertToolsForResponses(opts.tools);
  }

  // CRITICAL: Do NOT include temperature or max_output_tokens.
  // The Codex backend rejects them with HTTP 400.

  log.debug(
    { model, requestedModel, messageCount: opts.messages.length, hasTools: !!opts.tools?.length },
    'Sending native Codex request'
  );

  // 3. Stream the response
  const url = `${CODEX_BASE_URL}/responses`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
    signal: opts.signal,
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    log.error(
      { status: response.status, body: errBody.slice(0, 500), model },
      'Native Codex API error'
    );
    throw new Error(
      `Native Codex API error ${response.status}: ${errBody.slice(0, 300)}`
    );
  }

  // 4. Parse SSE stream
  const { output, textDeltas, usage, hasFunctionCalls } = await parseSSEStream(response);

  // 5. Extract text content and tool calls from output items
  const textParts: string[] = [];
  const toolCalls: ToolCallResult[] = [];

  for (const item of output) {
    if (item.type === 'message') {
      for (const part of item.content || []) {
        if (part.type === 'output_text' || part.type === 'text') {
          textParts.push(part.text || '');
        }
      }
    } else if (item.type === 'function_call') {
      toolCalls.push({
        id: item.call_id || '',
        type: 'function',
        function: {
          name: item.name || '',
          arguments: item.arguments || '{}',
        },
      });
    }
  }

  // Backfill from text deltas if output items were empty
  if (textParts.length === 0 && textDeltas.length > 0 && !hasFunctionCalls) {
    textParts.push(textDeltas.join(''));
    log.debug(
      { deltaCount: textDeltas.length },
      'Backfilled text from stream deltas'
    );
  }

  const content = textParts.join('').trim() || null;

  return {
    content,
    toolCalls,
    model,
    usage: usage
      ? {
          promptTokens: usage.input_tokens || 0,
          completionTokens: usage.output_tokens || 0,
          totalTokens: usage.total_tokens || 0,
        }
      : null,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
  };
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
