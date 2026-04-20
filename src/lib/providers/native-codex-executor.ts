/**
 * NativeCodexExecutor — TaskExecutor for native Codex OAuth integration.
 *
 * Unlike the legacy CodexExecutor (which spawns `codex mcp-server` as a
 * subprocess), this executor calls the Codex backend API directly in-process
 * via the native-codex-adapter, using OAuth tokens from ~/.codex/auth.json.
 *
 * Benefits over the MCP subprocess approach:
 *   - No dependency on the `codex` binary being installed
 *   - Uses ChatGPT Plus/Pro subscription (no API credit burn)
 *   - Full in-process control of every response and tool call
 *   - Lower latency (no IPC overhead)
 *   - Access to latest models (gpt-5.4-codex, gpt-5.4-mini-codex)
 *
 * Replaces: codex-executor.ts + codex-adapter.ts (MCP subprocess)
 *
 * Department runtime note:
 * - agent-runs / AgentBackend mainline should prefer Claude Engine provider routing
 * - this executor is retained for local conversation and optional direct-use flows
 */

import * as fs from 'fs';
import * as path from 'path';
import { appendRunHistoryEntry, readRunHistory } from '../agents/run-history';
import { createLogger } from '../logger';
import {
  nativeCodexComplete,
  type ChatMessage,
  type NativeCodexResponse,
} from '../bridge/native-codex-adapter';
import type {
  TaskExecutor,
  TaskExecutionOptions,
  TaskExecutionResult,
  AppendMessageOptions,
  ProviderCapabilities,
} from './types';

const log = createLogger('NativeCodexExecutor');

// ---------------------------------------------------------------------------
// Conversation history for multi-turn support
// ---------------------------------------------------------------------------

interface ConversationEntry {
  messages: ChatMessage[];
  workspace: string;
  lastContent: string;
}

const globalForNativeCodexConversations = globalThis as unknown as {
  __AG_NATIVE_CODEX_CONVERSATIONS__?: Map<string, ConversationEntry>;
};

const conversations = globalForNativeCodexConversations.__AG_NATIVE_CODEX_CONVERSATIONS__ || new Map<string, ConversationEntry>();

if (process.env.NODE_ENV !== 'production') {
  globalForNativeCodexConversations.__AG_NATIVE_CODEX_CONVERSATIONS__ = conversations;
}

function flattenChatMessageContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => part.type === 'text' ? (part.text || '') : '')
    .join('\n')
    .trim();
}

export function getNativeCodexConversation(handle: string): Array<{ role: 'user' | 'assistant'; content: string }> | null {
  const conversation = conversations.get(handle);
  if (!conversation) return null;
  return conversation.messages
    .filter((message): message is ChatMessage & { role: 'user' | 'assistant' } => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: flattenChatMessageContent(message.content) }));
}

// ---------------------------------------------------------------------------
// Organization-level memory reader
// ---------------------------------------------------------------------------

function readOrgMemory(): string {
  const memoryDir = path.join(process.env.HOME || '~', '.gemini', 'antigravity', 'memory');
  if (!fs.existsSync(memoryDir)) return '';
  try {
    const files = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'));
    return files.map(f => fs.readFileSync(path.join(memoryDir, f), 'utf-8')).join('\n\n');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// File change detection
// ---------------------------------------------------------------------------

function detectChangedFiles(workspace: string, artifactAbsDir: string): string[] {
  if (!fs.existsSync(artifactAbsDir)) return [];
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(workspace, full));
    }
  }
  try { walk(artifactAbsDir); } catch { /* ignore */ }
  return files;
}

function rebuildConversationFromHistory(handle: string, runId: string, workspace: string): ConversationEntry | null {
  const history = readRunHistory(runId);
  if (history.length === 0) return null;

  const messages: ChatMessage[] = [];
  for (const entry of history) {
    if (entry.sessionHandle && entry.sessionHandle !== handle) {
      continue;
    }
    if (entry.eventType !== 'conversation.message.user' && entry.eventType !== 'conversation.message.assistant') {
      continue;
    }
    const content = typeof entry.details.content === 'string' ? entry.details.content : '';
    if (!content.trim()) continue;
    messages.push({
      role: entry.eventType === 'conversation.message.user' ? 'user' : 'assistant',
      content,
    });
  }

  if (messages.length === 0) return null;
  return {
    messages,
    workspace,
    lastContent: flattenChatMessageContent(messages[messages.length - 1]?.content || ''),
  };
}

// ---------------------------------------------------------------------------
// NativeCodexExecutor
// ---------------------------------------------------------------------------

export class NativeCodexExecutor implements TaskExecutor {
  readonly providerId = 'native-codex';

  async executeTask(opts: TaskExecutionOptions): Promise<TaskExecutionResult> {
    const shortRunId = opts.runId?.slice(0, 8) || '???';
    log.info(
      { runId: shortRunId, roleId: opts.roleId, model: opts.model, provider: 'native-codex' },
      'Starting native Codex execution'
    );

    // Build messages
    const messages: ChatMessage[] = [];

    // System prompt (org memory + base instructions)
    const orgMemory = opts.baseInstructions || readOrgMemory();
    if (orgMemory) {
      messages.push({ role: 'system', content: orgMemory });
    }

    // Artifact directory instruction
    if (opts.artifactDir) {
      const artifactInstruction = `\nIMPORTANT: Write all output files to the directory: ${opts.artifactDir}/`;
      if (messages.length > 0 && messages[0].role === 'system') {
        messages[0].content += artifactInstruction;
      } else {
        messages.unshift({ role: 'system', content: artifactInstruction });
      }
    }

    // User prompt
    messages.push({ role: 'user', content: opts.prompt });

    // Execute
    let response: NativeCodexResponse;
    try {
      response = await nativeCodexComplete({
        messages,
        model: opts.model,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ runId: shortRunId, err: message }, 'Native Codex execution failed');
      return {
        handle: `native-codex-${Date.now()}`,
        content: `Native Codex execution failed: ${message}`,
        steps: [],
        changedFiles: [],
        status: 'failed',
      };
    }

    const handle = `native-codex-${opts.runId || Date.now()}`;

    // Store conversation for multi-turn
    conversations.set(handle, {
      messages: [...messages, { role: 'assistant', content: response.content || '' }],
      workspace: opts.workspace,
      lastContent: response.content || '',
    });
    if (opts.runId) {
      appendRunHistoryEntry({
        runId: opts.runId,
        provider: this.providerId,
        sessionHandle: handle,
        eventType: 'conversation.message.user',
        details: { content: opts.prompt },
      });
      appendRunHistoryEntry({
        runId: opts.runId,
        provider: this.providerId,
        sessionHandle: handle,
        eventType: 'conversation.message.assistant',
        details: {
          content: response.content || '',
          finishReason: response.finishReason,
        },
      });
      if (response.toolCalls.length > 0) {
        appendRunHistoryEntry({
          runId: opts.runId,
          provider: this.providerId,
          sessionHandle: handle,
          eventType: 'provider.tool_calls',
          details: {
            count: response.toolCalls.length,
            items: response.toolCalls,
          },
        });
      }
    }

    log.info({
      runId: shortRunId,
      roleId: opts.roleId,
      model: response.model,
      contentLength: response.content?.length || 0,
      usage: response.usage,
      toolCalls: response.toolCalls.length,
    }, 'Native Codex execution completed');

    // Detect changed files
    const artifactAbsDir = opts.artifactDir
      ? path.join(opts.workspace, opts.artifactDir)
      : opts.workspace;
    const changedFiles = detectChangedFiles(opts.workspace, artifactAbsDir);

    return {
      handle,
      content: response.content || 'Task completed (no output)',
      steps: [], // Native Codex doesn't provide step data
      changedFiles,
      status: 'completed',
    };
  }

  async appendMessage(handle: string, opts: AppendMessageOptions): Promise<TaskExecutionResult> {
    const runId = opts.runId || handle.replace(/^native-codex-/, '');
    const conversation = conversations.get(handle)
      || rebuildConversationFromHistory(handle, runId, opts.workspace || process.cwd());
    if (!conversation) {
      throw new Error(`No conversation found for native Codex handle ${handle}`);
    }
    conversations.set(handle, conversation);

    // Append the new user message
    conversation.messages.push({ role: 'user', content: opts.prompt });

    let response: NativeCodexResponse;
    try {
      response = await nativeCodexComplete({
        messages: conversation.messages,
        model: opts.model,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ handle, err: message }, 'Native Codex append failed');
      return {
        handle,
        content: `Follow-up failed: ${message}`,
        steps: [],
        changedFiles: [],
        status: 'failed',
      };
    }

    // Update conversation
    conversation.messages.push({ role: 'assistant', content: response.content || '' });
    conversation.lastContent = response.content || '';
    appendRunHistoryEntry({
      runId,
      provider: this.providerId,
      sessionHandle: handle,
      eventType: 'conversation.message.user',
      details: { content: opts.prompt },
    });
    appendRunHistoryEntry({
      runId,
      provider: this.providerId,
      sessionHandle: handle,
      eventType: 'conversation.message.assistant',
      details: {
        content: response.content || '',
        finishReason: response.finishReason,
      },
    });
    if (response.toolCalls.length > 0) {
      appendRunHistoryEntry({
        runId,
        provider: this.providerId,
        sessionHandle: handle,
        eventType: 'provider.tool_calls',
        details: {
          count: response.toolCalls.length,
          items: response.toolCalls,
        },
      });
    }

    return {
      handle,
      content: response.content || '',
      steps: [],
      changedFiles: [],
      status: 'completed',
    };
  }

  async cancel(_handle: string): Promise<void> {
    // Native Codex uses fetch — no subprocess to kill.
    // In-flight requests can't be cancelled without AbortController.
    // TODO: Track AbortControllers for cancellation support.
    log.warn({ handle: _handle }, 'Native Codex cancel is a no-op (no subprocess)');
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false,  // TODO: Add streaming support via SSE event forwarding
      supportsMultiTurn: true,
      supportsIdeSkills: false,
      supportsSandbox: false,   // No filesystem sandbox (runs in-process)
      supportsCancel: false,
      supportsStepWatch: false,
    };
  }
}

/**
 * Check if native Codex is available (tokens exist on disk).
 * Use this before attempting to create a NativeCodexExecutor.
 */
export { isNativeCodexAvailable } from '../bridge/native-codex-auth';
