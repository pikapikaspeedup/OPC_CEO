/**
 * Provider Abstraction Layer — Type Definitions
 *
 * Defines the TaskExecutor interface that all providers implement.
 * group-runtime calls TaskExecutor without knowing the underlying provider.
 */

// ---------------------------------------------------------------------------
// Task Execution
// ---------------------------------------------------------------------------

/** Options for starting a new task. */
export interface TaskExecutionOptions {
  /** Absolute workspace path (without file:// prefix). */
  workspace: string
  /** The prompt/instruction for the agent. */
  prompt: string
  /** Model identifier. */
  model?: string
  /** Organization-level memory to inject (e.g. for Codex base-instructions). */
  baseInstructions?: string
  /** Artifact output directory (relative to workspace). */
  artifactDir?: string
  /** Timeout in milliseconds. 0 = no limit. */
  timeout?: number

  // ── Metadata (for annotations/logging) ──

  /** Run ID for tracking. */
  runId?: string
  /** Stage ID for tracking. */
  stageId?: string
  /** Role ID for tracking. */
  roleId?: string
  /** Parent conversation ID (for grouping in IDE). */
  parentConversationId?: string
}

/** Result of a completed task execution. */
export interface TaskExecutionResult {
  /** Provider-specific handle (cascadeId for Antigravity, threadId for Codex). */
  handle: string
  /** Final text content from the agent. */
  content: string
  /** Structured step data (Antigravity has rich steps, Codex has none). */
  steps: unknown[]
  /** Files changed during execution. */
  changedFiles: string[]
  /** Overall status. */
  status: 'completed' | 'failed' | 'blocked'
}

/** Options for appending a message to an existing task. */
export interface AppendMessageOptions {
  /** The prompt to send. */
  prompt: string
  /** Model override. */
  model?: string
  /** The workspace to execute within (optional, useful for stateless reconnections). */
  workspace?: string
  /** Run ID for history tracking. */
  runId?: string
}

// ---------------------------------------------------------------------------
// Provider Capabilities
// ---------------------------------------------------------------------------

/** Declares what a provider supports. */
export interface ProviderCapabilities {
  /** Supports streaming step-by-step data during execution. */
  supportsStreaming: boolean
  /** Supports multi-turn conversations (append/reply). */
  supportsMultiTurn: boolean
  /** Has IDE-level skills (refactoring, navigation, debugging). */
  supportsIdeSkills: boolean
  /** Runs in a sandboxed environment. */
  supportsSandbox: boolean
  /** Supports cancellation of in-progress tasks. */
  supportsCancel: boolean
  /** Supports real-time step watching. */
  supportsStepWatch: boolean
}

// ---------------------------------------------------------------------------
// TaskExecutor Interface
// ---------------------------------------------------------------------------

/**
 * Unified interface for direct local executors and compatibility runtimes.
 *
 * This interface is intentionally narrower than the full Claude Engine mainline:
 * - `antigravity` still uses it directly
 * - CLI coders such as `codex` / `claude-code` sit behind ExecutionTool or
 *   legacy/manual backends
 */
export interface TaskExecutor {
  /** Provider identifier. */
  readonly providerId: string

  /** Start a task and wait for completion. */
  executeTask(opts: TaskExecutionOptions): Promise<TaskExecutionResult>

  /** Append a message to an existing task (nudge, follow-up). */
  appendMessage(handle: string, opts: AppendMessageOptions): Promise<TaskExecutionResult>

  /** Cancel an in-progress task. */
  cancel(handle: string): Promise<void>

  /** Return capability matrix. */
  capabilities(): ProviderCapabilities
}

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

/** AI model providers routed through pi-ai / model transport. */
export type AIProviderId =
  | 'antigravity'
  | 'native-codex'
  | 'claude-api'
  | 'openai-api'
  | 'gemini-api'
  | 'grok-api'
  | 'custom';

/** External coding executors exposed through Claude Engine ExecutionTool. */
export type ExecutionToolId =
  | 'codex'
  | 'claude-code';

/**
 * Agent backend ids registered in the runtime.
 * Includes legacy/manual CLI backends for compatibility.
 */
export type AgentBackendId =
  | AIProviderId
  | ExecutionToolId;

/**
 * Direct TaskExecutor ids.
 * These are the executors reachable through `getExecutor()`, not model providers.
 */
export type TaskExecutorId =
  | 'antigravity'
  | ExecutionToolId;

/**
 * @deprecated Prefer `AgentBackendId` for backend/session routing and
 * `TaskExecutorId` for direct executor access.
 */
export type ProviderId = AgentBackendId;

export const AI_PROVIDER_IDS: AIProviderId[] = [
  'antigravity',
  'native-codex',
  'claude-api',
  'openai-api',
  'gemini-api',
  'grok-api',
  'custom',
];

export const EXECUTION_TOOL_IDS: ExecutionToolId[] = [
  'codex',
  'claude-code',
];

export const AGENT_BACKEND_IDS: AgentBackendId[] = [
  ...AI_PROVIDER_IDS,
  ...EXECUTION_TOOL_IDS,
];

export const TASK_EXECUTOR_IDS: TaskExecutorId[] = [
  'antigravity',
  ...EXECUTION_TOOL_IDS,
];

const LEGACY_CONFIG_PROVIDER_MIGRATIONS: Partial<Record<ProviderId, AIProviderId>> = {
  codex: 'native-codex',
  'claude-code': 'native-codex',
};

export function isAIProviderId(value: string | null | undefined): value is AIProviderId {
  return AI_PROVIDER_IDS.includes(value as AIProviderId);
}

export function isExecutionToolId(value: string | null | undefined): value is ExecutionToolId {
  return EXECUTION_TOOL_IDS.includes(value as ExecutionToolId);
}

export function isAgentBackendId(value: string | null | undefined): value is AgentBackendId {
  return AGENT_BACKEND_IDS.includes(value as AgentBackendId);
}

export function isTaskExecutorId(value: string | null | undefined): value is TaskExecutorId {
  return TASK_EXECUTOR_IDS.includes(value as TaskExecutorId);
}

export function coerceConfigProviderId(
  value: string | null | undefined,
  fallback: AIProviderId = 'antigravity',
): AIProviderId {
  if (isAIProviderId(value)) {
    return value;
  }
  const migrated = value ? LEGACY_CONFIG_PROVIDER_MIGRATIONS[value as ProviderId] : undefined;
  return migrated ?? fallback;
}

export type ProviderTransportId = 'native' | 'pi-ai';

export type ProviderAuthMode =
  | 'runtime'
  | 'codex-oauth'
  | 'api-key'
  | 'proxy';

export interface ProviderTransportProfile {
  transport?: ProviderTransportId;
  authMode?: ProviderAuthMode;
  /**
   * App-level connection visibility. Primarily used for native/local providers so
   * users can remove a detected provider from this system without mutating the
   * machine-wide login state.
   */
  enabled?: boolean;
  supportsImageGeneration?: boolean;
  enableImageGeneration?: boolean;
  imageGenerationModel?: string;
}

// ---------------------------------------------------------------------------
// AI Provider Configuration (organization-wide)
// ---------------------------------------------------------------------------

/** AI interaction layer. */
export type AILayer = 'executive' | 'management' | 'execution' | 'utility';

/** Built-in scene identifiers for precise overrides. */
export type AIScene =
  | 'supervisor'           // L2: Supervisor 巡检
  | 'evaluate'             // L2: Evaluate intervention
  | 'memory-extraction'    // L2: Run 完成后知识提取
  | 'nudge'                // L3: 向 agent 发送提示/建议
  | 'review-decision'      // L4: Review 决策解析
  | 'code-summary'         // L4: 代码摘要/分类
  | 'knowledge-summary'    // Knowledge 结构化摘要生成
  | 'knowledge-image'      // Knowledge 图像生成
  | (string & {});         // 允许自定义 scene

/** Per-layer provider + model configuration. */
export interface LayerProviderConfig {
  provider: AIProviderId
  model?: string
  /** Daily token budget for this layer. */
  dailyBudget?: number
}

/** Per-scene provider + model configuration (overrides layer). */
export interface SceneProviderConfig {
  provider: AIProviderId
  model?: string
  /** Scene-specific constraints. */
  constraints?: {
    maxTokensPerCall?: number
    timeout?: number
    sandbox?: boolean
  }
}

export interface CustomProviderConfig {
  /**
   * Stable identifier for this saved connection.
   */
  id: string
  /** Preset/vendor id for UI recovery (e.g. "deepseek", "groq", "ollama"). */
  vendor?: string
  /** Display name (e.g. "DeepSeek", "Groq"). */
  name?: string
  /** Base URL of the OpenAI-compatible API endpoint (e.g. "https://api.deepseek.com"). */
  baseUrl?: string
  /** API key for the custom provider. */
  apiKey?: string
  /** Default model identifier (e.g. "deepseek-chat"). */
  defaultModel?: string
}

/**
 * Organization-wide AI Provider configuration.
 *
 * Stored at `~/.gemini/antigravity/ai-config.json`.
 *
 * Resolution priority:
 * 1. scenes.{sceneId}      — most specific
 * 2. department.provider    — department-level override
 * 3. layers.{layer}         — layer default
 * 4. defaultProvider        — organization fallback
 */
export interface AIProviderConfig {
  /** Organization default provider (fallback). */
  defaultProvider: AIProviderId
  /** Organization default model (fallback). */
  defaultModel?: string

  /** Per-layer configuration. */
  layers?: Partial<Record<AILayer, LayerProviderConfig>>

  /** Per-scene overrides (highest priority). */
  scenes?: Record<string, SceneProviderConfig>

  /** Transport/auth profiles for specific providers. */
  providerProfiles?: Partial<Record<AIProviderId, ProviderTransportProfile>>

  /**
   * Saved custom / OpenAI-compatible connections.
   *
   * Multiple entries may exist, but runtime always materializes the active one
   * into `customProvider` for backwards compatibility.
   */
  customProviders?: CustomProviderConfig[]
  /** Currently selected custom connection id. */
  activeCustomProviderId?: string
  /**
   * Runtime materialization of the active custom connection.
   * This field is kept for compatibility with existing runtime modules.
   */
  customProvider?: CustomProviderConfig
}

/**
 * Resolved provider + model for a given context.
 * Returned by `resolveProvider()`.
 */
export interface ResolvedProvider {
  provider: AIProviderId
  model?: string
  source: 'scene' | 'department' | 'layer' | 'default'
}
