import type { AIProviderConfig, ProviderId } from './types';

export type ProviderOption = {
  value: ProviderId;
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
  { value: 'codex', label: 'Codex (MCP)' },
  { value: 'claude-code', label: 'Claude Code (CLI)' },
  { value: 'claude-api', label: 'Claude API' },
  { value: 'openai-api', label: 'OpenAI API' },
  { value: 'gemini-api', label: 'Gemini API' },
  { value: 'grok-api', label: 'Grok API' },
  { value: 'custom', label: 'OpenAI Compatible / Custom' },
];

export const PROVIDER_LABELS = Object.fromEntries(
  PROVIDER_OPTIONS.map((option) => [option.value, option.label]),
) as Record<ProviderId, string>;

export type ProviderValidationIssue = {
  path: string;
  provider: ProviderId;
};

function hasText(value?: string): boolean {
  return Boolean(value?.trim());
}

export function isCustomProviderConfigured(customProvider?: AIProviderConfig['customProvider']): boolean {
  return hasText(customProvider?.name)
    && hasText(customProvider?.baseUrl)
    && hasText(customProvider?.apiKey);
}

export function isProviderAvailable(
  providerId: ProviderId,
  inventory: ProviderInventory | null | undefined,
  customProvider?: AIProviderConfig['customProvider'],
): boolean {
  switch (providerId) {
    case 'antigravity':
      return true;
    case 'codex':
      return Boolean(inventory?.providers.codex.installed);
    case 'native-codex':
      return Boolean(inventory?.providers.nativeCodex.loggedIn);
    case 'claude-code':
      return Boolean(inventory?.providers.claudeCode.installed && inventory?.providers.claudeCode.loginDetected);
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

export function getSelectableProviderOptions(
  inventory: ProviderInventory | null | undefined,
  customProvider?: AIProviderConfig['customProvider'],
  currentProvider?: ProviderId,
): SelectableProviderOption[] {
  const options = PROVIDER_OPTIONS
    .filter((option) => isProviderAvailable(option.value, inventory, customProvider))
    .map((option) => ({ ...option, disabled: false }));

  if (!currentProvider || options.some((option) => option.value === currentProvider)) {
    return options;
  }

  return [
    {
      value: currentProvider,
      label: `${PROVIDER_LABELS[currentProvider]} (未配置)`,
      disabled: true,
    },
    ...options,
  ];
}

export function findUnavailableProviders(
  config: AIProviderConfig,
  inventory: ProviderInventory | null | undefined,
): ProviderValidationIssue[] {
  const issues: ProviderValidationIssue[] = [];

  const pushIfUnavailable = (path: string, provider: ProviderId | undefined) => {
    if (!provider) return;
    if (!isProviderAvailable(provider, inventory, config.customProvider)) {
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
