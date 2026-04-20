import type { APIContentBlock, APIMessage, ModelConfig, StreamEvent, ThinkingConfig, TokenUsage } from '../api/types';
import type { Tool, ToolContext, ToolResult } from '../types';
import type { CacheBreakEvent } from '../api/prompt-cache-monitor';

export type EngineConfig = {
  model: ModelConfig;
  tools?: Tool[];
  systemPrompt?: string;
  maxTurns?: number;
  maxTokenBudget?: number;
  /** Max estimated context tokens before triggering auto-compact */
  maxContextTokens?: number;
  /** Compact threshold ratio (0-1). Default: 0.85 — compact when context reaches 85% of limit */
  compactThreshold?: number;
  /** Model config for compaction summarization (defaults to Haiku) */
  compactModel?: ModelConfig;
  /** Max output truncation retries ("continue working" injections) */
  maxContinuationRetries?: number;
  thinking?: ThinkingConfig;
  toolContext: ToolContext;
  messages?: APIMessage[];
  /** Toolset name to restrict which tools are sent to the API (e.g. 'research', 'coding', 'safe') */
  toolset?: string;
};

export type TurnResult = {
  turnNumber: number;
  assistantMessage: APIMessage;
  toolResults: ToolCallResult[];
  usage: TokenUsage;
  stopReason: StopReason;
};

export type ToolCallResult = {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  result: ToolResult;
  isError: boolean;
  durationMs: number;
};

export type StopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_turns'
  | 'aborted'
  | 'error'
  | 'token_budget'
  | 'compacted'
  | 'continuation_exhausted'
  | 'budget_exhausted';

export type EngineEvent =
  | { type: 'turn_start'; turnNumber: number }
  | { type: 'stream_event'; event: StreamEvent }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'tool_start'; toolUseId: string; toolName: string; input: Record<string, unknown> }
  | {
      type: 'tool_end';
      toolUseId: string;
      toolName: string;
      result: ToolResult;
      isError: boolean;
      durationMs: number;
    }
  | { type: 'turn_end'; turnResult: TurnResult }
  | { type: 'retry'; attempt: number; maxAttempts: number; delayMs: number; statusCode: number; errorMessage: string }
  | { type: 'compaction'; removedMessages: number; estimatedTokensBefore: number; estimatedTokensAfter: number }
  | { type: 'continuation'; attempt: number; maxAttempts: number }
  | { type: 'cache_break'; event: CacheBreakEvent }
  | { type: 'budget_warning'; turnsUsed: number; turnsRemaining: number; maxTurns: number }
  | { type: 'complete'; totalTurns: number; totalUsage: TokenUsage; stopReason: StopReason };

export type ToolUseBlock = Extract<APIContentBlock, { type: 'tool_use' }>;