import type { ProviderId } from '../providers';
import type {
  BackendRunConfig,
  CancelledAgentEvent,
  CompletedAgentEvent,
  FailedAgentEvent,
  MemoryContext,
} from './types';

type TerminalAgentEvent = CompletedAgentEvent | FailedAgentEvent | CancelledAgentEvent;

export interface BackendMemoryHook {
  id: string;
  providers?: ProviderId[];
  beforeRun?(context: { providerId: ProviderId; config: BackendRunConfig }):
    | Partial<MemoryContext>
    | void
    | Promise<Partial<MemoryContext> | void>;
  afterRun?(context: {
    providerId: ProviderId;
    config: BackendRunConfig;
    event: TerminalAgentEvent;
  }): void | Promise<void>;
}

const globalForMemoryHooks = globalThis as unknown as {
  __AGENT_MEMORY_HOOKS__?: Map<string, BackendMemoryHook>;
};

const memoryHooks = globalForMemoryHooks.__AGENT_MEMORY_HOOKS__ || new Map<string, BackendMemoryHook>();

if (process.env.NODE_ENV !== 'production') {
  globalForMemoryHooks.__AGENT_MEMORY_HOOKS__ = memoryHooks;
}

function matchesProvider(hook: BackendMemoryHook, providerId: ProviderId): boolean {
  return !hook.providers || hook.providers.includes(providerId);
}

function mergeMemoryContext(
  current: BackendRunConfig['memoryContext'],
  patch?: Partial<MemoryContext> | void,
): BackendRunConfig['memoryContext'] {
  if (!patch) {
    return current;
  }

  return {
    projectMemories: [
      ...(current?.projectMemories || []),
      ...(patch.projectMemories || []),
    ],
    departmentMemories: [
      ...(current?.departmentMemories || []),
      ...(patch.departmentMemories || []),
    ],
    userPreferences: [
      ...(current?.userPreferences || []),
      ...(patch.userPreferences || []),
    ],
  };
}

export function registerMemoryHook(hook: BackendMemoryHook): BackendMemoryHook {
  memoryHooks.set(hook.id, hook);
  return hook;
}

export function listMemoryHooks(): BackendMemoryHook[] {
  return Array.from(memoryHooks.values());
}

export function clearMemoryHooks(): void {
  memoryHooks.clear();
}

export async function applyBeforeRunMemoryHooks(
  providerId: ProviderId,
  config: BackendRunConfig,
): Promise<BackendRunConfig> {
  let nextConfig = { ...config };

  for (const hook of memoryHooks.values()) {
    if (!matchesProvider(hook, providerId) || !hook.beforeRun) {
      continue;
    }

    const patch = await hook.beforeRun({ providerId, config: nextConfig });
    nextConfig = {
      ...nextConfig,
      memoryContext: mergeMemoryContext(nextConfig.memoryContext, patch),
    };
  }

  return nextConfig;
}

export async function applyAfterRunMemoryHooks(
  providerId: ProviderId,
  config: BackendRunConfig,
  event: TerminalAgentEvent,
): Promise<void> {
  for (const hook of memoryHooks.values()) {
    if (!matchesProvider(hook, providerId) || !hook.afterRun) {
      continue;
    }

    await hook.afterRun({ providerId, config, event });
  }
}