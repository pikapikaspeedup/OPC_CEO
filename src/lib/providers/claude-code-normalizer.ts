/**
 * Claude Code Event Normalizer — Phase 3
 *
 * Converts Claude Code's stream-json events into Antigravity platform-neutral
 * NormalizedStep and RunLiveState structures. Raw events are preserved as trace
 * but never leak into control plane.
 *
 * Ingest boundary: Claude Code's QueryEngine/query layer output (stream-json).
 */

import type { RunLiveState } from '../agents/group-types';

// ---------------------------------------------------------------------------
// Normalized Step (platform-neutral)
// ---------------------------------------------------------------------------

export type NormalizedStepKind =
  | 'assistant_text'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'system'
  | 'error';

export type NormalizedToolCategory =
  | 'file_read'
  | 'file_write'
  | 'file_edit'
  | 'shell'
  | 'web'
  | 'search'
  | 'mcp'
  | 'agent'
  | 'plan'
  | 'other';

export interface NormalizedStep {
  /** Which provider produced this step */
  provider: string;
  /** Step kind */
  kind: NormalizedStepKind;
  /** Current status */
  status: 'running' | 'completed' | 'failed';
  /** Short title for UI display */
  title: string;
  /** Preview of content (truncated for display) */
  preview?: string;
  /** Tool category (only for tool_use/tool_result) */
  toolCategory?: NormalizedToolCategory;
  /** Original tool name */
  toolName?: string;
  /** Files affected by this step */
  affectedPaths?: string[];
  /** When this step occurred */
  timestamp: string;
  /** Index into the raw event array (for correlation) */
  rawRef: number;
}

// ---------------------------------------------------------------------------
// Token Usage
// ---------------------------------------------------------------------------

export interface NormalizedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

// ---------------------------------------------------------------------------
// Normalization Result
// ---------------------------------------------------------------------------

export interface NormalizationResult {
  steps: NormalizedStep[];
  liveState: RunLiveState;
  tokenUsage: NormalizedTokenUsage;
  changedFiles: string[];
  summary: string;
  status: 'completed' | 'failed' | 'blocked';
}

// ---------------------------------------------------------------------------
// Claude Code stream-json event structure (subset we care about)
// ---------------------------------------------------------------------------

export interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  result?: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: string;
  is_error?: boolean;
  error?: { message?: string; type?: string };
  content_block?: { type: string; text?: string };
  message?: {
    id?: string;
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
      thinking?: string;
    }>;
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

// ---------------------------------------------------------------------------
// Tool Classification
// ---------------------------------------------------------------------------

const TOOL_CATEGORY_MAP: Record<string, NormalizedToolCategory> = {
  // File operations
  FileReadTool: 'file_read',
  Read: 'file_read',
  file_read: 'file_read',
  FileWriteTool: 'file_write',
  Write: 'file_write',
  file_write: 'file_write',
  FileEditTool: 'file_edit',
  Edit: 'file_edit',
  file_edit: 'file_edit',
  NotebookEditTool: 'file_edit',
  // Shell
  BashTool: 'shell',
  Bash: 'shell',
  bash: 'shell',
  PowerShellTool: 'shell',
  // Search
  GlobTool: 'search',
  Glob: 'search',
  GrepTool: 'search',
  Grep: 'search',
  // Web
  WebFetchTool: 'web',
  WebSearchTool: 'web',
  WebBrowserTool: 'web',
  // Agent
  AgentTool: 'agent',
  TaskCreateTool: 'agent',
  TaskUpdateTool: 'agent',
  // Plan
  EnterPlanModeTool: 'plan',
  ExitPlanModeTool: 'plan',
  VerifyPlanExecutionTool: 'plan',
};

function classifyTool(toolName: string): NormalizedToolCategory {
  return TOOL_CATEGORY_MAP[toolName] || 'other';
}

// ---------------------------------------------------------------------------
// File path extraction from tool events
// ---------------------------------------------------------------------------

function extractFilePath(toolInput: Record<string, unknown>): string | undefined {
  const candidates = ['file_path', 'path', 'filePath', 'file'];
  for (const key of candidates) {
    const val = toolInput[key];
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return undefined;
}

function extractFilePathsFromToolEvent(evt: ClaudeStreamEvent): string[] {
  if (!evt.tool_input) return [];
  const path = extractFilePath(evt.tool_input);
  return path ? [path] : [];
}

// ---------------------------------------------------------------------------
// Content truncation for preview
// ---------------------------------------------------------------------------

const MAX_PREVIEW_LENGTH = 200;

function truncate(text: string, maxLen = MAX_PREVIEW_LENGTH): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

// ---------------------------------------------------------------------------
// Step title generation
// ---------------------------------------------------------------------------

function stepTitle(evt: ClaudeStreamEvent, kind: NormalizedStepKind): string {
  if (kind === 'tool_use' && evt.tool_name) {
    const category = classifyTool(evt.tool_name);
    const paths = extractFilePathsFromToolEvent(evt);
    const suffix = paths.length > 0 ? `: ${paths[0]}` : '';
    return `${category}${suffix}`;
  }
  if (kind === 'tool_result') {
    return evt.is_error ? 'Tool error' : 'Tool result';
  }
  if (kind === 'thinking') return 'Thinking';
  if (kind === 'error') return 'Error';
  if (kind === 'system') return 'System';
  return 'Assistant';
}

// ---------------------------------------------------------------------------
// Main normalizer
// ---------------------------------------------------------------------------

export function normalizeClaudeCodeEvents(
  events: ClaudeStreamEvent[],
  providerId = 'claude-code',
): NormalizationResult {
  const steps: NormalizedStep[] = [];
  const changedFilesSet = new Set<string>();
  const tokenUsage: NormalizedTokenUsage = { inputTokens: 0, outputTokens: 0 };
  let lastStepType = '';
  let lastStepAt = '';
  let finalText = '';
  let hasErrors = false;
  let exitCode: number | null = null;

  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    const now = new Date().toISOString();

    // ── result event ──
    if (evt.type === 'result') {
      if (evt.result) finalText = evt.result;
      continue;
    }

    // ── error event ──
    if (evt.type === 'error' || evt.error) {
      hasErrors = true;
      steps.push({
        provider: providerId,
        kind: 'error',
        status: 'failed',
        title: 'Error',
        preview: truncate(evt.error?.message || 'Unknown error'),
        timestamp: now,
        rawRef: i,
      });
      continue;
    }

    // ── tool_use event ──
    if (evt.type === 'tool_use' || (evt.tool_name && !evt.tool_result)) {
      const category = classifyTool(evt.tool_name || '');
      const paths = extractFilePathsFromToolEvent(evt);

      // Track changed files
      if (category === 'file_write' || category === 'file_edit') {
        for (const p of paths) changedFilesSet.add(p);
      }

      lastStepType = evt.tool_name || 'tool_use';
      lastStepAt = now;

      steps.push({
        provider: providerId,
        kind: 'tool_use',
        status: 'completed',
        title: stepTitle(evt, 'tool_use'),
        preview: evt.tool_name ? `${evt.tool_name}(${paths.join(', ')})` : undefined,
        toolCategory: category,
        toolName: evt.tool_name,
        affectedPaths: paths.length > 0 ? paths : undefined,
        timestamp: now,
        rawRef: i,
      });
      continue;
    }

    // ── tool_result event ──
    if (evt.type === 'tool_result' || evt.tool_result !== undefined) {
      steps.push({
        provider: providerId,
        kind: 'tool_result',
        status: evt.is_error ? 'failed' : 'completed',
        title: stepTitle(evt, 'tool_result'),
        preview: evt.tool_result ? truncate(evt.tool_result) : undefined,
        timestamp: now,
        rawRef: i,
      });
      continue;
    }

    // ── message event (assistant text, thinking, tool content) ──
    if (evt.message?.content) {
      for (const block of evt.message.content) {
        if (block.type === 'thinking' && block.thinking) {
          steps.push({
            provider: providerId,
            kind: 'thinking',
            status: 'completed',
            title: 'Thinking',
            preview: truncate(block.thinking),
            timestamp: now,
            rawRef: i,
          });
        } else if (block.type === 'text' && block.text) {
          finalText = block.text;
          lastStepType = 'assistant_text';
          lastStepAt = now;
          steps.push({
            provider: providerId,
            kind: 'assistant_text',
            status: 'completed',
            title: 'Assistant',
            preview: truncate(block.text),
            timestamp: now,
            rawRef: i,
          });
        } else if (block.type === 'tool_use' && block.name) {
          const toolCategory = classifyTool(block.name);
          const input = block.input || {};
          const paths = extractFilePath(input) ? [extractFilePath(input)!] : [];

          if (toolCategory === 'file_write' || toolCategory === 'file_edit') {
            for (const p of paths) changedFilesSet.add(p);
          }

          lastStepType = block.name;
          lastStepAt = now;
          steps.push({
            provider: providerId,
            kind: 'tool_use',
            status: 'completed',
            title: stepTitle({ ...evt, tool_name: block.name, tool_input: input }, 'tool_use'),
            toolCategory,
            toolName: block.name,
            affectedPaths: paths.length > 0 ? paths : undefined,
            timestamp: now,
            rawRef: i,
          });
        }
      }

      // Accumulate token usage
      if (evt.message.usage) {
        tokenUsage.inputTokens += evt.message.usage.input_tokens || 0;
        tokenUsage.outputTokens += evt.message.usage.output_tokens || 0;
        if (evt.message.usage.cache_creation_input_tokens) {
          tokenUsage.cacheCreationInputTokens =
            (tokenUsage.cacheCreationInputTokens || 0) + evt.message.usage.cache_creation_input_tokens;
        }
        if (evt.message.usage.cache_read_input_tokens) {
          tokenUsage.cacheReadInputTokens =
            (tokenUsage.cacheReadInputTokens || 0) + evt.message.usage.cache_read_input_tokens;
        }
      }

      continue;
    }

    // ── content_block event (streaming partial) ──
    if (evt.content_block?.text) {
      finalText = evt.content_block.text;
    }
  }

  // Build live state from aggregated data
  const liveState: RunLiveState = {
    cascadeStatus: hasErrors ? 'failed' : 'completed',
    stepCount: steps.length,
    lastStepAt: lastStepAt || new Date().toISOString(),
    lastStepType: lastStepType || undefined,
  };

  // Determine overall status
  const status = hasErrors ? 'failed' : 'completed';

  // Build summary: prefer explicit result, then last assistant text
  const summary = finalText || (status === 'completed'
    ? 'Task completed'
    : 'Task failed');

  return {
    steps,
    liveState,
    tokenUsage,
    changedFiles: Array.from(changedFilesSet),
    summary,
    status,
  };
}

// ---------------------------------------------------------------------------
// Convenience: extract just changedFiles (for backward compat)
// ---------------------------------------------------------------------------

export function extractChangedFilesFromEvents(events: ClaudeStreamEvent[]): string[] {
  return normalizeClaudeCodeEvents(events).changedFiles;
}

// ---------------------------------------------------------------------------
// Convenience: extract just token usage
// ---------------------------------------------------------------------------

export function extractTokenUsageFromEvents(events: ClaudeStreamEvent[]): NormalizedTokenUsage {
  return normalizeClaudeCodeEvents(events).tokenUsage;
}
