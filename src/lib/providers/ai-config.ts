/**
 * AI Provider Configuration — Resolution & Management
 *
 * Reads organization-wide AI config from `~/.gemini/antigravity/ai-config.json`
 * and resolves the correct provider + model for any given context.
 *
 * Resolution priority:
 * 1. scenes.{sceneId}        ← most specific
 * 2. department.provider      ← department-level override (.department/config.json)
 * 3. layers.{layer}           ← layer default
 * 4. defaultProvider          ← organization fallback
 *
 * Input:  scene or layer + optional workspace
 * Output: ResolvedProvider { provider, model, source }
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';
import type {
  AIProviderConfig,
  AILayer,
  AIScene,
  ProviderId,
  ResolvedProvider,
} from './types';

const log = createLogger('AIConfig');

// ---------------------------------------------------------------------------
// Default configuration (Antigravity-only, as current baseline)
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: AIProviderConfig = {
  defaultProvider: 'antigravity',
  defaultModel: undefined,
  layers: {
    executive: { provider: 'antigravity' },
    management: { provider: 'antigravity' },
    execution: { provider: 'antigravity' },
    utility: { provider: 'antigravity' },
  },
  scenes: {},
};

// ---------------------------------------------------------------------------
// Scene → Layer mapping
// ---------------------------------------------------------------------------

const SCENE_LAYER_MAP: Record<string, AILayer> = {
  supervisor: 'management',
  evaluate: 'management',
  'memory-extraction': 'management',
  nudge: 'execution',
  'review-decision': 'utility',
  'code-summary': 'utility',
};

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

let cachedConfig: AIProviderConfig | null = null;
let cachedConfigMtimeMs: number | null = null;
let cachedConfigSource: 'file' | 'override' | 'default' | null = null;

function getConfigPath(): string {
  return path.join(process.env.HOME || '~', '.gemini', 'antigravity', 'ai-config.json');
}

/**
 * Load AI config from disk.
 * Falls back to DEFAULT_CONFIG if file doesn't exist.
 */
export function loadAIConfig(): AIProviderConfig {
  if (cachedConfigSource === 'override' && cachedConfig) {
    return cachedConfig;
  }

  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const mtimeMs = fs.statSync(configPath).mtimeMs;
      if (cachedConfig && cachedConfigSource === 'file' && cachedConfigMtimeMs === mtimeMs) {
        return cachedConfig;
      }

      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      cachedConfig = { ...DEFAULT_CONFIG, ...raw } as AIProviderConfig;
      cachedConfigMtimeMs = mtimeMs;
      cachedConfigSource = 'file';
      log.info({ configPath }, 'AI config loaded');
      return cachedConfig!;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err: message, configPath }, 'Failed to load AI config, using defaults');
  }

  if (cachedConfig && cachedConfigSource === 'default') {
    return cachedConfig;
  }

  cachedConfig = { ...DEFAULT_CONFIG };
  cachedConfigMtimeMs = null;
  cachedConfigSource = 'default';
  return cachedConfig;
}

/**
 * Override AI config in memory (for testing or runtime updates).
 */
export function setAIConfig(config: Partial<AIProviderConfig>): void {
  cachedConfig = { ...DEFAULT_CONFIG, ...config };
  cachedConfigMtimeMs = null;
  cachedConfigSource = 'override';
}

/**
 * Reset config cache (forces reload from disk on next call).
 */
export function resetAIConfigCache(): void {
  cachedConfig = null;
  cachedConfigMtimeMs = null;
  cachedConfigSource = null;
}

/**
 * Save current config to disk.
 */
export function saveAIConfig(config: AIProviderConfig): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  cachedConfig = config;
  try {
    cachedConfigMtimeMs = fs.statSync(configPath).mtimeMs;
  } catch {
    cachedConfigMtimeMs = null;
  }
  cachedConfigSource = 'file';
  log.info({ configPath }, 'AI config saved');
}

// ---------------------------------------------------------------------------
// Department config integration
// ---------------------------------------------------------------------------

/**
 * Read department-level provider override from .department/config.json.
 *
 * @param workspacePath — Absolute workspace path.
 * @returns Provider ID if configured, undefined otherwise.
 */
function getDepartmentProvider(workspacePath: string): ProviderId | undefined {
  try {
    const configPath = path.join(workspacePath, '.department', 'config.json');
    if (!fs.existsSync(configPath)) return undefined;

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (config.provider && typeof config.provider === 'string') {
      return config.provider as ProviderId;
    }
  } catch {
    // Ignore parse errors
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the provider + model for a given scene/layer and optional workspace.
 *
 * This is the main entry point for all AI interaction points.
 *
 * @param sceneOrLayer — Scene ID (e.g. 'supervisor') or layer (e.g. 'execution').
 * @param workspacePath — Optional workspace path for department-level override.
 * @returns Resolved provider, model, and resolution source.
 *
 * @example
 * // L3: Pipeline task execution
 * const { provider, model } = resolveProvider('execution', '/path/to/workspace');
 *
 * // L2: Supervisor check
 * const { provider, model } = resolveProvider('supervisor');
 *
 * // L4: Code summary
 * const { provider, model } = resolveProvider('code-summary');
 */
export function resolveProvider(
  sceneOrLayer: AIScene | AILayer,
  workspacePath?: string,
): ResolvedProvider {
  const config = loadAIConfig();

  // 1. Check scene-level override (highest priority)
  if (config.scenes && config.scenes[sceneOrLayer]) {
    const scene = config.scenes[sceneOrLayer];
    return {
      provider: scene.provider,
      model: scene.model,
      source: 'scene',
    };
  }

  // 2. Check department-level override
  if (workspacePath) {
    const deptProvider = getDepartmentProvider(workspacePath);
    if (deptProvider) {
      return {
        provider: deptProvider,
        model: config.defaultModel,
        source: 'department',
      };
    }
  }

  // 3. Check layer-level default
  const layer: AILayer | undefined =
    SCENE_LAYER_MAP[sceneOrLayer] ??
    (['executive', 'management', 'execution', 'utility'].includes(sceneOrLayer) ? sceneOrLayer as AILayer : undefined);

  if (layer && config.layers?.[layer]) {
    const layerConfig = config.layers[layer]!;
    return {
      provider: layerConfig.provider,
      model: layerConfig.model ?? config.defaultModel,
      source: 'layer',
    };
  }

  // 4. Organization default (fallback)
  return {
    provider: config.defaultProvider,
    model: config.defaultModel,
    source: 'default',
  };
}

/**
 * Get scene-specific constraints (timeout, max tokens, etc.).
 *
 * @param scene — Scene ID.
 * @returns Constraints if configured, undefined otherwise.
 */
export function getSceneConstraints(scene: string): { maxTokensPerCall?: number; timeout?: number; sandbox?: boolean } | undefined {
  const config = loadAIConfig();
  return config.scenes?.[scene]?.constraints;
}
