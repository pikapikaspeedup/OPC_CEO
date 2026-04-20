import type { TokenUsage as BaseTokenUsage } from '../types';

export type APIProvider = 'anthropic' | 'openai' | 'gemini' | 'grok' | 'native-codex' | 'bedrock' | 'vertex';

export type ModelConfig = {
  model: string;
  apiKey: string;
  baseUrl?: string;
  provider?: APIProvider;
  maxOutputTokens?: number;
  temperature?: number;
};

export type ThinkingConfig =
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' };

export type APIMessage = {
  role: 'user' | 'assistant';
  content: APIContentBlock[] | string;
};

export type APIContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string | APIContentBlock[];
      is_error?: boolean;
    }
  | { type: 'thinking'; thinking: string; signature: string };

export type APITool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type QueryOptions = {
  model: ModelConfig;
  systemPrompt: string;
  messages: APIMessage[];
  tools?: APITool[];
  thinking?: ThinkingConfig;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  betas?: string[];
};

export type ContentDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'input_json_delta'; partial_json: string }
  | { type: 'thinking_delta'; thinking: string };

export type TokenUsage = BaseTokenUsage;

export type StreamEvent =
  | { type: 'message_start'; message: { id: string; usage: TokenUsage } }
  | { type: 'content_block_start'; index: number; content_block: APIContentBlock }
  | { type: 'content_block_delta'; index: number; delta: ContentDelta }
  | { type: 'content_block_stop'; index: number }
  | {
      type: 'message_delta';
      delta: { stop_reason: string | null };
      usage: TokenUsage;
    }
  | { type: 'message_stop' }
  | { type: 'error'; error: { type: string; message: string } };

export type APIResponse = {
  id: string;
  content: APIContentBlock[];
  stop_reason: string | null;
  usage: TokenUsage;
  model: string;
};
