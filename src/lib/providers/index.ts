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
export { NativeCodexExecutor } from './native-codex-executor';
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

import type { TaskExecutor, ProviderId } from './types';
import { AntigravityExecutor } from './antigravity-executor';
import { CodexExecutor } from './codex-executor';
import { NativeCodexExecutor } from './native-codex-executor';
import { ClaudeCodeExecutor } from './claude-code-executor';

// ---------------------------------------------------------------------------
// Singleton instances (one per provider type)
// ---------------------------------------------------------------------------

let antigravityInstance: AntigravityExecutor | null = null;
let codexInstance: CodexExecutor | null = null;
let nativeCodexInstance: NativeCodexExecutor | null = null;
let claudeCodeInstance: ClaudeCodeExecutor | null = null;

/**
 * Get (or create) a TaskExecutor for the given provider.
 *
 * Usage:
 * ```ts
 * const executor = getExecutor('native-codex');
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
    case 'native-codex':
      if (!nativeCodexInstance) nativeCodexInstance = new NativeCodexExecutor();
      return nativeCodexInstance;
    case 'claude-code':
      if (!claudeCodeInstance) claudeCodeInstance = new ClaudeCodeExecutor();
      return claudeCodeInstance;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
