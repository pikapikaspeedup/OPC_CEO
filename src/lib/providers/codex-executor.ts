/**
 * CodexExecutor — TaskExecutor implementation for OpenAI Codex CLI.
 *
 * Wraps CodexMCPClient (codex-adapter.ts) behind the TaskExecutor interface.
 * Codex uses synchronous MCP sessions: start → wait → result.
 */

import * as fs from 'fs';
import * as path from 'path';
import { appendRunHistoryEntry } from '../agents/run-history';
import { createLogger } from '../logger';
import { CodexMCPClient } from '../bridge/codex-adapter';
import type {
  TaskExecutor,
  TaskExecutionOptions,
  TaskExecutionResult,
  AppendMessageOptions,
  ProviderCapabilities,
} from './types';

const log = createLogger('CodexExecutor');

// ---------------------------------------------------------------------------
// Codex MCP client pool (one per workspace)
// ---------------------------------------------------------------------------

const clients = new Map<string, CodexMCPClient>();
const globalForCodexConversations = globalThis as unknown as {
  __AG_CODEX_CONVERSATIONS__?: Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>;
};
const conversations = globalForCodexConversations.__AG_CODEX_CONVERSATIONS__ || new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();

if (process.env.NODE_ENV !== 'production') {
  globalForCodexConversations.__AG_CODEX_CONVERSATIONS__ = conversations;
}

async function getClient(workspace: string): Promise<CodexMCPClient> {
  let client = clients.get(workspace);
  if (client) return client;

  client = new CodexMCPClient();
  await client.start(workspace);
  clients.set(workspace, client);
  return client;
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
// File change detection (Codex doesn't report changed files)
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

// ---------------------------------------------------------------------------
// CodexExecutor
// ---------------------------------------------------------------------------

/** Thread handle → workspace mapping for appendMessage/cancel. */
const threadWorkspaces = new Map<string, string>();

export class CodexExecutor implements TaskExecutor {
  readonly providerId = 'codex';

  async executeTask(opts: TaskExecutionOptions): Promise<TaskExecutionResult> {
    const shortRunId = opts.runId?.slice(0, 8) || '???';
    log.info({ runId: shortRunId, roleId: opts.roleId, provider: 'codex' }, 'Starting Codex MCP session');

    const client = await getClient(opts.workspace);
    const orgMemory = opts.baseInstructions || readOrgMemory();

    const result = await client.startSession(opts.prompt, {
      cwd: opts.workspace,
      sandbox: 'workspace-write',
      approvalPolicy: 'never',
      model: opts.model,
      baseInstructions: orgMemory || undefined,
    });

    log.info({
      runId: shortRunId,
      roleId: opts.roleId,
      threadId: result.threadId.slice(0, 8),
      contentLength: result.content.length,
    }, 'Codex MCP session completed');

    // Track thread → workspace for appendMessage/cancel
    if (result.threadId) {
      threadWorkspaces.set(result.threadId, opts.workspace);
      conversations.set(result.threadId, [
        { role: 'user', content: opts.prompt },
        { role: 'assistant', content: result.content },
      ]);
    }
    if (opts.runId) {
      appendRunHistoryEntry({
        runId: opts.runId,
        provider: this.providerId,
        sessionHandle: result.threadId || `codex-${Date.now()}`,
        eventType: 'conversation.message.user',
        details: { content: opts.prompt },
      });
      appendRunHistoryEntry({
        runId: opts.runId,
        provider: this.providerId,
        sessionHandle: result.threadId || `codex-${Date.now()}`,
        eventType: 'conversation.message.assistant',
        details: { content: result.content },
      });
    }

    // Detect changed files by scanning artifact directory
    const artifactAbsDir = opts.artifactDir
      ? path.join(opts.workspace, opts.artifactDir)
      : opts.workspace;
    const changedFiles = detectChangedFiles(opts.workspace, artifactAbsDir);

    return {
      handle: result.threadId || `codex-${Date.now()}`,
      content: result.content,
      steps: [], // Codex doesn't provide step data
      changedFiles,
      status: 'completed',
    };
  }

  async appendMessage(handle: string, opts: AppendMessageOptions): Promise<TaskExecutionResult> {
    const workspace = opts.workspace || threadWorkspaces.get(handle);
    if (!workspace) {
      throw new Error(`No workspace found for Codex thread ${handle}`);
    }

    const client = await getClient(workspace);
    const result = await client.reply(handle, opts.prompt);
    const history = conversations.get(handle) || [];
    history.push({ role: 'user', content: opts.prompt });
    history.push({ role: 'assistant', content: result.content });
    conversations.set(handle, history);
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
        details: { content: result.content },
      });
    }

    return {
      handle: result.threadId || handle,
      content: result.content,
      steps: [],
      changedFiles: [],
      status: 'completed',
    };
  }

  async cancel(handle: string): Promise<void> {
    // Codex MCP sessions are synchronous — no cancel mechanism.
    // The client process can be stopped, but individual sessions can't be cancelled.
    log.warn({ handle }, 'Codex sessions are synchronous; cancel is a no-op');
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false,
      supportsMultiTurn: true,
      supportsIdeSkills: false,
      supportsSandbox: true,
      supportsCancel: false,
      supportsStepWatch: false,
    };
  }
}

export function getCodexConversation(handle: string): Array<{ role: 'user' | 'assistant'; content: string }> | null {
  return conversations.get(handle) || null;
}
