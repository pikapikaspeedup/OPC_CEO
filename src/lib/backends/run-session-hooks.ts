import { TERMINAL_STATUSES } from '../agents/group-types';
import type { SessionProvenance } from '../agents/group-types';
import { getRun, updateRun } from '../agents/run-registry';
import { appendRunHistoryEntry } from '../agents/run-history';
import type { AgentBackendId } from '../providers';
import { applyAfterRunMemoryHooks } from './memory-hooks';
import type { BackendSessionConsumerHooks } from './session-consumer';
import type {
  BackendRunConfig,
  CancelledAgentEvent,
  CompletedAgentEvent,
  FailedAgentEvent,
  LiveStateAgentEvent,
  StartedAgentEvent,
} from './types';

type Awaitable<T> = T | Promise<T>;

export interface CreateRunSessionHooksOptions {
  runId: string;
  activeRoleId?: string;
  backendConfig?: BackendRunConfig;
  bindConversationHandleForProviders?: AgentBackendId[];
  /** How this session was created (for provenance tracking) */
  createdVia?: SessionProvenance['createdVia'];
  /** Where the provider decision came from */
  resolutionSource?: SessionProvenance['resolutionSource'];
  onStarted?(event: StartedAgentEvent): Awaitable<void>;
  onLiveState?(event: LiveStateAgentEvent): Awaitable<void>;
  onCompleted?(event: CompletedAgentEvent): Awaitable<void>;
  onFailed?(event: FailedAgentEvent): Awaitable<void>;
  onCancelled?(event: CancelledAgentEvent): Awaitable<void>;
}

function shouldSkipRunUpdate(runId: string): boolean {
  const run = getRun(runId);
  return !run || TERMINAL_STATUSES.has(run.status);
}

async function runAfterHook(
  backendConfig: BackendRunConfig | undefined,
  event: CompletedAgentEvent | FailedAgentEvent | CancelledAgentEvent,
): Promise<void> {
  if (!backendConfig) {
    return;
  }
  await applyAfterRunMemoryHooks(event.providerId, backendConfig, event);
}

export function createRunSessionHooks(options: CreateRunSessionHooksOptions): BackendSessionConsumerHooks {
  const bindHandleProviders = new Set(options.bindConversationHandleForProviders || ['antigravity']);

  return {
    onStarted: async (event) => {
      const existingRun = getRun(options.runId);
      if (!shouldSkipRunUpdate(options.runId)) {
        const previousHandle = existingRun?.sessionProvenance?.handle;

        const provenance: SessionProvenance = {
          handle: event.handle,
          backendId: event.providerId,
          handleKind: previousHandle ? 'resumed' : 'started',
          workspacePath: options.backendConfig?.workspacePath || existingRun?.workspace || '',
          model: options.backendConfig?.model || existingRun?.model,
          resolutionSource: options.resolutionSource,
          createdVia: options.createdVia || 'dispatch',
          supersedesHandle: previousHandle !== event.handle ? previousHandle : undefined,
          recordedAt: new Date().toISOString(),
        };

        updateRun(options.runId, {
          status: 'running',
          startedAt: event.startedAt,
          sessionProvenance: provenance,
          ...(options.activeRoleId ? { activeRoleId: options.activeRoleId } : {}),
          ...(bindHandleProviders.has(event.providerId)
            ? {
                childConversationId: event.handle,
                activeConversationId: event.handle,
              }
            : {}),
        });
      }

      appendRunHistoryEntry({
        runId: options.runId,
        provider: event.providerId,
        sessionHandle: event.handle,
        eventType: 'session.started',
        details: {
          startedAt: event.startedAt,
          activeRoleId: options.activeRoleId,
          backendModel: options.backendConfig?.model,
          workspacePath: existingRun?.workspace || options.backendConfig?.workspacePath,
        },
      });

      await options.onStarted?.(event);
    },

    onLiveState: async (event) => {
      if (!shouldSkipRunUpdate(options.runId)) {
        updateRun(options.runId, { liveState: event.liveState });
      }

      appendRunHistoryEntry({
        runId: options.runId,
        provider: event.providerId,
        sessionHandle: event.handle,
        eventType: 'session.live_state',
        details: {
          cascadeStatus: event.liveState.cascadeStatus,
          stepCount: event.liveState.stepCount,
          lastStepAt: event.liveState.lastStepAt,
          lastStepType: event.liveState.lastStepType,
          staleSince: event.liveState.staleSince,
        },
      });

      await options.onLiveState?.(event);
    },

    onCompleted: async (event) => {
      if (options.onCompleted) {
        await options.onCompleted(event);
      } else if (!shouldSkipRunUpdate(options.runId)) {
        updateRun(options.runId, {
          status: event.result.status,
          result: event.result,
          lastError: event.result.status === 'completed'
            ? undefined
            : event.result.blockers[0] || event.result.summary,
        });
      }

      appendRunHistoryEntry({
        runId: options.runId,
        provider: event.providerId,
        sessionHandle: event.handle,
        eventType: 'session.completed',
        details: {
          finishedAt: event.finishedAt,
          finalText: event.finalText,
          resultStatus: event.result.status,
          summary: event.result.summary,
          changedFiles: event.result.changedFiles,
          blockers: event.result.blockers,
          needsReview: event.result.needsReview,
          rawStepCount: event.rawSteps?.length || 0,
          tokenUsage: event.tokenUsage,
        },
      });

      if (event.providerId === 'antigravity' && event.finalText?.trim()) {
        appendRunHistoryEntry({
          runId: options.runId,
          provider: event.providerId,
          sessionHandle: event.handle,
          eventType: 'conversation.message.assistant',
          details: {
            content: event.finalText,
            source: 'session.completed',
          },
        });
      }

      await runAfterHook(options.backendConfig, event);
    },

    onFailed: async (event) => {
      if (options.onFailed) {
        await options.onFailed(event);
      } else if (!shouldSkipRunUpdate(options.runId)) {
        updateRun(options.runId, {
          status: 'failed',
          lastError: event.error.message,
          ...(event.liveState ? { liveState: event.liveState } : {}),
        });
      }

      appendRunHistoryEntry({
        runId: options.runId,
        provider: event.providerId,
        sessionHandle: event.handle,
        eventType: 'session.failed',
        details: {
          finishedAt: event.finishedAt,
          error: event.error.message,
          code: event.error.code,
          source: event.error.source,
          retryable: event.error.retryable,
          rawStepCount: event.rawSteps?.length || 0,
          liveState: event.liveState,
        },
      });

      await runAfterHook(options.backendConfig, event);
    },

    onCancelled: async (event) => {
      if (options.onCancelled) {
        await options.onCancelled(event);
      } else if (!shouldSkipRunUpdate(options.runId)) {
        updateRun(options.runId, { status: 'cancelled' });
      }

      appendRunHistoryEntry({
        runId: options.runId,
        provider: event.providerId,
        sessionHandle: event.handle,
        eventType: 'session.cancelled',
        details: {
          finishedAt: event.finishedAt,
          reason: event.reason,
        },
      });

      await runAfterHook(options.backendConfig, event);
    },
  };
}
