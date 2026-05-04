import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';

import type { KnownProvider } from '@mariozechner/pi-ai';

import { grpc, tryAllServers } from './bridge/gateway';
import { createLogger } from './logger';
import { loadAIConfig, resolveProviderProfile } from './providers/ai-config';
import { buildOpenAICompatibleModelsUrl } from './providers/openai-compatible';
import { PROVIDER_LABELS } from './providers/provider-availability';
import { getProviderInventory } from './providers/provider-inventory';
import type {
  AIProviderId,
  AIProviderConfig,
  ProviderTransportId,
  ProviderTransportProfile,
} from './providers/types';
import type { ModelConfig, ModelsResponse } from './types';

const log = createLogger('ProviderModelCatalog');

export type ProviderModelCatalogSource =
  | 'antigravity-runtime'
  | 'pi-registry'
  | 'remote-discovery'
  | 'manual';

export interface ProviderModelCatalogModel {
  id: string;
  label: string;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  supportsImageGeneration?: boolean;
  contextWindow?: number;
}

export interface ProviderModelCatalogEntry {
  provider: AIProviderId;
  transport: ProviderTransportId;
  source: ProviderModelCatalogSource;
  fetchedAt: string;
  models: ProviderModelCatalogModel[];
  profileFingerprint?: string;
  warning?: string;
  stale?: boolean;
}

export interface ProviderModelCatalogRequest {
  provider: AIProviderId;
  refresh?: boolean;
  customProviderOverride?: AIProviderConfig['customProvider'];
}

type CatalogCache = Record<string, ProviderModelCatalogEntry>;

const MODEL_CATALOG_PATH = path.join(homedir(), '.gemini', 'antigravity', 'provider-model-catalog.json');
const MODEL_CATALOG_SCHEMA_VERSION = 2;
let piAiModulePromise: Promise<typeof import('@mariozechner/pi-ai')> | null = null;

const PI_PROVIDER_MAP: Partial<Record<AIProviderId, KnownProvider>> = {
  'claude-api': 'anthropic',
  'native-codex': 'openai-codex',
  'openai-api': 'openai',
  'gemini-api': 'google',
  'grok-api': 'xai',
};

const RESPONSES_IMAGE_TOOL_MODELS = new Set([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'o3',
  'gpt-5',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5-nano',
  'gpt-5.5',
  'gpt-5.2',
]);

function hasText(value?: string): boolean {
  return Boolean(value?.trim());
}

async function loadPiAi() {
  if (!piAiModulePromise) {
    piAiModulePromise = import('@mariozechner/pi-ai');
  }
  return piAiModulePromise;
}

function ensureCatalogDir(): void {
  const dir = path.dirname(MODEL_CATALOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readCatalogCache(): CatalogCache {
  try {
    if (!fs.existsSync(MODEL_CATALOG_PATH)) {
      return {};
    }
    const raw = JSON.parse(fs.readFileSync(MODEL_CATALOG_PATH, 'utf-8')) as unknown;
    return raw && typeof raw === 'object' ? (raw as CatalogCache) : {};
  } catch {
    return {};
  }
}

function writeCatalogCache(cache: CatalogCache): void {
  ensureCatalogDir();
  fs.writeFileSync(MODEL_CATALOG_PATH, JSON.stringify(cache, null, 2), 'utf-8');
}

function buildProfileFingerprint(
  provider: AIProviderId,
  profile: ProviderTransportProfile,
  config: AIProviderConfig,
  customProviderOverride?: AIProviderConfig['customProvider'],
): string {
  const custom = customProviderOverride ?? config.customProvider;
  return JSON.stringify({
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    provider,
    transport: profile.transport ?? 'native',
    authMode: profile.authMode ?? null,
    baseUrl: custom?.baseUrl ?? null,
    defaultModel: custom?.defaultModel ?? null,
    vendor: custom?.vendor ?? null,
  });
}

async function mapPiModelsToCatalog(
  provider: AIProviderId,
  transport: ProviderTransportId,
  piProvider: KnownProvider,
): Promise<ProviderModelCatalogEntry> {
  const piAi = await loadPiAi();
  const models = piAi.getModels(piProvider).map((model) => ({
    id: model.id,
    label: model.name || model.id,
    supportsTools: true,
    supportsVision: model.input.includes('image'),
    supportsReasoning: Boolean(model.reasoning),
    supportsImageGeneration:
      /image/i.test(model.id)
      || ((provider === 'openai-api' || provider === 'native-codex') && RESPONSES_IMAGE_TOOL_MODELS.has(model.id)),
    contextWindow: model.contextWindow,
  }));

  return {
    provider,
    transport,
    source: 'pi-registry',
    fetchedAt: new Date().toISOString(),
    models,
  };
}

function mapRuntimeModelsToCatalog(data: ModelsResponse): ProviderModelCatalogEntry {
  const models: ProviderModelCatalogModel[] = [];
  for (const entry of data.clientModelConfigs || []) {
    const id = entry.modelOrAlias?.model?.trim();
    if (!id) continue;
    models.push({
      id,
      label: entry.label || id,
      supportsTools: true,
    });
  }

  return {
    provider: 'antigravity',
    transport: 'native',
    source: 'antigravity-runtime',
    fetchedAt: new Date().toISOString(),
    models,
  };
}

async function discoverAntigravityCatalog(): Promise<ProviderModelCatalogEntry> {
  const data = await tryAllServers((port, csrf, apiKey) => grpc.getModelConfigs(port, csrf, apiKey));
  return mapRuntimeModelsToCatalog(data);
}

async function discoverCustomCatalog(
  config: AIProviderConfig,
  profile: ProviderTransportProfile,
  customProviderOverride?: AIProviderConfig['customProvider'],
): Promise<ProviderModelCatalogEntry> {
  const custom = customProviderOverride ?? config.customProvider;

  if (!hasText(custom?.baseUrl) || !hasText(custom?.apiKey)) {
    const manualModels = hasText(custom?.defaultModel)
      ? [{
          id: custom!.defaultModel!.trim(),
          label: custom!.defaultModel!.trim(),
          supportsTools: true,
        } satisfies ProviderModelCatalogModel]
      : [];

    return {
      provider: 'custom',
      transport: profile.transport ?? 'native',
      source: 'manual',
      fetchedAt: new Date().toISOString(),
      models: manualModels,
      warning: manualModels.length > 0
        ? '未配置可发现端点，已回退到手动模型。'
        : '请先填写 Base URL 和 API Key 后再刷新模型。',
    };
  }

  const safeCustom = custom as NonNullable<AIProviderConfig['customProvider']>;

  const endpoint = buildOpenAICompatibleModelsUrl(safeCustom.baseUrl!);
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${safeCustom.apiKey!.trim()}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    if (hasText(safeCustom.defaultModel)) {
      return {
        provider: 'custom',
        transport: profile.transport ?? 'native',
        source: 'manual',
        fetchedAt: new Date().toISOString(),
        models: [{
          id: safeCustom.defaultModel!.trim(),
          label: safeCustom.defaultModel!.trim(),
          supportsTools: true,
        }],
        warning: `远端模型发现失败（HTTP ${response.status}），已回退到手动模型。`,
      };
    }
    throw new Error(`Custom provider model discovery failed: HTTP ${response.status}`);
  }

  const json = await response.json() as { data?: Array<{ id?: string; name?: string }> };
  const models: ProviderModelCatalogModel[] = [];
  for (const item of json.data || []) {
    const id = item.id?.trim();
    if (!id) continue;
    models.push({
      id,
      label: item.name?.trim() || id,
      supportsTools: true,
    });
  }

  if (models.length === 0 && hasText(safeCustom.defaultModel)) {
    models.push({
      id: safeCustom.defaultModel!.trim(),
      label: safeCustom.defaultModel!.trim(),
      supportsTools: true,
    });
  }

  return {
    provider: 'custom',
    transport: profile.transport ?? 'native',
    source: models.length > 0 ? 'remote-discovery' : 'manual',
    fetchedAt: new Date().toISOString(),
    models,
    warning: models.length > 0 ? undefined : '远端未返回模型列表，已保留手动模型输入。',
  };
}

async function buildCatalogEntry(
  provider: AIProviderId,
  config: AIProviderConfig,
  customProviderOverride?: AIProviderConfig['customProvider'],
): Promise<ProviderModelCatalogEntry> {
  const profile = resolveProviderProfile(provider, config);
  const transport = profile.transport ?? 'native';

  if (provider === 'antigravity') {
    return discoverAntigravityCatalog();
  }

  if (provider === 'custom') {
    return discoverCustomCatalog(config, profile, customProviderOverride);
  }

  const piProvider = PI_PROVIDER_MAP[provider];
  if (piProvider) {
    const piAi = await loadPiAi();
    if (piAi.getProviders().includes(piProvider)) {
      return mapPiModelsToCatalog(provider, transport, piProvider);
    }
  }

  const models: ProviderModelCatalogModel[] = [];
  const defaultModel = config.defaultModel;
  if (hasText(defaultModel)) {
    models.push({
      id: defaultModel!.trim(),
      label: defaultModel!.trim(),
      supportsTools: true,
    });
  }

  return {
    provider,
    transport,
    source: 'manual',
    fetchedAt: new Date().toISOString(),
    models,
    warning: models.length > 0 ? '已回退到手动模型列表。' : '当前 provider 没有可发现模型目录。',
  };
}

export async function getProviderModelCatalog(
  request: ProviderModelCatalogRequest,
  config: AIProviderConfig = loadAIConfig(),
): Promise<ProviderModelCatalogEntry> {
  const cache = readCatalogCache();
  const profile = resolveProviderProfile(request.provider, config);
  const fingerprint = buildProfileFingerprint(request.provider, profile, config, request.customProviderOverride);
  const cached = cache[request.provider];

  if (!request.refresh && cached && cached.profileFingerprint === fingerprint) {
    return cached;
  }

  try {
    const entry = await buildCatalogEntry(request.provider, config, request.customProviderOverride);
    const next = {
      ...entry,
      profileFingerprint: fingerprint,
    } satisfies ProviderModelCatalogEntry;
    cache[request.provider] = next;
    writeCatalogCache(cache);
    return next;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ provider: request.provider, error: message }, 'Provider model catalog refresh failed');

    if (cached) {
      return {
        ...cached,
        stale: true,
        warning: `模型刷新失败，已回退到缓存：${message}`,
      };
    }

    throw error;
  }
}

function toModelConfig(provider: AIProviderId, model: ProviderModelCatalogModel): ModelConfig {
  return {
    label: `${PROVIDER_LABELS[provider] ?? provider} · ${model.label}`,
    modelOrAlias: { model: model.id },
    isRecommended: /gpt-5\.4|gpt-5\.5|sonnet|gemini-2\.5-pro|grok-3|deepseek-chat/i.test(model.id),
    tagTitle: model.supportsVision
      ? 'Vision'
      : model.supportsReasoning
        ? 'Reasoning'
        : undefined,
  };
}

export async function buildProviderAwareModelResponse(): Promise<ModelsResponse> {
  const inventory = getProviderInventory();
  const config = loadAIConfig();
  const providers: AIProviderId[] = ['antigravity'];

  if (inventory.providers.nativeCodex.loggedIn) providers.push('native-codex');
  if (inventory.anthropic.set) providers.push('claude-api');
  if (inventory.openai.set) providers.push('openai-api');
  if (inventory.gemini.set) providers.push('gemini-api');
  if (inventory.grok.set) providers.push('grok-api');
  if (hasText(config.customProvider?.defaultModel) || (hasText(config.customProvider?.baseUrl) && hasText(config.customProvider?.apiKey))) {
    providers.push('custom');
  }

  const deduped = new Map<string, ModelConfig>();
  const results = await Promise.allSettled(
    [...new Set(providers)].map((provider) => getProviderModelCatalog({ provider }, config)),
  );

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const model of result.value.models) {
      if (!deduped.has(model.id)) {
        deduped.set(model.id, toModelConfig(result.value.provider, model));
      }
    }
  }

  return {
    clientModelConfigs: [...deduped.values()],
  };
}

export function mergeModelResponses(primary: ModelsResponse, fallback: ModelsResponse): ModelsResponse {
  const merged = new Map<string, ModelConfig>();

  for (const entry of primary.clientModelConfigs || []) {
    const model = entry.modelOrAlias?.model;
    if (!model) continue;
    merged.set(model, entry);
  }

  for (const entry of fallback.clientModelConfigs || []) {
    const model = entry.modelOrAlias?.model;
    if (!model || merged.has(model)) continue;
    merged.set(model, entry);
  }

  return {
    ...primary,
    clientModelConfigs: [...merged.values()],
  };
}

export function getProviderModelCatalogPath(): string {
  return MODEL_CATALOG_PATH;
}
