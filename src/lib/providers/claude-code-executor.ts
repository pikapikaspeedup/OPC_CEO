/**
 * ClaudeCodeExecutor — TaskExecutor implementation for Claude Code CLI.
 *
 * Spawns Claude Code in headless pipe mode (`-p --output-format=stream-json`)
 * and consumes the streaming JSON output. This is the Phase 1 minimal adapter:
 * one-shot execution only, no real-time streaming to the caller.
 *
 * Claude Code CLI flags used:
 *   -p                         — headless (non-interactive) mode
 *   --output-format stream-json — emit JSON events line by line
 *   --dangerously-skip-permissions — auto-approve all tool calls
 *   --model <model>            — override model
 *   --max-turns 50             — cap agent turns
 */

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { appendRunHistoryEntry } from '../agents/run-history';
import { createLogger } from '../logger';
import type {
  TaskExecutor,
  TaskExecutionOptions,
  TaskExecutionResult,
  AppendMessageOptions,
  ProviderCapabilities,
} from './types';
import {
  normalizeClaudeCodeEvents,
  type ClaudeStreamEvent,
  type NormalizationResult,
} from './claude-code-normalizer';

const log = createLogger('ClaudeCodeExecutor');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Path to the Claude Code CLI entry point. */
function getClaudeCodeBin(): string {
  // Priority: env override → sibling workspace → global
  if (process.env.CLAUDE_CODE_BIN) return process.env.CLAUDE_CODE_BIN;

  // Check sibling workspace (common in dev)
  const siblingDev = path.resolve(__dirname, '../../../../claude-code/src/entrypoints/cli.tsx');
  const siblingDist = path.resolve(__dirname, '../../../../claude-code/dist/cli.js');
  if (fs.existsSync(siblingDist)) return siblingDist;
  if (fs.existsSync(siblingDev)) return siblingDev;

  // Fallback to global `claude` command
  return 'claude';
}

/** Runtime for executing the CLI. */
function getRuntime(): string {
  return process.env.CLAUDE_CODE_RUNTIME || 'bun';
}

const DEFAULT_MAX_TURNS = 50;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

// ---------------------------------------------------------------------------
// Session ID extraction (kept here since it's spawn-specific)
// ---------------------------------------------------------------------------

function extractSessionId(events: ClaudeStreamEvent[]): string | undefined {
  for (const evt of events) {
    if (evt.session_id) return evt.session_id;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Process management
// ---------------------------------------------------------------------------

const activeProcesses = new Map<string, ChildProcess>();

// ---------------------------------------------------------------------------
// ClaudeCodeExecutor
// ---------------------------------------------------------------------------

export class ClaudeCodeExecutor implements TaskExecutor {
  readonly providerId = 'claude-code';

  async executeTask(opts: TaskExecutionOptions): Promise<TaskExecutionResult> {
    const shortRunId = opts.runId?.slice(0, 8) || '???';
    const bin = getClaudeCodeBin();
    const runtime = getRuntime();

    log.info({
      runId: shortRunId,
      roleId: opts.roleId,
      workspace: opts.workspace,
      model: opts.model,
      bin,
    }, 'Starting Claude Code execution');

    // Build CLI arguments
    const args: string[] = [];

    // If bin is a .ts or .tsx file, we need bun to run it; otherwise run directly
    const isTsFile = bin.endsWith('.ts') || bin.endsWith('.tsx');
    const command = isTsFile ? runtime : bin;
    if (isTsFile) args.push('run', bin);

    // Core flags
    args.push('-p'); // headless / pipe mode
    args.push('--output-format', 'stream-json');
    args.push('--dangerously-skip-permissions'); // Phase 1: auto-approve everything

    // Model
    if (opts.model) {
      args.push('--model', opts.model);
    }

    // Max turns
    args.push('--max-turns', String(DEFAULT_MAX_TURNS));

    // System prompt additions
    if (opts.artifactDir) {
      args.push('--append-system-prompt',
        `IMPORTANT: Write all output files to the directory: ${opts.artifactDir}/`);
    }

    log.debug({ command, args: args.join(' ') }, 'Claude Code spawn args');

    // Spawn the process
    const child = spawn(command, args, {
      cwd: opts.workspace,
      env: {
        ...process.env,
        // Ensure Claude Code uses its own config, not ours
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const handleId = `claude-code-${opts.runId || Date.now()}`;
    activeProcesses.set(handleId, child);

    // Write prompt to stdin
    child.stdin!.write(opts.prompt);
    child.stdin!.end();

    // Consume stdout as streaming JSON events
    const events: ClaudeStreamEvent[] = [];
    let stderrBuffer = '';
    const timeoutMs = opts.timeout || DEFAULT_TIMEOUT_MS;

    const result = await new Promise<TaskExecutionResult>((resolve, reject) => {
      let lineBuffer = '';
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGTERM');
          activeProcesses.delete(handleId);
          const partial = normalizeClaudeCodeEvents(events);
          resolve({
            handle: handleId,
            content: partial.summary || `Execution timed out after ${timeoutMs}ms`,
            steps: events,
            changedFiles: partial.changedFiles,
            status: 'failed',
          });
        }
      }, timeoutMs);

      child.stdout!.on('data', (chunk: Buffer) => {
        lineBuffer += chunk.toString('utf-8');
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const evt = JSON.parse(trimmed) as ClaudeStreamEvent;
            events.push(evt);
          } catch {
            // Non-JSON output (e.g. progress text), skip
          }
        }
      });

      child.stderr!.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString('utf-8');
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        activeProcesses.delete(handleId);

        // Process remaining buffer
        if (lineBuffer.trim()) {
          try {
            events.push(JSON.parse(lineBuffer.trim()));
          } catch { /* ignore */ }
        }

        // Normalize all events through Phase 3 normalizer
        const normalized = normalizeClaudeCodeEvents(events);
        const sessionId = extractSessionId(events);
        if (opts.runId) {
          appendRunHistoryEntry({
            runId: opts.runId,
            provider: this.providerId,
            sessionHandle: sessionId || handleId,
            eventType: 'conversation.message.user',
            details: { content: opts.prompt },
          });
          appendRunHistoryEntry({
            runId: opts.runId,
            provider: this.providerId,
            sessionHandle: sessionId || handleId,
            eventType: 'conversation.message.assistant',
            details: { content: normalized.summary || '' },
          });
          appendRunHistoryEntry({
            runId: opts.runId,
            provider: this.providerId,
            sessionHandle: sessionId || handleId,
            eventType: 'provider.raw_events',
            details: { eventCount: events.length },
          });
        }

        log.info({
          runId: shortRunId,
          exitCode: code,
          eventCount: events.length,
          stepCount: normalized.steps.length,
          changedFileCount: normalized.changedFiles.length,
          tokenUsage: normalized.tokenUsage,
          sessionId: sessionId?.slice(0, 8),
        }, 'Claude Code execution completed');

        if (stderrBuffer.trim()) {
          log.debug({ runId: shortRunId, stderr: stderrBuffer.slice(0, 500) }, 'Claude Code stderr');
        }

        const isSuccess = code === 0;
        resolve({
          handle: sessionId || handleId,
          content: normalized.summary || (isSuccess ? 'Task completed' : stderrBuffer.slice(0, 500) || 'Execution failed'),
          steps: events, // raw events preserved for trace
          changedFiles: normalized.changedFiles,
          status: isSuccess && normalized.status !== 'failed' ? 'completed' : 'failed',
        });
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        activeProcesses.delete(handleId);
        reject(err);
      });
    });

    return result;
  }

  async appendMessage(handle: string, opts: AppendMessageOptions): Promise<TaskExecutionResult> {
    // Phase 1: append is done by starting a new session with --resume
    const bin = getClaudeCodeBin();
    const runtime = getRuntime();

    const args: string[] = [];
    const isTsFile = bin.endsWith('.ts') || bin.endsWith('.tsx');
    const command = isTsFile ? runtime : bin;
    if (isTsFile) args.push('run', bin);

    args.push('-p');
    args.push('--output-format', 'stream-json');
    args.push('--dangerously-skip-permissions');
    args.push('--resume', handle);

    if (opts.model) {
      args.push('--model', opts.model);
    }

    const child = spawn(command, args, {
      cwd: opts.workspace || process.cwd(),
      env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin!.write(opts.prompt);
    child.stdin!.end();

    const events: ClaudeStreamEvent[] = [];

    return new Promise<TaskExecutionResult>((resolve, reject) => {
      let lineBuffer = '';

      child.stdout!.on('data', (chunk: Buffer) => {
        lineBuffer += chunk.toString('utf-8');
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try { events.push(JSON.parse(line.trim())); } catch { /* skip */ }
        }
      });

      child.on('close', (code) => {
        if (lineBuffer.trim()) {
          try { events.push(JSON.parse(lineBuffer.trim())); } catch { /* skip */ }
        }
        const normalized = normalizeClaudeCodeEvents(events);
        if (opts.runId) {
          appendRunHistoryEntry({
            runId: opts.runId,
            provider: this.providerId,
            sessionHandle: extractSessionId(events) || handle,
            eventType: 'conversation.message.user',
            details: { content: opts.prompt },
          });
          appendRunHistoryEntry({
            runId: opts.runId,
            provider: this.providerId,
            sessionHandle: extractSessionId(events) || handle,
            eventType: 'conversation.message.assistant',
            details: { content: normalized.summary || '' },
          });
          appendRunHistoryEntry({
            runId: opts.runId,
            provider: this.providerId,
            sessionHandle: extractSessionId(events) || handle,
            eventType: 'provider.raw_events',
            details: { eventCount: events.length, append: true },
          });
        }
        resolve({
          handle: extractSessionId(events) || handle,
          content: normalized.summary || '',
          steps: events,
          changedFiles: normalized.changedFiles,
          status: code === 0 ? 'completed' : 'failed',
        });
      });

      child.on('error', reject);
    });
  }

  async cancel(handle: string): Promise<void> {
    const proc = activeProcesses.get(handle);
    if (proc) {
      proc.kill('SIGTERM');
      activeProcesses.delete(handle);
      log.info({ handle: handle.slice(0, 16) }, 'Claude Code process killed');
    }
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false, // Phase 1: no real-time streaming to caller
      supportsMultiTurn: true,  // via --resume
      supportsIdeSkills: false,
      supportsSandbox: false,
      supportsCancel: true,
      supportsStepWatch: false,
    };
  }
}
