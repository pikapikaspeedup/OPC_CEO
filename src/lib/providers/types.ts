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
  steps: any[]
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
 * Unified interface for executing agent tasks across different providers.
 *
 * Each provider (Antigravity, Codex, future LLM APIs) implements this interface.
 * The orchestrator (group-runtime) only interacts with TaskExecutor, never with
 * provider-specific APIs directly.
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

/** Provider type string literal. */
export type ProviderId =
  | 'antigravity'
  | 'codex'
  | 'native-codex'
  | 'claude-code'
  | 'claude-api'
  | 'openai-api'
  | 'gemini-api'
  | 'grok-api'
  | 'custom';

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
  | (string & {});         // 允许自定义 scene

/** Per-layer provider + model configuration. */
export interface LayerProviderConfig {
  provider: ProviderId
  model?: string
  /** Daily token budget for this layer. */
  dailyBudget?: number
}

/** Per-scene provider + model configuration (overrides layer). */
export interface SceneProviderConfig {
  provider: ProviderId
  model?: string
  /** Scene-specific constraints. */
  constraints?: {
    maxTokensPerCall?: number
    timeout?: number
    sandbox?: boolean
  }
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
  defaultProvider: ProviderId
  /** Organization default model (fallback). */
  defaultModel?: string

  /** Per-layer configuration. */
  layers?: Partial<Record<AILayer, LayerProviderConfig>>

  /** Per-scene overrides (highest priority). */
  scenes?: Record<string, SceneProviderConfig>

  /** Custom provider settings (when defaultProvider='custom'). */
  customProvider?: {
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
}

/**
 * Resolved provider + model for a given context.
 * Returned by `resolveProvider()`.
 */
export interface ResolvedProvider {
  provider: ProviderId
  model?: string
  source: 'scene' | 'department' | 'layer' | 'default'
}
