import type { AgentBackendId } from '../providers';
import type {
  BackendRunConfig,
  CancelledAgentEvent,
  CompletedAgentEvent,
  FailedAgentEvent,
} from './types';

type TerminalAgentEvent = CompletedAgentEvent | FailedAgentEvent | CancelledAgentEvent;

export interface BackendMemoryHook {
  id: string;
  providers?: AgentBackendId[];
  afterRun?(context: {
    providerId: AgentBackendId;
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

function matchesProvider(hook: BackendMemoryHook, providerId: AgentBackendId): boolean {
  return !hook.providers || hook.providers.includes(providerId);
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
  providerId: AgentBackendId,
  config: BackendRunConfig,
): Promise<BackendRunConfig> {
  void providerId;
  return { ...config };
}

export async function applyAfterRunMemoryHooks(
  providerId: AgentBackendId,
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
