/**
 * Claude Engine Message 类型定义
 * 精简自 claude-code/src/types/message.ts
 */

export type TextBlock = {
  type: 'text';
  text: string;
};

export type ThinkingBlock = {
  type: 'thinking';
  thinking: string;
};

export type ToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};

/** ToolResult 内嵌内容只允许 text，不允许嵌套 tool_use / tool_result */
export type ToolResultContentBlock = TextBlock;

export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ToolResultContentBlock[];
  is_error?: boolean;
};

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock;

export type MessageRole = 'user' | 'assistant' | 'system';

export type BaseMessage = {
  role: MessageRole;
  content: string | ContentBlock[];
};

export type UserMessage = BaseMessage & {
  role: 'user';
};

export type AssistantMessage = BaseMessage & {
  role: 'assistant';
};

export type SystemMessage = BaseMessage & {
  role: 'system';
};

export type Message = UserMessage | AssistantMessage | SystemMessage;

export type StreamEventType =
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop';

export type StreamEvent = {
  type: StreamEventType;
  index?: number;
  message?: {
    id: string;
    model: string;
    role: 'assistant';
    content: ContentBlock[];
    usage?: TokenUsage;
  };
  content_block?: ContentBlock;
  delta?: {
    type: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
    stop_sequence?: string;
  };
  usage?: TokenUsage;
};

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};