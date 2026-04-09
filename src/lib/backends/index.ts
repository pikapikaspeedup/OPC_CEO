export type {
  AgentBackend,
  AgentBackendCapabilities,
  AgentEvent,
  AgentSession,
  AppendRunRequest,
  BackendRunConfig,
  BackendRunError,
  BackendRunErrorCode,
  BackendErrorSource,
  CancelledAgentEvent,
  CompletedAgentEvent,
  FailedAgentEvent,
  LiveStateAgentEvent,
  MemoryContext,
  MemoryEntry,
  MemoryEntryType,
  StartedAgentEvent,
} from './types';

export {
  clearAgentBackends,
  getAgentBackend,
  hasAgentBackend,
  listAgentBackends,
  registerAgentBackend,
} from './registry';

export type { ActiveAgentSessionRecord } from './session-registry';
export {
  clearAgentSessions,
  getAgentSession,
  listAgentSessions,
  markAgentSessionCancelRequested,
  markAgentSessionTerminalSeen,
  registerAgentSession,
  removeAgentSession,
} from './session-registry';

export type {
  BackendSessionConsumerHooks,
  ConsumeAgentSessionOptions,
  ConsumeAgentSessionResult,
} from './session-consumer';
export { consumeAgentSession } from './session-consumer';

export {
  AntigravityAgentBackend,
  CodexAgentBackend,
  ensureBuiltInAgentBackends,
} from './builtin-backends';

export type { BackendMemoryHook } from './memory-hooks';
export {
  applyAfterRunMemoryHooks,
  applyBeforeRunMemoryHooks,
  clearMemoryHooks,
  listMemoryHooks,
  registerMemoryHook,
} from './memory-hooks';

export type { CreateRunSessionHooksOptions } from './run-session-hooks';
export { createRunSessionHooks } from './run-session-hooks';