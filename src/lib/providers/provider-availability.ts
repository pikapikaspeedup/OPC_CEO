import type { AIProviderConfig, AIProviderId } from './types';
import {
  PROVIDER_LABELS,
  PROVIDER_OPTIONS,
  PROVIDER_REGISTRY,
  type StoredApiKeyId,
} from './provider-registry';

export { PROVIDER_OPTIONS, PROVIDER_LABELS } from './provider-registry';

export type ProviderOption = {
  value: AIProviderId;
  label: string;
};

export type SelectableProviderOption = ProviderOption & {
  disabled?: boolean;
};

export type ProviderInventory = {
  [key in StoredApiKeyId]: { set: boolean };
} & {
  providers: {
    codex: { installed: boolean };
    nativeCodex: { installed: boolean; loggedIn: boolean; authFilePath: string | null };
    claudeCode: { installed: boolean; loginDetected: boolean; command: string | null; installSource: string | null };
  };
};

export type ProviderValidationIssue = {
  path: string;
  provider: AIProviderId;
};

function hasText(value?: string): boolean {
  return Boolean(value?.trim());
}

export function isProviderEnabledInConfig(
  providerId: AIProviderId,
  config?: AIProviderConfig | null,
): boolean {
  return config?.providerProfiles?.[providerId]?.enabled !== false;
}

export function isCustomProviderConfigured(customProvider?: AIProviderConfig['customProvider']): boolean {
  return hasText(customProvider?.name)
    && hasText(customProvider?.baseUrl)
    && hasText(customProvider?.apiKey);
}

export function isProviderTechnicallyAvailable(
  providerId: AIProviderId,
  inventory: ProviderInventory | null | undefined,
  customProvider?: AIProviderConfig['customProvider'],
): boolean {
  const provider = PROVIDER_REGISTRY[providerId];
  switch (provider.availability) {
    case 'always':
      return true;
    case 'oauth':
      return Boolean(inventory?.providers.nativeCodex.loggedIn);
    case 'custom':
      return isCustomProviderConfigured(customProvider);
    case 'api-key':
      return Boolean(provider.storedApiKeyId && inventory?.[provider.storedApiKeyId].set);
  }
}

export function isProviderAvailable(
  providerId: AIProviderId,
  inventory: ProviderInventory | null | undefined,
  customProvider?: AIProviderConfig['customProvider'],
  config?: AIProviderConfig | null,
): boolean {
  return isProviderEnabledInConfig(providerId, config)
    && isProviderTechnicallyAvailable(providerId, inventory, customProvider);
}

export function getSelectableProviderOptions(
  inventory: ProviderInventory | null | undefined,
  customProvider?: AIProviderConfig['customProvider'],
  _currentProvider?: AIProviderId,
  config?: AIProviderConfig | null,
): SelectableProviderOption[] {
  void _currentProvider;
  return PROVIDER_OPTIONS.map((option) => {
    const available = isProviderAvailable(option.value, inventory, customProvider, config);
    return {
      ...option,
      label: available ? option.label : `${option.label} (未配置)`,
      disabled: !available,
    };
  });
}

export function findUnavailableProviders(
  config: AIProviderConfig,
  inventory: ProviderInventory | null | undefined,
): ProviderValidationIssue[] {
  const issues: ProviderValidationIssue[] = [];

  const pushIfUnavailable = (path: string, provider: AIProviderId | undefined) => {
    if (!provider) return;
    if (!isProviderAvailable(provider, inventory, config.customProvider, config)) {
      issues.push({ path, provider });
    }
  };

  pushIfUnavailable('defaultProvider', config.defaultProvider);

  for (const [layer, layerConfig] of Object.entries(config.layers ?? {})) {
    pushIfUnavailable(`layers.${layer}`, layerConfig?.provider);
  }

  for (const [scene, sceneConfig] of Object.entries(config.scenes ?? {})) {
    pushIfUnavailable(`scenes.${scene}`, sceneConfig?.provider);
  }

  return issues;
}

export function formatProviderValidationError(issues: ProviderValidationIssue[]): string {
  if (issues.length === 0) {
    return 'Provider configuration is valid';
  }

  const [{ path, provider }] = issues;
  return `Provider "${PROVIDER_LABELS[provider]}" at "${path}" is not configured and cannot be selected`;
}

export function listConfiguredProviderIds(
  config: AIProviderConfig,
  inventory: ProviderInventory | null | undefined,
  options?: { includeAntigravity?: boolean },
): AIProviderId[] {
  return PROVIDER_OPTIONS
    .map((option) => option.value)
    .filter((providerId) => (options?.includeAntigravity ? true : providerId !== 'antigravity'))
    .filter((providerId) => isProviderAvailable(providerId, inventory, config.customProvider, config));
}
