import { TERMINAL_STATUSES } from '../agents/group-types';
import { getRun, updateRun } from '../agents/run-registry';
import type { ProviderId } from '../providers';
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
  bindConversationHandleForProviders?: ProviderId[];
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
      if (!shouldSkipRunUpdate(options.runId)) {
        updateRun(options.runId, {
          status: 'running',
          startedAt: event.startedAt,
          ...(options.activeRoleId ? { activeRoleId: options.activeRoleId } : {}),
          ...(bindHandleProviders.has(event.providerId)
            ? {
                childConversationId: event.handle,
                activeConversationId: event.handle,
              }
            : {}),
        });
      }

      await options.onStarted?.(event);
    },

    onLiveState: async (event) => {
      if (!shouldSkipRunUpdate(options.runId)) {
        updateRun(options.runId, { liveState: event.liveState });
      }

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

      await runAfterHook(options.backendConfig, event);
    },

    onCancelled: async (event) => {
      if (options.onCancelled) {
        await options.onCancelled(event);
      } else if (!shouldSkipRunUpdate(options.runId)) {
        updateRun(options.runId, { status: 'cancelled' });
      }

      await runAfterHook(options.backendConfig, event);
    },
  };
}