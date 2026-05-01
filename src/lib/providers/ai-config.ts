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
import { coerceConfigProviderId, isAIProviderId } from './types';
import type {
  AIProviderId,
  AIProviderConfig,
  AILayer,
  AIScene,
  CustomProviderConfig,
  ProviderTransportProfile,
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
  providerProfiles: {
    antigravity: { transport: 'native', authMode: 'runtime' },
    'native-codex': {
      transport: 'pi-ai',
      authMode: 'codex-oauth',
      supportsImageGeneration: true,
      enableImageGeneration: true,
      imageGenerationModel: 'gpt-5.5',
    },
    'claude-api': { transport: 'pi-ai', authMode: 'api-key' },
    'openai-api': {
      transport: 'pi-ai',
      authMode: 'api-key',
      supportsImageGeneration: true,
      enableImageGeneration: true,
      imageGenerationModel: 'gpt-image-1',
    },
    'gemini-api': { transport: 'pi-ai', authMode: 'api-key' },
    'grok-api': { transport: 'pi-ai', authMode: 'api-key' },
    custom: {
      transport: 'pi-ai',
      authMode: 'proxy',
      supportsImageGeneration: true,
      enableImageGeneration: false,
    },
  },
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
  'knowledge-summary': 'utility',
  'knowledge-image': 'utility',
};

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

let cachedConfig: AIProviderConfig | null = null;
let cachedConfigMtimeMs: number | null = null;
let cachedConfigSource: 'file' | 'override' | 'default' | null = null;

function hasText(value?: string): boolean {
  return Boolean(value?.trim());
}

function trimToUndefined(value?: string): string | undefined {
  return hasText(value) ? value!.trim() : undefined;
}

function sanitizeCustomProvider(
  raw?: Partial<CustomProviderConfig> | null,
  fallbackId?: string,
): CustomProviderConfig | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const id = trimToUndefined(raw.id) ?? fallbackId;
  if (!id) {
    return undefined;
  }

  return {
    id,
    vendor: trimToUndefined(raw.vendor),
    name: trimToUndefined(raw.name),
    baseUrl: trimToUndefined(raw.baseUrl),
    apiKey: trimToUndefined(raw.apiKey),
    defaultModel: trimToUndefined(raw.defaultModel),
  };
}

function dedupeCustomProviders(
  providers: Array<CustomProviderConfig | undefined>,
): CustomProviderConfig[] {
  const seen = new Set<string>();
  const result: CustomProviderConfig[] = [];
  for (const provider of providers) {
    if (!provider || seen.has(provider.id)) {
      continue;
    }
    seen.add(provider.id);
    result.push(provider);
  }
  return result;
}

function materializeCustomProviderState(raw?: Partial<AIProviderConfig>): Pick<
  AIProviderConfig,
  'customProviders' | 'activeCustomProviderId' | 'customProvider'
> {
  const shouldAppendLegacyCustomProvider = (raw?.customProviders?.length ?? 0) === 0
    || hasText(raw?.customProvider?.id);
  const customProviders = dedupeCustomProviders([
    ...((raw?.customProviders ?? []).map((provider, index) => sanitizeCustomProvider(provider, `custom-${index + 1}`))),
    shouldAppendLegacyCustomProvider
      ? sanitizeCustomProvider(raw?.customProvider, raw?.customProvider?.id ?? 'custom-default')
      : undefined,
  ]);

  const requestedActiveId = trimToUndefined(raw?.activeCustomProviderId)
    ?? trimToUndefined(raw?.customProvider?.id)
    ?? customProviders[0]?.id;

  const activeCustomProvider = customProviders.find((provider) => provider.id === requestedActiveId)
    ?? customProviders[0];

  return {
    customProviders: customProviders.length > 0 ? customProviders : undefined,
    activeCustomProviderId: activeCustomProvider?.id,
    customProvider: activeCustomProvider,
  };
}

function getConfigPath(): string {
  return path.join(process.env.HOME || '~', '.gemini', 'antigravity', 'ai-config.json');
}

function shouldUseBuildDefaultConfig(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build'
    && process.env.AG_ALLOW_BUILD_HOME_CONFIG !== '1';
}

function sanitizeLayerConfigs(
  raw?: Partial<AIProviderConfig>['layers'],
): AIProviderConfig['layers'] {
  if (!raw) {
    return undefined;
  }

  const next: Partial<Record<AILayer, { provider: AIProviderId; model?: string; dailyBudget?: number }>> = {};
  for (const [layer, config] of Object.entries(raw) as Array<[AILayer, (typeof raw)[AILayer]]>) {
    if (!config) continue;
    next[layer] = {
      ...config,
      provider: coerceConfigProviderId(config.provider, DEFAULT_CONFIG.layers?.[layer]?.provider ?? DEFAULT_CONFIG.defaultProvider),
    };
  }
  return next;
}

function sanitizeSceneConfigs(
  raw?: Partial<AIProviderConfig>['scenes'],
): AIProviderConfig['scenes'] {
  if (!raw) {
    return undefined;
  }

  const next: Record<string, NonNullable<AIProviderConfig['scenes']>[string]> = {};
  for (const [sceneId, config] of Object.entries(raw)) {
    if (!config) continue;
    next[sceneId] = {
      ...config,
      provider: coerceConfigProviderId(config.provider, DEFAULT_CONFIG.defaultProvider),
    };
  }
  return next;
}

function sanitizeProviderProfiles(
  raw?: Partial<Record<string, ProviderTransportProfile>> | undefined,
): AIProviderConfig['providerProfiles'] {
  if (!raw) {
    return undefined;
  }

  const next: Partial<Record<AIProviderId, ProviderTransportProfile>> = {};
  for (const [providerId, profile] of Object.entries(raw)) {
    if (!profile || !isAIProviderId(providerId)) {
      continue;
    }
    next[providerId] = profile;
  }
  return next;
}

function normalizeProviderTransport(
  providerId: AIProviderId,
  profile?: ProviderTransportProfile,
): ProviderTransportProfile | undefined {
  if (!profile) {
    return undefined;
  }
  if (providerId === 'antigravity') {
    return profile;
  }
  return {
    ...profile,
    transport: 'pi-ai',
  };
}

export function normalizeAIConfig(raw?: Partial<AIProviderConfig>): AIProviderConfig {
  const customProviderState = materializeCustomProviderState(raw);
  const layers = sanitizeLayerConfigs(raw?.layers);
  const scenes = sanitizeSceneConfigs(raw?.scenes);
  const providerProfiles = sanitizeProviderProfiles(raw?.providerProfiles as Partial<Record<string, ProviderTransportProfile>> | undefined);
  const normalized = {
    ...DEFAULT_CONFIG,
    ...raw,
    defaultProvider: coerceConfigProviderId(raw?.defaultProvider, DEFAULT_CONFIG.defaultProvider),
    layers: {
      ...(DEFAULT_CONFIG.layers ?? {}),
      ...(layers ?? {}),
    },
    scenes: {
      ...(DEFAULT_CONFIG.scenes ?? {}),
      ...(scenes ?? {}),
    },
    providerProfiles: {
      ...(DEFAULT_CONFIG.providerProfiles ?? {}),
      ...(providerProfiles ?? {}),
    },
    ...customProviderState,
  };

  if (normalized.providerProfiles) {
    for (const providerId of Object.keys(normalized.providerProfiles) as AIProviderId[]) {
      normalized.providerProfiles[providerId] = normalizeProviderTransport(
        providerId,
        normalized.providerProfiles[providerId],
      )!;
    }
  }

  return normalized;
}

/**
 * Load AI config from disk.
 * Falls back to DEFAULT_CONFIG if file doesn't exist.
 */
export function loadAIConfig(): AIProviderConfig {
  if (cachedConfigSource === 'override' && cachedConfig) {
    return cachedConfig;
  }

  if (shouldUseBuildDefaultConfig()) {
    if (cachedConfig && cachedConfigSource === 'default') {
      return cachedConfig;
    }
    cachedConfig = normalizeAIConfig();
    cachedConfigMtimeMs = null;
    cachedConfigSource = 'default';
    return cachedConfig;
  }

  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const mtimeMs = fs.statSync(configPath).mtimeMs;
      if (cachedConfig && cachedConfigSource === 'file' && cachedConfigMtimeMs === mtimeMs) {
        return cachedConfig;
      }

      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Partial<AIProviderConfig>;
      cachedConfig = normalizeAIConfig(raw);
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

  cachedConfig = normalizeAIConfig();
  cachedConfigMtimeMs = null;
  cachedConfigSource = 'default';
  return cachedConfig;
}

/**
 * Override AI config in memory (for testing or runtime updates).
 */
export function setAIConfig(config: Partial<AIProviderConfig>): void {
  cachedConfig = normalizeAIConfig(config);
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
  const normalized = normalizeAIConfig(config);
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2));
  cachedConfig = normalized;
  try {
    cachedConfigMtimeMs = fs.statSync(configPath).mtimeMs;
  } catch {
    cachedConfigMtimeMs = null;
  }
  cachedConfigSource = 'file';
  log.info({ configPath }, 'AI config saved');
}

export function resolveProviderProfile(
  providerId: AIProviderId,
  config: AIProviderConfig = loadAIConfig(),
): ProviderTransportProfile {
  return normalizeProviderTransport(providerId, {
    ...(DEFAULT_CONFIG.providerProfiles?.[providerId] ?? {}),
    ...(config.providerProfiles?.[providerId] ?? {}),
  }) ?? {};
}

export function getCustomProviderConnections(
  config: AIProviderConfig = loadAIConfig(),
): CustomProviderConfig[] {
  return [...(config.customProviders ?? [])];
}

export function getActiveCustomProvider(
  config: AIProviderConfig = loadAIConfig(),
): CustomProviderConfig | undefined {
  return config.customProvider;
}

export function setActiveCustomProvider(
  config: AIProviderConfig,
  connectionId: string | undefined,
): AIProviderConfig {
  const normalized = normalizeAIConfig(config);
  if (!connectionId) {
    return normalizeAIConfig({
      ...normalized,
      activeCustomProviderId: normalized.customProviders?.[0]?.id,
    });
  }

  const exists = normalized.customProviders?.some((provider) => provider.id === connectionId);
  return normalizeAIConfig({
    ...normalized,
    activeCustomProviderId: exists ? connectionId : normalized.customProviders?.[0]?.id,
  });
}

export function upsertCustomProviderConnection(
  config: AIProviderConfig,
  connection: Partial<CustomProviderConfig>,
  options?: { makeActive?: boolean },
): AIProviderConfig {
  const normalized = normalizeAIConfig(config);
  const existing = normalized.customProviders ?? [];
  const fallbackId = trimToUndefined(connection.id) ?? `custom-${Date.now()}`;
  const nextConnection = sanitizeCustomProvider(connection, fallbackId);
  if (!nextConnection) {
    return normalized;
  }

  const nextConnections = existing.some((provider) => provider.id === nextConnection.id)
    ? existing.map((provider) => (provider.id === nextConnection.id ? nextConnection : provider))
    : [...existing, nextConnection];

  return normalizeAIConfig({
    ...normalized,
    customProviders: nextConnections,
    activeCustomProviderId: options?.makeActive === false
      ? normalized.activeCustomProviderId
      : nextConnection.id,
  });
}

export function removeCustomProviderConnection(
  config: AIProviderConfig,
  connectionId: string,
): AIProviderConfig {
  const normalized = normalizeAIConfig(config);
  const nextConnections = (normalized.customProviders ?? []).filter((provider) => provider.id !== connectionId);
  const nextActiveId = normalized.activeCustomProviderId === connectionId
    ? nextConnections[0]?.id
    : normalized.activeCustomProviderId;

  return normalizeAIConfig({
    ...normalized,
    customProviders: nextConnections,
    activeCustomProviderId: nextActiveId,
  });
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
function getDepartmentProvider(workspacePath: string): AIProviderId | undefined {
  try {
    const configPath = path.join(workspacePath, '.department', 'config.json');
    if (!fs.existsSync(configPath)) return undefined;

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (config.provider && typeof config.provider === 'string') {
      return coerceConfigProviderId(config.provider, DEFAULT_CONFIG.defaultProvider);
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
