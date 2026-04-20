/**
 * AntigravityExecutor — TaskExecutor implementation for Antigravity IDE (gRPC).
 *
 * Phase 1: Dispatch-only — creates a child conversation, sends the prompt,
 * and returns the cascadeId as handle. Watch/completion logic stays in
 * group-runtime for now (it's tightly coupled with runtime state).
 *
 * Phase 2 (future): Will incorporate watchUntilComplete once runtime state
 * access is refactored into an injectable dependency.
 */

import { createLogger } from '../logger';
import { appendRunHistoryEntry } from '../agents/run-history';
import {
  discoverLanguageServers,
  getApiKey,
  grpc,
  preRegisterOwner,
} from '../bridge/gateway';
import type {
  TaskExecutor,
  TaskExecutionOptions,
  TaskExecutionResult,
  AppendMessageOptions,
  ProviderCapabilities,
} from './types';

const log = createLogger('AntigravityExecutor');

// ---------------------------------------------------------------------------
// AntigravityExecutor
// ---------------------------------------------------------------------------

export class AntigravityExecutor implements TaskExecutor {
  readonly providerId = 'antigravity';

  /**
   * Start a child conversation in Antigravity IDE and send the prompt.
   *
   * NOTE (Phase 1): This returns immediately after dispatch — the returned
   * result has status 'completed' but no content/steps. The caller
   * (group-runtime) is responsible for watching the conversation.
   */
  async executeTask(opts: TaskExecutionOptions): Promise<TaskExecutionResult> {
    const shortRunId = opts.runId?.slice(0, 8) || '???';
    const wsUri = opts.workspace.startsWith('file://') ? opts.workspace : `file://${opts.workspace}`;

    // 1. Find the language server
    const servers = await discoverLanguageServers();
    const server = servers.find(
      (s) => s.workspace && (
        s.workspace.includes(opts.workspace) || opts.workspace.includes(s.workspace)
      ),
    );
    if (!server) {
      throw new Error(`No language_server found for workspace: ${opts.workspace}`);
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('No API key available');
    }

    // 2. Track workspace
    log.info({ runId: shortRunId, roleId: opts.roleId, port: server.port }, 'Starting child conversation');
    try {
      await grpc.addTrackedWorkspace(server.port, server.csrf, opts.workspace);
    } catch (e: any) {
      log.warn({ runId: shortRunId, err: e.message }, 'AddTrackedWorkspace failed (may already be tracked)');
    }

    // 3. Start cascade
    const startResult = await grpc.startCascade(server.port, server.csrf, apiKey, wsUri);
    const cascadeId = startResult?.cascadeId;
    if (!cascadeId) {
      throw new Error('StartCascade returned no cascadeId');
    }

    // 4. Pre-register owner for future lookups
    preRegisterOwner(cascadeId, {
      port: server.port,
      csrf: server.csrf,
      apiKey,
      stepCount: 0,
    });

    // 5. Set annotations
    await grpc.updateConversationAnnotations(server.port, server.csrf, apiKey, cascadeId, {
      'antigravity.task.hidden': 'true',
      'antigravity.task.parentId': opts.parentConversationId || '',
      'antigravity.task.stageId': opts.stageId || '',
      'antigravity.task.runId': opts.runId || '',
      'antigravity.task.roleId': opts.roleId || '',
      lastUserViewTime: new Date().toISOString(),
    });

    // 6. Send prompt
    const model = opts.model || 'MODEL_PLACEHOLDER_M26';
    log.info({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8), roleId: opts.roleId, promptLength: opts.prompt.length }, 'Sending workflow prompt');
    await grpc.sendMessage(
      server.port, server.csrf, apiKey, cascadeId,
      opts.prompt, model, false, undefined, 'ARTIFACT_REVIEW_MODE_TURBO',
    );
    if (opts.runId) {
      appendRunHistoryEntry({
        runId: opts.runId,
        provider: this.providerId,
        sessionHandle: cascadeId,
        eventType: 'provider.dispatch',
        details: {
          cascadeId,
          workspace: opts.workspace,
          model,
          promptLength: opts.prompt.length,
        },
      });
      appendRunHistoryEntry({
        runId: opts.runId,
        provider: this.providerId,
        sessionHandle: cascadeId,
        eventType: 'conversation.message.user',
        details: { content: opts.prompt },
      });
    }

    // Phase 1: Return handle immediately — caller watches for completion
    return {
      handle: cascadeId,
      content: '',     // Not yet available
      steps: [],       // Will be populated by watch
      changedFiles: [], // Will be populated by watch
      status: 'completed', // Dispatch succeeded
    };
  }

  /**
   * Send a follow-up message to an existing conversation.
   * Used for nudge/revise operations.
   */
  async appendMessage(handle: string, opts: AppendMessageOptions): Promise<TaskExecutionResult> {
    const servers = await discoverLanguageServers();
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('No API key available');

    // Find the server that owns this cascade
    // For now, try the first server (single-server setup)
    const server = servers[0];
    if (!server) throw new Error('No language server available');

    await grpc.sendMessage(
      server.port, server.csrf, apiKey, handle,
      opts.prompt, opts.model || 'MODEL_PLACEHOLDER_M26',
    );
    if (opts.runId) {
      appendRunHistoryEntry({
        runId: opts.runId,
        provider: this.providerId,
        sessionHandle: handle,
        eventType: 'conversation.message.user',
        details: { content: opts.prompt },
      });
    }

    return {
      handle,
      content: '',
      steps: [],
      changedFiles: [],
      status: 'completed',
    };
  }

  /**
   * Cancel an in-progress conversation.
   */
  async cancel(handle: string): Promise<void> {
    const servers = await discoverLanguageServers();
    const apiKey = getApiKey();
    if (!apiKey) return;

    const server = servers[0];
    if (!server) return;

    try {
      await grpc.cancelCascade(server.port, server.csrf, apiKey, handle);
    } catch (err: any) {
      log.warn({ cascadeId: handle.slice(0, 8), err: err.message }, 'Cancel cascade failed');
    }
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsMultiTurn: true,
      supportsIdeSkills: true,
      supportsSandbox: false,
      supportsCancel: true,
      supportsStepWatch: true,
    };
  }
}
