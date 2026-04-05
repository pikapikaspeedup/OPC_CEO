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
  ProviderId,
  AIProviderConfig,
  AILayer,
  AIScene,
  LayerProviderConfig,
  SceneProviderConfig,
  ResolvedProvider,
} from './types';

export { CodexExecutor } from './codex-executor';
export { AntigravityExecutor } from './antigravity-executor';
export {
  resolveProvider,
  loadAIConfig,
  setAIConfig,
  resetAIConfigCache,
  saveAIConfig,
  getSceneConstraints,
} from './ai-config';

import type { TaskExecutor, ProviderId } from './types';
import { AntigravityExecutor } from './antigravity-executor';
import { CodexExecutor } from './codex-executor';

// ---------------------------------------------------------------------------
// Singleton instances (one per provider type)
// ---------------------------------------------------------------------------

let antigravityInstance: AntigravityExecutor | null = null;
let codexInstance: CodexExecutor | null = null;

/**
 * Get (or create) a TaskExecutor for the given provider.
 *
 * Usage:
 * ```ts
 * const executor = getExecutor('codex');
 * const result = await executor.executeTask({ workspace, prompt });
 * ```
 */
export function getExecutor(provider: ProviderId): TaskExecutor {
  switch (provider) {
    case 'antigravity':
      if (!antigravityInstance) antigravityInstance = new AntigravityExecutor();
      return antigravityInstance;
    case 'codex':
      if (!codexInstance) codexInstance = new CodexExecutor();
      return codexInstance;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
