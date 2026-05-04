import type { AIProviderConfig, AIProviderId } from './types';

export type ProviderOption = {
  value: AIProviderId;
  label: string;
};

export type SelectableProviderOption = ProviderOption & {
  disabled?: boolean;
};

export type ProviderInventory = {
  anthropic: { set: boolean };
  openai: { set: boolean };
  gemini: { set: boolean };
  grok: { set: boolean };
  providers: {
    codex: { installed: boolean };
    nativeCodex: { installed: boolean; loggedIn: boolean; authFilePath: string | null };
    claudeCode: { installed: boolean; loginDetected: boolean; command: string | null; installSource: string | null };
  };
};

export const PROVIDER_OPTIONS: ProviderOption[] = [
  { value: 'antigravity', label: 'Antigravity (Native)' },
  { value: 'native-codex', label: 'Codex Native (OAuth)' },
  { value: 'claude-api', label: 'Claude API' },
  { value: 'openai-api', label: 'OpenAI API' },
  { value: 'gemini-api', label: 'Gemini API' },
  { value: 'grok-api', label: 'Grok API' },
  { value: 'custom', label: 'OpenAI Compatible / Custom' },
];

export const PROVIDER_LABELS = Object.fromEntries(
  PROVIDER_OPTIONS.map((option) => [option.value, option.label]),
) as Record<AIProviderId, string>;

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
  switch (providerId) {
    case 'antigravity':
      return true;
    case 'native-codex':
      return Boolean(inventory?.providers.nativeCodex.loggedIn);
    case 'claude-api':
      return Boolean(inventory?.anthropic.set);
    case 'openai-api':
      return Boolean(inventory?.openai.set);
    case 'gemini-api':
      return Boolean(inventory?.gemini.set);
    case 'grok-api':
      return Boolean(inventory?.grok.set);
    case 'custom':
      return isCustomProviderConfigured(customProvider);
    default:
      return false;
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
