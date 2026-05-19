import { AI_PROVIDER_IDS } from './types';
import type { AIProviderId, ProviderTransportProfile } from './types';

export type StoredApiKeyId = 'anthropic' | 'openai' | 'gemini' | 'grok';
export type ProviderAvailabilityKind = 'always' | 'oauth' | 'api-key' | 'custom';

export interface ProviderRegistryEntry {
  label: string;
  availability: ProviderAvailabilityKind;
  storedApiKeyId?: StoredApiKeyId;
  defaultProfile: ProviderTransportProfile;
}

export const PROVIDER_REGISTRY: Record<AIProviderId, ProviderRegistryEntry> = {
  antigravity: {
    label: 'Antigravity (Native)',
    availability: 'always',
    defaultProfile: { transport: 'native', authMode: 'runtime' },
  },
  'native-codex': {
    label: 'Codex Native (OAuth)',
    availability: 'oauth',
    defaultProfile: {
      transport: 'pi-ai',
      authMode: 'codex-oauth',
      supportsImageGeneration: true,
      enableImageGeneration: true,
      imageGenerationModel: 'gpt-5.5',
    },
  },
  'claude-api': {
    label: 'Claude API',
    availability: 'api-key',
    storedApiKeyId: 'anthropic',
    defaultProfile: { transport: 'pi-ai', authMode: 'api-key' },
  },
  'openai-api': {
    label: 'OpenAI API',
    availability: 'api-key',
    storedApiKeyId: 'openai',
    defaultProfile: {
      transport: 'pi-ai',
      authMode: 'api-key',
      supportsImageGeneration: true,
      enableImageGeneration: true,
      imageGenerationModel: 'gpt-image-1',
    },
  },
  'gemini-api': {
    label: 'Gemini API',
    availability: 'api-key',
    storedApiKeyId: 'gemini',
    defaultProfile: { transport: 'pi-ai', authMode: 'api-key' },
  },
  'grok-api': {
    label: 'Grok API',
    availability: 'api-key',
    storedApiKeyId: 'grok',
    defaultProfile: { transport: 'pi-ai', authMode: 'api-key' },
  },
  custom: {
    label: 'OpenAI Compatible / Custom',
    availability: 'custom',
    defaultProfile: {
      transport: 'pi-ai',
      authMode: 'proxy',
      supportsImageGeneration: true,
      enableImageGeneration: false,
    },
  },
};

export const PROVIDER_OPTIONS = AI_PROVIDER_IDS.map((providerId) => ({
  value: providerId,
  label: PROVIDER_REGISTRY[providerId].label,
}));

export const PROVIDER_LABELS = Object.fromEntries(
  AI_PROVIDER_IDS.map((providerId) => [providerId, PROVIDER_REGISTRY[providerId].label]),
) as Record<AIProviderId, string>;

export const DEFAULT_PROVIDER_PROFILES = Object.fromEntries(
  AI_PROVIDER_IDS.map((providerId) => [providerId, PROVIDER_REGISTRY[providerId].defaultProfile]),
) as Record<AIProviderId, ProviderTransportProfile>;

export const STORED_API_KEY_IDS = Array.from(
  new Set(
    AI_PROVIDER_IDS
      .map((providerId) => PROVIDER_REGISTRY[providerId].storedApiKeyId)
      .filter((keyId): keyId is StoredApiKeyId => Boolean(keyId)),
  ),
);
