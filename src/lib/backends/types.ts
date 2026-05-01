import type { AgentBackendId } from '../providers';
import type {
  ExecutionTarget,
  ExecutorKind,
  PromptModeResolution,
  RunLiveState,
  TaskResult,
  TriggerContext,
} from '../agents/group-types';
import type { ExecutionProfile } from '../execution/contracts';
import type {
  DepartmentExecutionClass,
  DepartmentPermissionMode,
  DepartmentRequiredArtifact,
  DepartmentRuntimeCapabilities,
  DepartmentRuntimeContract,
  DepartmentToolset,
} from '../organization/contracts';

export type MemoryEntryType = 'user' | 'feedback' | 'project' | 'reference';

export interface MemoryEntry {
  type: MemoryEntryType;
  name: string;
  content: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryContext {
  projectMemories: MemoryEntry[];
  departmentMemories: MemoryEntry[];
  userPreferences: MemoryEntry[];
}

export interface BackendRunMetadata {
  projectId?: string;
  stageId?: string;
  roleId?: string;
  executorKind?: ExecutorKind;
  autoApprove?: boolean;
}

export interface BackendRunResolution {
  resolvedWorkflowRef?: string;
  resolvedSkillRefs?: string[];
  resolutionReason?: string;
  promptResolution?: PromptModeResolution;
  requestedProvider?: AgentBackendId;
  routedProvider?: AgentBackendId;
  providerRoutingReason?: string;
  requiredExecutionClass?: DepartmentExecutionClass;
}

export interface BackendRunConfig {
  runId: string;
  workspacePath: string;
  prompt: string;
  model?: string;
  artifactDir?: string;
  runtimeContract?: DepartmentRuntimeContract;
  executionProfile?: ExecutionProfile;
  resolution?: BackendRunResolution;
  toolset?: DepartmentToolset;
  permissionMode?: DepartmentPermissionMode;
  additionalWorkingDirectories?: string[];
  readRoots?: string[];
  allowedWriteRoots?: string[];
  requiredArtifacts?: DepartmentRequiredArtifact[];
  parentConversationId?: string;
  executionTarget?: ExecutionTarget;
  triggerContext?: TriggerContext;
  metadata?: BackendRunMetadata;
  memoryContext?: MemoryContext;
  timeoutMs?: number;
}

export interface AgentBackendCapabilities {
  supportsAppend: boolean;
  supportsCancel: boolean;
  emitsLiveState: boolean;
  emitsRawSteps: boolean;
  emitsStreamingText: boolean;
  departmentRuntime?: DepartmentRuntimeCapabilities;
}

export interface AppendRunRequest {
  prompt: string;
  model?: string;
  workspacePath?: string;
}

export type BackendErrorSource = 'backend' | 'provider' | 'watcher' | 'orchestrator';

export type BackendRunErrorCode =
  | 'invalid_input'
  | 'no_language_server'
  | 'api_key_missing'
  | 'dispatch_failed'
  | 'watch_failed'
  | 'provider_failed'
  | 'cancel_not_supported'
  | 'append_not_supported'
  | 'invalid_response'
  | 'stale_timeout';

export interface BackendRunError {
  code: BackendRunErrorCode;
  message: string;
  retryable: boolean;
  source: BackendErrorSource;
}

export interface StartedAgentEvent {
  kind: 'started';
  runId: string;
  providerId: AgentBackendId;
  handle: string;
  startedAt: string;
}

export interface LiveStateAgentEvent {
  kind: 'live_state';
  runId: string;
  providerId: AgentBackendId;
  handle: string;
  liveState: RunLiveState;
}

export interface CompletedAgentEvent {
  kind: 'completed';
  runId: string;
  providerId: AgentBackendId;
  handle: string;
  finishedAt: string;
  result: TaskResult;
  rawSteps?: unknown[];
  finalText?: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface FailedAgentEvent {
  kind: 'failed';
  runId: string;
  providerId: AgentBackendId;
  handle?: string;
  finishedAt: string;
  error: BackendRunError;
  rawSteps?: unknown[];
  liveState?: RunLiveState;
}

export interface CancelledAgentEvent {
  kind: 'cancelled';
  runId: string;
  providerId: AgentBackendId;
  handle?: string;
  finishedAt: string;
  reason?: string;
}

export type AgentEvent =
  | StartedAgentEvent
  | LiveStateAgentEvent
  | CompletedAgentEvent
  | FailedAgentEvent
  | CancelledAgentEvent;

export interface AgentSession {
  readonly runId: string;
  readonly providerId: AgentBackendId;
  readonly handle: string;
  readonly capabilities: AgentBackendCapabilities;
  events(): AsyncIterable<AgentEvent>;
  append(request: AppendRunRequest): Promise<void>;
  cancel(reason?: string): Promise<void>;
}

export interface AgentBackend {
  readonly providerId: AgentBackendId;
  capabilities(): AgentBackendCapabilities;
  start(config: BackendRunConfig): Promise<AgentSession>;
  attach?(config: BackendRunConfig, handle: string): Promise<AgentSession>;
}
