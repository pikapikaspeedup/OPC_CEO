/**
 * Provider Abstraction Layer — Entry Point
 *
 * Re-exports types and executor implementations.
 * Provides a factory function to get the right executor for a provider.
 */

export type {
  TaskExecutor,
  TaskExecutionOptions,
  TaskExecutionResult,
  AppendMessageOptions,
  ProviderCapabilities,
  AIProviderId,
  AgentBackendId,
  ProviderId,
  TaskExecutorId,
  AIProviderConfig,
  AILayer,
  AIScene,
  LayerProviderConfig,
  SceneProviderConfig,
  ResolvedProvider,
} from './types';

export { CodexExecutor } from './codex-executor';
export { AntigravityExecutor } from './antigravity-executor';
export { ClaudeCodeExecutor } from './claude-code-executor';
export {
  resolveProvider,
  loadAIConfig,
  setAIConfig,
  resetAIConfigCache,
  saveAIConfig,
  getSceneConstraints,
} from './ai-config';

import type { TaskExecutor, TaskExecutorId } from './types';
import { AntigravityExecutor } from './antigravity-executor';
import { CodexExecutor } from './codex-executor';
import { ClaudeCodeExecutor } from './claude-code-executor';

// ---------------------------------------------------------------------------
// Singleton instances (one per provider type)
// ---------------------------------------------------------------------------

let antigravityInstance: AntigravityExecutor | null = null;
let codexInstance: CodexExecutor | null = null;
let claudeCodeInstance: ClaudeCodeExecutor | null = null;

/**
 * Get (or create) a TaskExecutor for the given provider.
 *
 * Usage:
 * ```ts
 * const executor = getExecutor('codex');
 * const result = await executor.executeTask({ workspace, prompt });
 * ```
 */
export function getExecutor(provider: TaskExecutorId): TaskExecutor {
  switch (provider) {
    case 'antigravity':
      if (!antigravityInstance) antigravityInstance = new AntigravityExecutor();
      return antigravityInstance;
    case 'codex':
      if (!codexInstance) codexInstance = new CodexExecutor();
      return codexInstance;
    case 'claude-code':
      if (!claudeCodeInstance) claudeCodeInstance = new ClaudeCodeExecutor();
      return claudeCodeInstance;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
