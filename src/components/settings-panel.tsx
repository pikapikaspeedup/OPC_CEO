'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Image from 'next/image';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Eye,
  EyeOff,
  Save,
  Layers,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Activity,
  Globe,
  CircleCheck,
  Cpu,
  Network,
  ServerCog,
  Wand2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isUnconfiguredWebApiError, readJsonOrThrow } from '@/lib/api-response';
import CcConnectTab from '@/components/cc-connect-tab';
import CEOProfileSettingsTab from '@/components/ceo-profile-settings-tab';
import McpServersTab from '@/components/settings/mcp-servers-tab';
import {
  SectionTitle,
  Card,
  FieldRow,
  SaveFeedback,
  ProviderSelect,
  ProviderModelInput,
  type ApiKeyTestStatus,
} from '@/components/settings/shared';
import SceneOverridesTab from '@/components/settings/scene-overrides-tab';
import ApiKeysTab from '@/components/settings/api-keys-tab';
import AutonomyBudgetTab from '@/components/settings/autonomy-budget-tab';
import {
  WorkspaceBadge,
  WorkspaceEmptyBlock,
  WorkspaceSurface,
  WorkspaceTabsList,
  WorkspaceTabsTrigger,
  type WorkspacePrimitiveTone,
  workspaceFieldClassName,
  workspaceOutlineActionClassName,
} from '@/components/ui/workspace-primitives';
import {
  AI_PROVIDER_IDS,
  type AIProviderConfig,
  type AIProviderId,
  type AILayer,
  type CustomProviderConfig,
  type ProviderId,
} from '@/lib/providers/types';
import {
  PROVIDER_LABELS,
  isCustomProviderConfigured,
  isProviderAvailable,
  type ProviderInventory,
} from '@/lib/providers/provider-availability';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LAYERS: AILayer[] = ['executive', 'management', 'execution', 'utility'];

const LAYER_LABELS: Record<AILayer, string> = {
  executive: 'Executive',
  management: 'Management',
  execution: 'Execution',
  utility: 'Utility',
};

function providerImageGenerationEnabled(
  provider: AIProviderId,
  config?: AIProviderConfig | null,
): boolean {
  return config?.providerProfiles?.[provider]?.enableImageGeneration === true;
}

function providerSupportsImageGeneration(
  provider: AIProviderId,
  config?: AIProviderConfig | null,
): boolean {
  return config?.providerProfiles?.[provider]?.supportsImageGeneration === true;
}

function listImageCapableProvidersFromConfig(config?: AIProviderConfig | null): AIProviderId[] {
  return AI_PROVIDER_IDS.filter((provider) => providerSupportsImageGeneration(provider, config));
}

export type SettingsTabId = 'profile' | 'provider' | 'api-keys' | 'scenes' | 'autonomy' | 'mcp' | 'messaging';
export type SettingsFocusTarget = 'third-party-provider' | null;
type CredentialApiProvider = 'anthropic' | 'openai' | 'gemini' | 'grok';
type InlineCredentialProviderId = 'claude-api' | 'openai-api' | 'gemini-api' | 'grok-api';

type ThirdPartyProviderPresetId = 'deepseek' | 'groq' | 'ollama' | 'openai-compatible' | 'custom';

type ThirdPartyTestState = {
  status: 'idle' | 'testing' | 'ok' | 'invalid' | 'error';
  message?: string;
};

type ProviderActionState = {
  status: 'idle' | 'saving' | 'ok' | 'error';
  message?: string;
};

type ProviderImageTestState = {
  status: 'idle' | 'testing' | 'ok' | 'error';
  message?: string;
  dataUrl?: string;
  provider?: AIProviderId;
  model?: string;
  fallbackProvider?: AIProviderId;
};

type SettingsConfigError =
  | { kind: 'web-api-unavailable'; message: string; path?: string }
  | { kind: 'generic'; message: string };

type ThirdPartyPreset = {
  id: ThirdPartyProviderPresetId;
  title: string;
  description: string;
  endpointHint: string;
  defaultName: string;
  defaultBaseUrl: string;
  defaultModel: string;
  modelHint: string;
  notes: string;
  deployment: string;
  icon: React.ReactNode;
};

const THIRD_PARTY_PRESETS: ThirdPartyPreset[] = [
  {
    id: 'deepseek',
    title: 'DeepSeek',
    description: '云端 OpenAI-compatible 接口，适合替换通用推理与 coding 模型。',
    endpointHint: 'https://api.deepseek.com',
    defaultName: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    modelHint: 'deepseek-chat / deepseek-reasoner',
    notes: '推荐先用 deepseek-chat，若需要更强推理可切到 deepseek-reasoner。',
    deployment: '公网 API',
    icon: <Wand2 className="h-4 w-4" />,
  },
  {
    id: 'groq',
    title: 'Groq',
    description: '低延迟 OpenAI-compatible 接口，适合快速工具调用与轻量工作流。',
    endpointHint: 'https://api.groq.com/openai',
    defaultName: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai',
    defaultModel: 'llama-3.3-70b-versatile',
    modelHint: 'llama-3.3-70b-versatile / mixtral-8x7b',
    notes: 'Groq 常见 endpoint 带 `/openai` 前缀，模型名需按 Groq 控制台为准。',
    deployment: '公网 API',
    icon: <Activity className="h-4 w-4" />,
  },
  {
    id: 'ollama',
    title: 'Ollama',
    description: '本地或局域网部署的 OpenAI-compatible 模式，适合离线和内网场景。',
    endpointHint: 'http://127.0.0.1:11434',
    defaultName: 'Ollama',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    defaultModel: 'qwen2.5-coder:14b',
    modelHint: 'qwen2.5-coder:14b / llama3.1:8b',
    notes: '若在 Docker、NAS 或局域网机器上，请填写真实局域网地址，不要保留 localhost。',
    deployment: '本地 / 局域网',
    icon: <Cpu className="h-4 w-4" />,
  },
  {
    id: 'openai-compatible',
    title: 'OpenAI Compatible',
    description: '适配任意兼容 `/v1/models` 的第三方服务，例如代理网关、私有部署、vLLM。',
    endpointHint: 'https://your-endpoint.example.com',
    defaultName: 'OpenAI Compatible',
    defaultBaseUrl: '',
    defaultModel: '',
    modelHint: '填写服务端真实模型名',
    notes: '适合未内置预设的第三方厂商；只要兼容 OpenAI 接口即可接入。',
    deployment: '公网 / 私有化',
    icon: <Network className="h-4 w-4" />,
  },
  {
    id: 'custom',
    title: '高级自定义',
    description: '完全手填厂商名称、端点和模型，适合特殊协议包装或代理层。',
    endpointHint: 'https://custom-endpoint.example.com',
    defaultName: 'Custom Provider',
    defaultBaseUrl: '',
    defaultModel: '',
    modelHint: '填写服务端真实模型名',
    notes: '仅适用于 OpenAI-compatible 端点；非兼容协议仍需要后端执行器适配。',
    deployment: '高级模式',
    icon: <ServerCog className="h-4 w-4" />,
  },
];

const SETTINGS_TABS: Array<{ value: SettingsTabId; label: string }> = [
  { value: 'profile', label: '个人偏好' },
  { value: 'provider', label: 'Provider 配置' },
  { value: 'scenes', label: 'Scene 覆盖' },
  { value: 'autonomy', label: '预算策略' },
  { value: 'mcp', label: 'MCP 服务器' },
  { value: 'messaging', label: '会话平台' },
];

const INLINE_CREDENTIAL_META: Record<InlineCredentialProviderId, {
  key: CredentialApiProvider;
  title: string;
  placeholder: string;
  summary: string;
}> = {
  'claude-api': {
    key: 'anthropic',
    title: 'Anthropic API Key',
    placeholder: 'sk-ant-...',
    summary: '输入 Anthropic Key 后即可直接使用 Claude API。',
  },
  'openai-api': {
    key: 'openai',
    title: 'OpenAI API Key',
    placeholder: 'sk-...',
    summary: '输入 OpenAI Key 后即可使用 OpenAI 模型与图像能力。',
  },
  'gemini-api': {
    key: 'gemini',
    title: 'Gemini API Key',
    placeholder: 'AIza...',
    summary: '输入 Gemini Key 后即可使用 Gemini API 模型。',
  },
  'grok-api': {
    key: 'grok',
    title: 'Grok API Key',
    placeholder: 'xai-...',
    summary: '输入 xAI / Grok Key 后即可使用 Grok API。',
  },
};

function isInlineCredentialProvider(provider: ProviderId): provider is InlineCredentialProviderId {
  return provider === 'claude-api'
    || provider === 'openai-api'
    || provider === 'gemini-api'
    || provider === 'grok-api';
}

const AI_ACCESS_PROVIDER_OPTIONS: Array<{ value: InlineCredentialProviderId | 'custom'; label: string }> = [
  { value: 'openai-api', label: 'OpenAI API' },
  { value: 'claude-api', label: 'Claude API' },
  { value: 'gemini-api', label: 'Gemini API' },
  { value: 'grok-api', label: 'Grok API' },
  { value: 'custom', label: '自定义服务' },
];

function getInventoryKeyStatus(
  inventory: ProviderInventory | null,
  provider: CredentialApiProvider,
): boolean {
  if (!inventory) return false;
  switch (provider) {
    case 'anthropic':
      return inventory.anthropic.set;
    case 'openai':
      return inventory.openai.set;
    case 'gemini':
      return inventory.gemini.set;
    case 'grok':
      return inventory.grok.set;
    default:
      return false;
  }
}

function normalizeCustomProviderDraft(
  draft?: Partial<CustomProviderConfig> | null,
  fallbackId?: string,
): CustomProviderConfig {
  const id = draft?.id?.trim() || fallbackId || `custom-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    vendor: draft?.vendor?.trim() || undefined,
    name: draft?.name?.trim() || undefined,
    baseUrl: draft?.baseUrl?.trim() || undefined,
    apiKey: draft?.apiKey?.trim() || undefined,
    defaultModel: draft?.defaultModel?.trim() || undefined,
  };
}

function applyCustomConnectionsToConfig(
  config: AIProviderConfig,
  nextConnections: CustomProviderConfig[],
  nextActiveCustomProviderId?: string,
): AIProviderConfig {
  const activeCustomProviderId = nextActiveCustomProviderId
    && nextConnections.some((connection) => connection.id === nextActiveCustomProviderId)
    ? nextActiveCustomProviderId
    : nextConnections[0]?.id;
  const activeCustomProvider = nextConnections.find((connection) => connection.id === activeCustomProviderId);

  return {
    ...config,
    customProviders: nextConnections.length > 0 ? nextConnections : undefined,
    activeCustomProviderId,
    customProvider: activeCustomProvider,
  };
}

type ProviderConnectionSummary = {
  kind: 'provider' | 'execution-tool';
  id: string;
  provider: ProviderId;
  label: string;
  detail?: string;
  statusLabel: string;
  tone: WorkspacePrimitiveTone;
  removable?: boolean;
  restorable?: boolean;
  editable?: boolean;
  testable?: boolean;
  active?: boolean;
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SettingsBackendUnavailable({ error }: { error: SettingsConfigError }) {
  const isWebApiUnavailable = error.kind === 'web-api-unavailable';
  return (
    <div className="px-6 py-8">
      <WorkspaceSurface tone={isWebApiUnavailable ? 'warning' : 'danger'} className="space-y-5" padding="lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <WorkspaceBadge tone={isWebApiUnavailable ? 'warning' : 'danger'}>
              {isWebApiUnavailable ? 'Backend required' : 'Config unavailable'}
            </WorkspaceBadge>
            <h3 className="mt-3 text-lg font-semibold tracking-[-0.03em] text-[var(--app-text)]">
              {isWebApiUnavailable ? 'Settings 需要连接 Control Plane / Runtime' : '无法加载 Settings 配置'}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--app-text-soft)]">
              {isWebApiUnavailable
                ? '当前进程处于 web ingress-only 模式，并且没有配置后端 URL。为避免误触发本地控制面副作用，配置类 API 已被主动隔离。'
                : error.message}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3 text-xs leading-6 text-[var(--app-text-soft)]">
            <div><span className="text-[var(--app-text-muted)]">Required:</span> AG_CONTROL_PLANE_URL</div>
            <div><span className="text-[var(--app-text-muted)]">Required:</span> AG_RUNTIME_URL</div>
            {isWebApiUnavailable && error.path ? <div><span className="text-[var(--app-text-muted)]">Blocked:</span> {error.path}</div> : null}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <WorkspaceSurface padding="sm">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">不做的事</div>
            <div className="mt-2 text-sm text-[var(--app-text-soft)]">不会从 web 进程穿透到本地 route handler。</div>
          </WorkspaceSurface>
          <WorkspaceSurface padding="sm">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">要做的事</div>
            <div className="mt-2 text-sm text-[var(--app-text-soft)]">启动 control-plane/runtime，或给 web 配置后端 URL。</div>
          </WorkspaceSurface>
          <WorkspaceSurface padding="sm">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">当前页面</div>
            <div className="mt-2 text-sm text-[var(--app-text-soft)]">保持只读降级，不创建后台 scheduler / registry 噪音。</div>
          </WorkspaceSurface>
        </div>
        <Button
          type="button"
          variant="outline"
          className={cn('rounded-full', workspaceOutlineActionClassName)}
          onClick={() => window.location.reload()}
        >
          重新检查连接
        </Button>
      </WorkspaceSurface>
    </div>
  );
}

function inferThirdPartyPreset(config: AIProviderConfig | null): ThirdPartyProviderPresetId {
  const vendor = config?.customProvider?.vendor;
  if (vendor && THIRD_PARTY_PRESETS.some((preset) => preset.id === vendor)) {
    return vendor as ThirdPartyProviderPresetId;
  }

  const baseUrl = (config?.customProvider?.baseUrl || '').toLowerCase();
  if (baseUrl.includes('deepseek')) return 'deepseek';
  if (baseUrl.includes('groq')) return 'groq';
  if (baseUrl.includes('11434') || baseUrl.includes('ollama')) return 'ollama';
  if (baseUrl) return 'openai-compatible';
  return 'deepseek';
}

function getThirdPartyPreset(id: ThirdPartyProviderPresetId): ThirdPartyPreset {
  return THIRD_PARTY_PRESETS.find((preset) => preset.id === id) || THIRD_PARTY_PRESETS[0];
}

// ---------------------------------------------------------------------------
// Tab 1: Provider Config
// ---------------------------------------------------------------------------

function ProviderConfigTab({
  initialConfig,
  providerInventory,
  onProviderInventoryChanged,
  focusThirdParty = false,
  focusRequestToken = 0,
}: {
  initialConfig: AIProviderConfig | null;
  providerInventory: ProviderInventory | null;
  onProviderInventoryChanged?: (inventory: ProviderInventory) => void;
  focusThirdParty?: boolean;
  focusRequestToken?: number;
}) {
  const [config, setConfig] = useState<AIProviderConfig | null>(initialConfig);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<Record<string, 'checking' | 'ok' | 'error' | 'unknown'>>({});
  const [thirdPartyPreset, setThirdPartyPreset] = useState<ThirdPartyProviderPresetId>(inferThirdPartyPreset(initialConfig));
  const [thirdPartyTest, setThirdPartyTest] = useState<ThirdPartyTestState>({ status: 'idle' });
  const [thirdPartyAction, setThirdPartyAction] = useState<ProviderActionState>({ status: 'idle' });
  const [connectionTestState, setConnectionTestState] = useState<Record<string, ThirdPartyTestState>>({});
  const [connectionActionState, setConnectionActionState] = useState<Record<string, ProviderActionState>>({});
  const [imageProvider, setImageProvider] = useState<AIProviderId>('openai-api');
  const [imagePrompt, setImagePrompt] = useState('A compact product icon with a blue square and a clean white background');
  const [imageTest, setImageTest] = useState<ProviderImageTestState>({ status: 'idle' });
  const [showImageTools, setShowImageTools] = useState(false);
  const [showLayerConfig, setShowLayerConfig] = useState(false);
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);
  const [showThirdPartySetup, setShowThirdPartySetup] = useState(() => Boolean(focusThirdParty));
  const [editingCustomConnectionId, setEditingCustomConnectionId] = useState<string | null>(initialConfig?.activeCustomProviderId ?? null);
  const [customDraft, setCustomDraft] = useState<CustomProviderConfig>(() => normalizeCustomProviderDraft(initialConfig?.customProvider, 'custom-draft'));
  const [accessProvider, setAccessProvider] = useState<InlineCredentialProviderId | 'custom'>(() => {
    if (initialConfig?.defaultProvider === 'custom') return 'custom';
    if (initialConfig?.defaultProvider && isInlineCredentialProvider(initialConfig.defaultProvider)) {
      return initialConfig.defaultProvider;
    }
    return isCustomProviderConfigured(initialConfig?.customProvider) ? 'custom' : 'openai-api';
  });
  const [inlineCredentialValue, setInlineCredentialValue] = useState('');
  const [showInlineCredentialValue, setShowInlineCredentialValue] = useState(false);
  const [inlineCredentialAction, setInlineCredentialAction] = useState<ProviderActionState>({ status: 'idle' });
  const [inlineCredentialTestStatus, setInlineCredentialTestStatus] = useState<ApiKeyTestStatus>('idle');
  const [inlineCredentialTestError, setInlineCredentialTestError] = useState<string | null>(null);
  const thirdPartySectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const imageCapableProviders = listImageCapableProvidersFromConfig(initialConfig);
    setConfig(initialConfig);
    setThirdPartyPreset(inferThirdPartyPreset(initialConfig));
    setThirdPartyTest({ status: 'idle' });
    setThirdPartyAction({ status: 'idle' });
    setConnectionTestState({});
    setConnectionActionState({});
    setImageProvider(
      initialConfig?.defaultProvider && providerSupportsImageGeneration(initialConfig.defaultProvider, initialConfig)
        ? initialConfig.defaultProvider
        : imageCapableProviders[0] ?? 'openai-api',
    );
    setImageTest({ status: 'idle' });
    setShowImageTools(false);
    setShowAdvancedConfig(false);
    if (initialConfig?.defaultProvider === 'custom') {
      setAccessProvider('custom');
    } else if (initialConfig?.defaultProvider && isInlineCredentialProvider(initialConfig.defaultProvider)) {
      setAccessProvider(initialConfig.defaultProvider);
    } else {
      setAccessProvider(isCustomProviderConfigured(initialConfig?.customProvider) ? 'custom' : 'openai-api');
    }
    setEditingCustomConnectionId(initialConfig?.activeCustomProviderId ?? null);
    setCustomDraft(normalizeCustomProviderDraft(initialConfig?.customProvider, 'custom-draft'));
    setInlineCredentialValue('');
    setShowInlineCredentialValue(false);
    setInlineCredentialAction({ status: 'idle' });
    setInlineCredentialTestStatus('idle');
    setInlineCredentialTestError(null);
  }, [initialConfig]);

  useEffect(() => {
    if (focusThirdParty && focusRequestToken > 0) {
      setShowThirdPartySetup(true);
      window.setTimeout(() => {
        thirdPartySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [focusThirdParty, focusRequestToken]);

  useEffect(() => {
    setInlineCredentialValue('');
    setShowInlineCredentialValue(false);
    setInlineCredentialAction({ status: 'idle' });
    setInlineCredentialTestStatus('idle');
    setInlineCredentialTestError(null);
  }, [accessProvider]);

  const checkProviderHealth = useCallback((
    providerId: AIProviderId,
    customProvider?: AIProviderConfig['customProvider'],
    nextConfig?: AIProviderConfig | null,
  ) => {
    if (!providerInventory && providerId !== 'antigravity' && !(providerId === 'custom' && isCustomProviderConfigured(customProvider))) {
      setProviderStatus(prev => ({ ...prev, [providerId]: 'unknown' }));
      return;
    }

    setProviderStatus(prev => ({
      ...prev,
      [providerId]: isProviderAvailable(providerId, providerInventory, customProvider, nextConfig ?? config) ? 'ok' : 'error',
    }));
  }, [config, providerInventory]);

  useEffect(() => {
    if (!config) return;
    const providers = new Set<AIProviderId>([config.defaultProvider]);
    if (config.layers) {
      for (const layer of Object.values(config.layers)) {
        if (layer?.provider) providers.add(layer.provider);
      }
    }
    for (const provider of providers) {
      checkProviderHealth(provider, config.customProvider);
    }
  }, [config, checkProviderHealth]);

  const selectedPreset = useMemo(
    () => getThirdPartyPreset(thirdPartyPreset),
    [thirdPartyPreset],
  );

  const imageCapableProviders = useMemo(
    () => listImageCapableProvidersFromConfig(config),
    [config],
  );

  const getLayerProvider = useCallback(
    (layer: AILayer): AIProviderId => config?.layers?.[layer]?.provider ?? config?.defaultProvider ?? 'antigravity',
    [config],
  );

  const getLayerModel = useCallback(
    (layer: AILayer): string => config?.layers?.[layer]?.model ?? '',
    [config],
  );

  const getImageGenerationEnabled = useCallback(
    (provider: AIProviderId): boolean => providerImageGenerationEnabled(provider, config),
    [config],
  );

  const getImageGenerationModel = useCallback(
    (provider: AIProviderId): string => config?.providerProfiles?.[provider]?.imageGenerationModel
      ?? '',
    [config],
  );

  const setImageGenerationEnabled = (provider: AIProviderId, enable: boolean) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        providerProfiles: {
          ...(prev.providerProfiles ?? {}),
          [provider]: {
            ...(prev.providerProfiles?.[provider] ?? {}),
            enableImageGeneration: enable,
          },
        },
      };
    });
  };

  const setImageGenerationModel = (provider: AIProviderId, model: string) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        providerProfiles: {
          ...(prev.providerProfiles ?? {}),
          [provider]: {
            ...(prev.providerProfiles?.[provider] ?? {}),
            imageGenerationModel: model || undefined,
          },
        },
      };
    });
  };

  const setDefaultProvider = (provider: AIProviderId) => {
    setConfig(prev => (prev ? { ...prev, defaultProvider: provider } : prev));
    checkProviderHealth(provider, config?.customProvider);
  };

  const setDefaultModel = (model: string) => {
    setConfig(prev => (prev ? { ...prev, defaultModel: model || undefined } : prev));
  };

  const setLayerProvider = (layer: AILayer, provider: AIProviderId) => {
    setConfig(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        layers: {
          ...prev.layers,
          [layer]: { ...(prev.layers?.[layer] ?? {}), provider },
        },
      };
    });
    checkProviderHealth(provider, config?.customProvider);
  };

  const setLayerModel = (layer: AILayer, model: string) => {
    setConfig(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        layers: {
          ...prev.layers,
          [layer]: { ...(prev.layers?.[layer] ?? { provider: 'antigravity' }), model: model || undefined },
        },
      };
    });
  };

  const clearLayerOverrides = () => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        layers: Object.fromEntries(
          LAYERS.map((layer) => [layer, { provider: prev.defaultProvider, model: undefined }]),
        ) as AIProviderConfig['layers'],
      };
    });
  };

  const setCustomField = (field: keyof CustomProviderConfig, value: string) => {
    setCustomDraft((prev) => ({
      ...prev,
      [field]: value || undefined,
    }));
    setThirdPartyAction({ status: 'idle' });
  };

  const applyThirdPartyPreset = (presetId: ThirdPartyProviderPresetId) => {
    const preset = getThirdPartyPreset(presetId);
    setThirdPartyPreset(presetId);
    setThirdPartyTest({ status: 'idle' });
    setThirdPartyAction({ status: 'idle' });
    setCustomDraft((previous) => {
      const keepExisting = previous.vendor === presetId;
      return normalizeCustomProviderDraft({
        id: previous.id,
        vendor: presetId,
        name: keepExisting ? (previous.name ?? preset.defaultName) : preset.defaultName,
        baseUrl: keepExisting ? (previous.baseUrl ?? preset.defaultBaseUrl) : preset.defaultBaseUrl,
        apiKey: keepExisting ? previous.apiKey : '',
        defaultModel: keepExisting ? (previous.defaultModel ?? preset.defaultModel) : preset.defaultModel,
      }, previous.id || 'custom-draft');
    });
  };

  const persistConfigRequest = useCallback(async (nextConfig: AIProviderConfig) => {
    try {
      const res = await fetch('/api/ai-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextConfig),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Save failed');
      }
      setConfig(nextConfig);
      checkProviderHealth('custom', nextConfig.customProvider, nextConfig);
      checkProviderHealth(nextConfig.defaultProvider, nextConfig.customProvider, nextConfig);
      return true;
    } catch (error) {
      throw error instanceof Error ? error : new Error('Save failed');
    }
  }, [checkProviderHealth]);

  const persistConfig = useCallback(async (nextConfig: AIProviderConfig, successMessage: string) => {
    setThirdPartyAction({ status: 'saving', message: '正在保存配置…' });
    try {
      await persistConfigRequest(nextConfig);
      setThirdPartyAction({ status: 'ok', message: successMessage });
      return true;
    } catch (err) {
      setThirdPartyAction({
        status: 'error',
        message: err instanceof Error ? err.message : 'Save failed',
      });
      return false;
    }
  }, [persistConfigRequest]);

  const refreshProviderInventory = async () => {
    try {
      const res = await fetch('/api/api-keys');
      if (!res.ok) return null;
      const inventory = (await res.json()) as ProviderInventory;
      onProviderInventoryChanged?.(inventory);
      return inventory;
    } catch {
      return null;
    }
  };

  const buildFallbackConfigForProviderRemoval = useCallback((nextConfig: AIProviderConfig, removedProvider: AIProviderId): AIProviderConfig => {
    const fallbackProvider: AIProviderId = removedProvider === 'antigravity' ? 'openai-api' : 'antigravity';
    return {
      ...nextConfig,
      defaultProvider: nextConfig.defaultProvider === removedProvider ? fallbackProvider : nextConfig.defaultProvider,
      layers: Object.fromEntries(
        Object.entries(nextConfig.layers ?? {}).map(([layer, layerConfig]) => [
          layer,
          layerConfig?.provider === removedProvider
            ? { ...(layerConfig ?? {}), provider: fallbackProvider }
            : layerConfig,
        ]),
      ),
      scenes: Object.fromEntries(
        Object.entries(nextConfig.scenes ?? {}).map(([scene, sceneConfig]) => [
          scene,
          sceneConfig?.provider === removedProvider
            ? { ...(sceneConfig ?? {}), provider: fallbackProvider }
            : sceneConfig,
        ]),
      ),
    };
  }, []);

  const setConnectionAction = useCallback((connectionId: string, action: ProviderActionState) => {
    setConnectionActionState((prev) => ({ ...prev, [connectionId]: action }));
  }, []);

  const setConnectionTest = useCallback((connectionId: string, state: ThirdPartyTestState) => {
    setConnectionTestState((prev) => ({ ...prev, [connectionId]: state }));
  }, []);

  const beginCreateCustomConnection = useCallback(() => {
    const preset = getThirdPartyPreset(thirdPartyPreset);
    setAccessProvider('custom');
    setEditingCustomConnectionId(null);
    setShowThirdPartySetup(true);
    setThirdPartyTest({ status: 'idle' });
    setThirdPartyAction({ status: 'idle' });
    setCustomDraft(normalizeCustomProviderDraft({
      vendor: preset.id,
      name: preset.defaultName,
      baseUrl: preset.defaultBaseUrl,
      defaultModel: preset.defaultModel,
      apiKey: '',
    }, `custom-${Math.random().toString(36).slice(2, 10)}`));
  }, [thirdPartyPreset]);

  const beginEditCustomConnection = useCallback((connection: CustomProviderConfig) => {
    setAccessProvider('custom');
    setEditingCustomConnectionId(connection.id);
    setShowThirdPartySetup(true);
    setThirdPartyPreset((connection.vendor as ThirdPartyProviderPresetId) || inferThirdPartyPreset({ customProvider: connection } as AIProviderConfig));
    setThirdPartyTest({ status: 'idle' });
    setThirdPartyAction({ status: 'idle' });
    setCustomDraft(normalizeCustomProviderDraft(connection, connection.id));
  }, []);

  const handleSaveInlineCredential = async () => {
    const providerId = accessProvider;
    if (!providerId || !isInlineCredentialProvider(providerId)) return;
    const trimmed = inlineCredentialValue.trim();
    if (!trimmed) return;
    const credentialMeta = INLINE_CREDENTIAL_META[providerId];
    setInlineCredentialAction({ status: 'saving', message: '正在保存凭证…' });
    try {
      const body: Partial<Record<CredentialApiProvider, string>> = {
        [credentialMeta.key]: trimmed,
      };
      const res = await fetch('/api/api-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Save failed');
      }
      await refreshProviderInventory();
      checkProviderHealth(providerId, config?.customProvider);
      setInlineCredentialValue('');
      setInlineCredentialAction({ status: 'ok', message: '凭证已保存。' });
    } catch (error) {
      setInlineCredentialAction({
        status: 'error',
        message: error instanceof Error ? error.message : 'Save failed',
      });
    }
  };

  const handleTestInlineCredential = async () => {
    const providerId = accessProvider;
    if (!providerId || !isInlineCredentialProvider(providerId)) return;
    const trimmed = inlineCredentialValue.trim();
    if (!trimmed) return;
    const credentialMeta = INLINE_CREDENTIAL_META[providerId];
    setInlineCredentialTestStatus('testing');
    setInlineCredentialTestError(null);
    try {
      const res = await fetch('/api/api-keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: credentialMeta.key, apiKey: trimmed }),
      });
      const data = (await res.json()) as { status: string; error?: string };
      if (data.status === 'ok') {
        setInlineCredentialTestStatus('ok');
        return;
      }
      if (data.status === 'invalid') {
        setInlineCredentialTestStatus('invalid');
        setInlineCredentialTestError(data.error ?? 'Invalid key');
        return;
      }
      setInlineCredentialTestStatus('error');
      setInlineCredentialTestError(data.error ?? 'Test failed');
    } catch (error) {
      setInlineCredentialTestStatus('error');
      setInlineCredentialTestError(error instanceof Error ? error.message : 'Network error');
    }
  };

  const handleTestThirdParty = async () => {
    const customProvider = normalizeCustomProviderDraft({
      ...customDraft,
      id: editingCustomConnectionId ?? customDraft.id,
      vendor: thirdPartyPreset,
    }, editingCustomConnectionId ?? customDraft.id);
    if (!customProvider?.apiKey || !customProvider?.baseUrl) return;
    setThirdPartyTest({ status: 'testing', message: '正在校验连通性…' });
    try {
      const res = await fetch('/api/api-keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'custom',
          apiKey: customProvider.apiKey,
          baseUrl: customProvider.baseUrl,
        }),
      });
      const data = (await res.json()) as { status: string; error?: string };

      if (data.status === 'ok') {
        setThirdPartyTest({ status: 'ok', message: '连接成功，可以使用该接入。' });
        setProviderStatus(prev => ({ ...prev, custom: 'ok' }));
        return;
      }

      if (data.status === 'invalid') {
        setThirdPartyTest({ status: 'invalid', message: data.error ?? '401 invalid key' });
        setProviderStatus(prev => ({ ...prev, custom: 'error' }));
        return;
      }

      setThirdPartyTest({ status: 'error', message: data.error ?? 'network unreachable' });
      setProviderStatus(prev => ({ ...prev, custom: 'error' }));
    } catch (error) {
      setThirdPartyTest({
        status: 'error',
        message: error instanceof Error ? error.message : 'network unreachable',
      });
      setProviderStatus(prev => ({ ...prev, custom: 'error' }));
    }
  };

  const handleSaveThirdPartyProfile = async () => {
    if (!config) return;
    const nextConnection = normalizeCustomProviderDraft({
      ...customDraft,
      id: editingCustomConnectionId ?? customDraft.id,
      vendor: thirdPartyPreset,
    }, editingCustomConnectionId ?? customDraft.id);
    const existingConnections = config.customProviders ?? [];
    const nextConnections = existingConnections.some((connection) => connection.id === nextConnection.id)
      ? existingConnections.map((connection) => (connection.id === nextConnection.id ? nextConnection : connection))
      : [...existingConnections, nextConnection];
    const nextConfig = applyCustomConnectionsToConfig(config, nextConnections, nextConnection.id);
    const savedOk = await persistConfig(nextConfig, editingCustomConnectionId ? 'AI 接入已更新。' : 'AI 接入已添加。');
    if (savedOk) {
      setEditingCustomConnectionId(nextConnection.id);
      setCustomDraft(nextConnection);
    }
  };

  const handleRetestSavedConnection = async (connection: ProviderConnectionSummary) => {
    const connectionId = connection.id;
    const requestBody = connection.provider === 'custom'
      ? { provider: 'custom', connectionId, useStored: true }
      : connection.provider === 'claude-api'
        ? { provider: 'claude-api', useStored: true }
        : connection.provider === 'openai-api'
          ? { provider: 'openai-api', useStored: true }
          : connection.provider === 'gemini-api'
            ? { provider: 'gemini-api', useStored: true }
            : connection.provider === 'grok-api'
              ? { provider: 'grok-api', useStored: true }
              : null;

    if (!requestBody) {
      return;
    }

    setConnectionTest(connectionId, { status: 'testing', message: '正在校验连通性…' });
    try {
      const res = await fetch('/api/api-keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = (await res.json()) as { status: string; error?: string };
      if (data.status === 'ok') {
        setConnectionTest(connectionId, { status: 'ok', message: '连接正常。' });
        return;
      }
      if (data.status === 'invalid') {
        setConnectionTest(connectionId, { status: 'invalid', message: data.error ?? '凭证无效。' });
        return;
      }
      setConnectionTest(connectionId, { status: 'error', message: data.error ?? '连接失败。' });
    } catch (error) {
      setConnectionTest(connectionId, {
        status: 'error',
        message: error instanceof Error ? error.message : '连接失败。',
      });
    }
  };

  const handleDeleteInlineCredential = async (providerId: InlineCredentialProviderId) => {
    if (!config) return;
    const credentialMeta = INLINE_CREDENTIAL_META[providerId];
    setConnectionAction(providerId, { status: 'saving', message: '正在移除接入…' });
    try {
      const res = await fetch('/api/api-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [credentialMeta.key]: '' }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Remove failed');
      }
      await refreshProviderInventory();
      const nextConfig = buildFallbackConfigForProviderRemoval(config, providerId);
      await persistConfigRequest(nextConfig);
      setConnectionAction(providerId, { status: 'ok', message: '接入已移除。' });
      if (accessProvider === providerId) {
        setInlineCredentialValue('');
      }
    } catch (error) {
      setConnectionAction(providerId, {
        status: 'error',
        message: error instanceof Error ? error.message : 'Remove failed',
      });
    }
  };

  const handleDeleteCustomConnection = async (connectionId: string) => {
    if (!config) return;
    setConnectionAction(connectionId, { status: 'saving', message: '正在移除接入…' });
    try {
      const nextConnections = (config.customProviders ?? []).filter((connection) => connection.id !== connectionId);
      let nextConfig = applyCustomConnectionsToConfig(config, nextConnections, config.activeCustomProviderId === connectionId ? nextConnections[0]?.id : config.activeCustomProviderId);
      if (!nextConfig.customProvider) {
        nextConfig = buildFallbackConfigForProviderRemoval(nextConfig, 'custom');
      }
      await persistConfigRequest(nextConfig);
      setConnectionAction(connectionId, { status: 'ok', message: '接入已移除。' });
      if (editingCustomConnectionId === connectionId) {
        setEditingCustomConnectionId(nextConfig.activeCustomProviderId ?? null);
        setCustomDraft(normalizeCustomProviderDraft(nextConfig.customProvider, 'custom-draft'));
      }
    } catch (error) {
      setConnectionAction(connectionId, {
        status: 'error',
        message: error instanceof Error ? error.message : 'Remove failed',
      });
    }
  };

  const handleActivateCustomConnection = async (connectionId: string) => {
    if (!config) return;
    setConnectionAction(connectionId, { status: 'saving', message: '正在切换当前接入…' });
    try {
      const nextConfig = applyCustomConnectionsToConfig(config, config.customProviders ?? [], connectionId);
      await persistConfigRequest(nextConfig);
      setConnectionAction(connectionId, { status: 'ok', message: '已设为当前兼容接入。' });
    } catch (error) {
      setConnectionAction(connectionId, {
        status: 'error',
        message: error instanceof Error ? error.message : 'Switch failed',
      });
    }
  };

  const handleSetNativeConnectionEnabled = async (providerId: AIProviderId, enabled: boolean) => {
    if (!config) return;
    setConnectionAction(providerId, { status: 'saving', message: enabled ? '正在恢复接入…' : '正在移除接入…' });
    try {
      const nextConfig = enabled
        ? {
            ...config,
            providerProfiles: {
              ...(config.providerProfiles ?? {}),
              [providerId]: {
                ...(config.providerProfiles?.[providerId] ?? {}),
                enabled: true,
              },
            },
          }
        : buildFallbackConfigForProviderRemoval({
            ...config,
            providerProfiles: {
              ...(config.providerProfiles ?? {}),
              [providerId]: {
                ...(config.providerProfiles?.[providerId] ?? {}),
                enabled: false,
              },
            },
          }, providerId);
      await persistConfigRequest(nextConfig);
      setConnectionAction(providerId, { status: 'ok', message: enabled ? '接入已恢复。' : '接入已移除。' });
    } catch (error) {
      setConnectionAction(providerId, {
        status: 'error',
        message: error instanceof Error ? error.message : 'Update failed',
      });
    }
  };

  const handleTestImageGeneration = async () => {
    if (!config || !imageCapableProviders.includes(imageProvider)) return;

    setImageTest({ status: 'testing', message: '正在生成测试图像…' });
    try {
      const res = await fetch('/api/provider-image-generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: imageProvider,
          prompt: imagePrompt,
          size: '512x512',
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        dataUrl?: string;
        provider?: AIProviderId;
        model?: string;
        fallbackProvider?: AIProviderId;
      };
      if (!res.ok || !data.dataUrl) {
        throw new Error(data.error || '图像生成失败');
      }
      setImageTest({
        status: 'ok',
        message: data.fallbackProvider
          ? `已生成测试图像，回退到 ${PROVIDER_LABELS[data.fallbackProvider] ?? data.fallbackProvider}`
          : '已生成测试图像',
        dataUrl: data.dataUrl,
        provider: data.provider,
        model: data.model,
        fallbackProvider: data.fallbackProvider,
      });
    } catch (error) {
      setImageTest({
        status: 'error',
        message: error instanceof Error ? error.message : '图像生成失败',
      });
    }
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const res = await fetch('/api/ai-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Save failed');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      checkProviderHealth(config.defaultProvider, config.customProvider);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-[var(--app-text-soft)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading config…
      </div>
    );
  }

  const customProvider = config.customProvider;
  const customProviderReady = isCustomProviderConfigured(customProvider);
  const customDraftReady = isCustomProviderConfigured(customDraft);
  const customProviderConnected = thirdPartyTest.status === 'ok' || providerStatus.custom === 'ok';
  const customConnections = config.customProviders ?? [];
  const readyCustomConnections = customConnections.filter((connection) => isCustomProviderConfigured(connection));
  const incompleteCustomConnections = customConnections.filter((connection) => !isCustomProviderConfigured(connection));
  const layerOverrideCount = LAYERS.filter((layer) => {
    const layerConfig = config.layers?.[layer];
    return Boolean(layerConfig?.model) || (layerConfig?.provider && layerConfig.provider !== config.defaultProvider);
  }).length;
  const defaultProviderAvailable = isProviderAvailable(config.defaultProvider, providerInventory, config.customProvider, config);
  const imageGenerationEnabled = getImageGenerationEnabled(imageProvider);
  const inlineCredentialMeta = accessProvider !== 'custom' && isInlineCredentialProvider(accessProvider)
    ? INLINE_CREDENTIAL_META[accessProvider]
    : null;
  const inlineCredentialConfigured = inlineCredentialMeta
    ? getInventoryKeyStatus(providerInventory, inlineCredentialMeta.key)
    : false;
  const configuredApiProviderEntries: ProviderConnectionSummary[] = AI_ACCESS_PROVIDER_OPTIONS
    .filter((option): option is { value: InlineCredentialProviderId; label: string } => option.value !== 'custom')
    .filter((option) => getInventoryKeyStatus(providerInventory, INLINE_CREDENTIAL_META[option.value].key))
    .map((option) => ({
      kind: 'provider' as const,
      id: option.value,
      provider: option.value,
      label: option.label,
      detail: '已保存 API 凭证',
      statusLabel: '已接入',
      tone: 'success',
      removable: true,
      editable: true,
      testable: true,
    }));
  const connectedNativeEntries = [
    providerInventory?.providers.nativeCodex.loggedIn
      ? {
          kind: 'provider' as const,
          id: 'native-codex',
          provider: 'native-codex',
          label: 'Codex Native (OAuth)',
          detail: '复用本机 Codex 登录态',
          statusLabel: config.providerProfiles?.['native-codex']?.enabled === false ? '已移除' : '已接入',
          tone: config.providerProfiles?.['native-codex']?.enabled === false ? 'neutral' : 'success',
          removable: config.providerProfiles?.['native-codex']?.enabled !== false,
          restorable: config.providerProfiles?.['native-codex']?.enabled === false,
        }
      : null,
  ].filter(Boolean) as ProviderConnectionSummary[];
  const connectedExecutionToolEntries = [
    providerInventory?.providers.codex.installed
      ? {
          kind: 'execution-tool' as const,
          id: 'codex',
          provider: 'codex',
          label: 'Codex CLI',
          detail: '检测到本机 codex CLI，可作为执行工具被调用',
          statusLabel: '可调用',
          tone: 'info' as const,
        }
      : null,
    providerInventory?.providers.claudeCode.installed && providerInventory?.providers.claudeCode.loginDetected
      ? {
          kind: 'execution-tool' as const,
          id: 'claude-code',
          provider: 'claude-code',
          label: 'Claude Code CLI',
          detail: '检测到本机 Claude Code 登录态，可作为执行工具被调用',
          statusLabel: '可调用',
          tone: 'info' as const,
        }
      : null,
  ].filter(Boolean) as ProviderConnectionSummary[];
  const configuredCustomEntries: ProviderConnectionSummary[] = readyCustomConnections.map((connection) => ({
    kind: 'provider',
    id: connection.id,
    provider: 'custom',
    label: connection.name || '自定义服务',
    detail: [connection.baseUrl, connection.defaultModel].filter(Boolean).join(' · ') || '兼容 OpenAI 的第三方接入',
    statusLabel: connection.id === config.activeCustomProviderId ? '当前接入' : '已接入',
    tone: connection.id === config.activeCustomProviderId ? 'info' : 'success',
    removable: true,
    editable: true,
    testable: true,
    active: connection.id === config.activeCustomProviderId,
  }));
  const incompleteCustomEntries: ProviderConnectionSummary[] = incompleteCustomConnections.map((connection) => ({
    kind: 'provider',
    id: connection.id,
    provider: 'custom',
    label: connection.name || '未完成的兼容接入',
    detail: '缺少地址、密钥或名称，暂时不能参与默认配置。',
    statusLabel: '待完成',
    tone: 'warning',
    removable: true,
    editable: true,
  }));
  const configuredAccessEntries = [
    ...connectedNativeEntries.filter((entry) => !entry.restorable),
    ...configuredApiProviderEntries,
    ...configuredCustomEntries,
  ];
  const hiddenNativeEntries = connectedNativeEntries.filter((entry) => entry.restorable);
  const configuredAccessProviders = configuredAccessEntries.map((entry) => entry.label);
  const visibleAccessEntries = [...configuredAccessEntries, ...incompleteCustomEntries];
  const thirdPartyStatusTone: WorkspacePrimitiveTone = customDraftReady
    ? (customProviderConnected ? 'success' : 'info')
    : 'neutral';
  const thirdPartyStatusLabel = customDraftReady
    ? (customProviderConnected ? '已连接' : '已填写')
    : '未配置';
  const accessStatusTone: WorkspacePrimitiveTone = accessProvider === 'custom'
    ? thirdPartyStatusTone
    : (inlineCredentialConfigured ? 'success' : 'neutral');
  const accessStatusLabel = accessProvider === 'custom'
    ? thirdPartyStatusLabel
    : (inlineCredentialConfigured ? '已配置' : '未配置');

  const StatusDot = ({ providerId }: { providerId: string }) => {
    const status = providerStatus[providerId];
    if (!status || status === 'unknown') return null;
    if (status === 'checking') return <Loader2 className="h-3 w-3 animate-spin text-[var(--app-text-muted)]" />;
    if (status === 'ok') return <div className="h-2 w-2 rounded-full bg-emerald-400" title="已连接" />;
    return <div className="h-2 w-2 rounded-full bg-red-400" title="未配置或连接失败" />;
  };

  return (
    <div className="space-y-5">
      <Card ref={thirdPartySectionRef}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <SectionTitle icon={<Globe className="h-4 w-4" />}>AI 接入</SectionTitle>
            <div className="text-xs leading-6 text-[var(--app-text-soft)]">
              先把需要使用的模型服务接进来，再到下方选择默认使用哪一个。
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WorkspaceBadge tone={configuredAccessEntries.length ? 'success' : 'neutral'}>
              {configuredAccessProviders.length ? `已接入 ${configuredAccessProviders.length} 个` : '未添加'}
            </WorkspaceBadge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setShowThirdPartySetup((value) => !value || configuredAccessEntries.length === 0);
                if (!showThirdPartySetup && accessProvider === 'custom' && !editingCustomConnectionId && !customDraftReady) {
                  beginCreateCustomConnection();
                }
              }}
              className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
            >
              {showThirdPartySetup ? '收起接入' : configuredAccessProviders.length ? '管理接入' : '添加接入'}
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {visibleAccessEntries.length ? (
            <div className="space-y-3">
              {visibleAccessEntries.map((entry) => {
                const actionState = connectionActionState[entry.id];
                const testState = connectionTestState[entry.id];
                return (
                  <div key={entry.id} className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-[var(--app-text)]">{entry.label}</div>
                          <WorkspaceBadge tone={entry.tone}>{entry.statusLabel}</WorkspaceBadge>
                        </div>
                        {entry.detail ? (
                          <div className="mt-1 text-xs leading-6 text-[var(--app-text-soft)]">{entry.detail}</div>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {entry.provider === 'custom' && !entry.active ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
                            onClick={() => void handleActivateCustomConnection(entry.id)}
                          >
                            设为当前
                          </Button>
                        ) : null}
                        {entry.editable ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
                            onClick={() => {
                              if (entry.provider === 'custom') {
                                const connection = customConnections.find((item) => item.id === entry.id);
                                if (connection) {
                                  beginEditCustomConnection(connection);
                                }
                              } else if (isInlineCredentialProvider(entry.provider)) {
                                setAccessProvider(entry.provider);
                                setShowThirdPartySetup(true);
                                setInlineCredentialValue('');
                                setInlineCredentialAction({ status: 'idle' });
                                setInlineCredentialTestStatus('idle');
                                setInlineCredentialTestError(null);
                              }
                            }}
                          >
                            编辑
                          </Button>
                        ) : null}
                        {entry.testable ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
                            onClick={() => void handleRetestSavedConnection(entry)}
                          >
                            复测
                          </Button>
                        ) : null}
                        {entry.provider === 'custom' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
                            onClick={() => void handleDeleteCustomConnection(entry.id)}
                          >
                            删除
                          </Button>
                        ) : null}
                        {isInlineCredentialProvider(entry.provider) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
                            onClick={() => void handleDeleteInlineCredential(entry.provider as InlineCredentialProviderId)}
                          >
                            删除
                          </Button>
                        ) : null}
                        {entry.kind === 'provider' && entry.provider === 'native-codex' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
                            onClick={() => void handleSetNativeConnectionEnabled('native-codex', false)}
                          >
                            移除
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {actionState && actionState.status !== 'idle' ? (
                      <div
                        className={cn(
                          'mt-3 flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs',
                          actionState.status === 'ok' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
                          actionState.status === 'error' && 'border-red-500/20 bg-red-500/10 text-red-300',
                          actionState.status === 'saving' && 'border-[var(--app-border-soft)] bg-[var(--app-surface)] text-[var(--app-text-soft)]',
                        )}
                      >
                        {actionState.status === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : null}
                        {actionState.status === 'error' ? <XCircle className="h-3.5 w-3.5 shrink-0" /> : null}
                        {actionState.status === 'saving' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
                        <span>{actionState.message}</span>
                      </div>
                    ) : null}

                    {testState && testState.status !== 'idle' ? (
                      <div
                        className={cn(
                          'mt-3 flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs',
                          testState.status === 'ok' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
                          testState.status === 'invalid' && 'border-red-500/20 bg-red-500/10 text-red-300',
                          testState.status === 'error' && 'border-amber-500/20 bg-amber-500/10 text-amber-300',
                          testState.status === 'testing' && 'border-[var(--app-border-soft)] bg-[var(--app-surface)] text-[var(--app-text-soft)]',
                        )}
                      >
                        {testState.status === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : null}
                        {testState.status === 'invalid' ? <XCircle className="h-3.5 w-3.5 shrink-0" /> : null}
                        {testState.status === 'error' ? <AlertCircle className="h-3.5 w-3.5 shrink-0" /> : null}
                        {testState.status === 'testing' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
                        <span>{testState.message}</span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <WorkspaceEmptyBlock
              title="还没有 AI 接入"
              description="先添加一个 API Provider，或使用已检测到的本机 Provider。"
            />
          )}

          {hiddenNativeEntries.length > 0 ? (
            <div className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
              <div className="text-sm font-semibold text-[var(--app-text)]">可恢复的本机 Provider</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {hiddenNativeEntries.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2 rounded-full border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-2 text-xs">
                    <span className="text-[var(--app-text)]">{entry.label}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={cn('h-7 rounded-full px-3 text-[11px]', workspaceOutlineActionClassName)}
                      onClick={() => void handleSetNativeConnectionEnabled('native-codex', true)}
                    >
                      恢复
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {connectedExecutionToolEntries.length > 0 ? (
            <div className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
              <div className="text-sm font-semibold text-[var(--app-text)]">本机执行工具</div>
              <div className="mt-1 text-xs leading-6 text-[var(--app-text-soft)]">
                这些 CLI 不是 Provider，不参与默认 Provider、按层覆盖或 Scene 覆盖选择；它们只会在运行时被 Claude Engine 当作执行工具调用。
              </div>
              <div className="mt-3 space-y-2">
                {connectedExecutionToolEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[var(--app-text)]">{entry.label}</span>
                        <WorkspaceBadge tone={entry.tone}>{entry.statusLabel}</WorkspaceBadge>
                      </div>
                      {entry.detail ? (
                        <div className="mt-1 text-xs text-[var(--app-text-soft)]">{entry.detail}</div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {(providerInventory?.providers.nativeCodex.installed && !providerInventory?.providers.nativeCodex.loggedIn)
            || (providerInventory?.providers.claudeCode.installed && !providerInventory?.providers.claudeCode.loginDetected) ? (
            <div className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4 text-xs leading-6 text-[var(--app-text-soft)]">
              {providerInventory?.providers.nativeCodex.installed && !providerInventory?.providers.nativeCodex.loggedIn ? (
                <div>Codex Native 已安装但未登录。先在终端完成 Codex 登录，随后会自动出现在已接入列表。</div>
              ) : null}
              {providerInventory?.providers.claudeCode.installed && !providerInventory?.providers.claudeCode.loginDetected ? (
                <div>Claude Code 已安装但未登录。先在本机完成 Claude Code 登录，随后会自动出现在已接入列表。</div>
              ) : null}
            </div>
          ) : null}
        </div>

        {showThirdPartySetup ? (
          <div className="mt-4 space-y-4 border-t border-[var(--app-border-soft)] pt-4">
            <div className="flex flex-wrap gap-2">
              {AI_ACCESS_PROVIDER_OPTIONS.map((option) => {
                const active = option.value === accessProvider;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      'inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs transition-colors',
                      active
                        ? 'border-sky-400/35 bg-sky-400/[0.08] text-sky-700'
                        : 'border-[var(--app-border-soft)] bg-[var(--app-surface)] text-[var(--app-text-soft)] hover:bg-[var(--app-raised)]',
                    )}
                    onClick={() => setAccessProvider(option.value)}
                  >
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-3 rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-[var(--app-text)]">
                    {AI_ACCESS_PROVIDER_OPTIONS.find((option) => option.value === accessProvider)?.label ?? 'AI 接入'}
                  </div>
                  <div className="mt-1 text-xs leading-6 text-[var(--app-text-soft)]">
                    {accessProvider === 'custom'
                      ? '填写端点、密钥和默认模型，保存后即可作为一个可用接入。'
                      : inlineCredentialMeta?.summary}
                  </div>
                </div>
                <WorkspaceBadge tone={accessStatusTone}>{accessStatusLabel}</WorkspaceBadge>
              </div>

              {accessProvider === 'custom' ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-[var(--app-text-soft)]">
                      {editingCustomConnectionId ? '正在编辑已保存接入。' : '你可以保存多个兼容接入，并选择其中一个作为当前接入。'}
                    </div>
                    {customConnections.length > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
                        onClick={beginCreateCustomConnection}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        新建接入
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {THIRD_PARTY_PRESETS.map((preset) => {
                      const active = preset.id === thirdPartyPreset;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={cn(
                            'inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs transition-colors',
                            active
                              ? 'border-sky-400/35 bg-sky-400/[0.08] text-sky-700'
                              : 'border-[var(--app-border-soft)] bg-[var(--app-surface)] text-[var(--app-text-soft)] hover:bg-[var(--app-raised)]',
                          )}
                          onClick={() => applyThirdPartyPreset(preset.id)}
                        >
                          {preset.icon}
                          <span>{preset.title}</span>
                        </button>
                      );
                    })}
                  </div>

                  <FieldRow label="显示名称">
                    <Input
                      value={customDraft.name ?? ''}
                      onChange={(e) => setCustomField('name', e.target.value)}
                      placeholder={selectedPreset.defaultName}
                      className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
                    />
                  </FieldRow>
                  <FieldRow label="API Base URL">
                    <Input
                      value={customDraft.baseUrl ?? ''}
                      onChange={(e) => setCustomField('baseUrl', e.target.value)}
                      placeholder={selectedPreset.endpointHint}
                      className={cn('h-9 rounded-lg font-mono text-xs', workspaceFieldClassName)}
                    />
                  </FieldRow>
                  <FieldRow label="API Key">
                    <Input
                      type="password"
                      value={customDraft.apiKey ?? ''}
                      onChange={(e) => setCustomField('apiKey', e.target.value)}
                      placeholder="sk-..."
                      className={cn('h-9 rounded-lg font-mono text-xs', workspaceFieldClassName)}
                    />
                  </FieldRow>
                  <FieldRow label="默认模型">
                    <ProviderModelInput
                      provider="custom"
                      value={customDraft.defaultModel ?? ''}
                      onChange={(value) => setCustomField('defaultModel', value)}
                      customProvider={customDraft}
                      placeholder={selectedPreset.modelHint}
                      showHelperText
                    />
                  </FieldRow>
                  <div className="text-[11px] leading-5 text-[var(--app-text-soft)]">
                    {selectedPreset.deployment} · {selectedPreset.notes}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleTestThirdParty}
                      disabled={!customDraft.apiKey || !customDraft.baseUrl || thirdPartyTest.status === 'testing'}
                      className={cn('text-xs', workspaceOutlineActionClassName)}
                    >
                      {thirdPartyTest.status === 'testing' ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Activity className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      测试连接
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveThirdPartyProfile}
                      disabled={!customDraftReady || thirdPartyAction.status === 'saving'}
                      className="bg-sky-500 text-white hover:bg-sky-400"
                    >
                      {thirdPartyAction.status === 'saving' ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CircleCheck className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {editingCustomConnectionId ? '保存修改' : '保存接入'}
                    </Button>
                  </div>

                  {thirdPartyTest.status !== 'idle' ? (
                    <div
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs',
                        thirdPartyTest.status === 'ok' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
                        thirdPartyTest.status === 'invalid' && 'border-red-500/20 bg-red-500/10 text-red-300',
                        thirdPartyTest.status === 'error' && 'border-amber-500/20 bg-amber-500/10 text-amber-300',
                        thirdPartyTest.status === 'testing' && 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-soft)]',
                      )}
                    >
                      {thirdPartyTest.status === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : null}
                      {thirdPartyTest.status === 'invalid' ? <XCircle className="h-3.5 w-3.5 shrink-0" /> : null}
                      {thirdPartyTest.status === 'error' ? <AlertCircle className="h-3.5 w-3.5 shrink-0" /> : null}
                      {thirdPartyTest.status === 'testing' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
                      <span>{thirdPartyTest.message}</span>
                    </div>
                  ) : null}

                  {thirdPartyAction.status !== 'idle' ? (
                    <div
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs',
                        thirdPartyAction.status === 'ok' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
                        thirdPartyAction.status === 'error' && 'border-red-500/20 bg-red-500/10 text-red-300',
                        thirdPartyAction.status === 'saving' && 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-soft)]',
                      )}
                    >
                      {thirdPartyAction.status === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : null}
                      {thirdPartyAction.status === 'error' ? <XCircle className="h-3.5 w-3.5 shrink-0" /> : null}
                      {thirdPartyAction.status === 'saving' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
                      <span>{thirdPartyAction.message}</span>
                    </div>
                  ) : null}
                </>
              ) : inlineCredentialMeta ? (
                <>
                  <div className="text-xs leading-6 text-[var(--app-text-soft)]">
                    {inlineCredentialConfigured ? '当前已保存凭证。你可以直接复测，也可以输入新 key 替换。' : '保存后会进入已接入列表。'}
                  </div>
                  <FieldRow label={inlineCredentialMeta.title}>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showInlineCredentialValue ? 'text' : 'password'}
                          value={inlineCredentialValue}
                          onChange={(event) => {
                            setInlineCredentialValue(event.target.value);
                            setInlineCredentialAction({ status: 'idle' });
                            setInlineCredentialTestStatus('idle');
                            setInlineCredentialTestError(null);
                          }}
                          placeholder={inlineCredentialConfigured ? '输入新 key 以替换' : inlineCredentialMeta.placeholder}
                          className={cn('h-9 rounded-lg pr-9 text-xs', workspaceFieldClassName)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowInlineCredentialValue((value) => !value)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--app-text-muted)] transition-colors hover:text-[var(--app-text-soft)]"
                        >
                          {showInlineCredentialValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleTestInlineCredential}
                        disabled={!inlineCredentialValue.trim() || inlineCredentialTestStatus === 'testing'}
                        className={cn('shrink-0 text-xs', workspaceOutlineActionClassName)}
                      >
                        {inlineCredentialTestStatus === 'testing' ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Activity className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        测试连接
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveInlineCredential}
                        disabled={!inlineCredentialValue.trim() || inlineCredentialAction.status === 'saving'}
                        className="bg-sky-500 text-white hover:bg-sky-400"
                      >
                        {inlineCredentialAction.status === 'saving' ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CircleCheck className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        保存接入
                      </Button>
                    </div>
                  </FieldRow>

                  {inlineCredentialTestStatus === 'ok' ? (
                    <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      连接成功，凭证有效。
                    </div>
                  ) : null}
                  {inlineCredentialTestStatus === 'invalid' ? (
                    <div className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                      <XCircle className="h-3.5 w-3.5 shrink-0" />
                      {inlineCredentialTestError ?? '凭证无效'}
                    </div>
                  ) : null}
                  {inlineCredentialTestStatus === 'error' ? (
                    <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      {inlineCredentialTestError ?? '测试失败'}
                    </div>
                  ) : null}
                  {inlineCredentialAction.status !== 'idle' ? (
                    <div
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs',
                        inlineCredentialAction.status === 'ok' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
                        inlineCredentialAction.status === 'error' && 'border-red-500/20 bg-red-500/10 text-red-300',
                        inlineCredentialAction.status === 'saving' && 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-soft)]',
                      )}
                    >
                      {inlineCredentialAction.status === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : null}
                      {inlineCredentialAction.status === 'error' ? <XCircle className="h-3.5 w-3.5 shrink-0" /> : null}
                      {inlineCredentialAction.status === 'saving' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
                      <span>{inlineCredentialAction.message}</span>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <SectionTitle icon={<Layers className="h-4 w-4" />}>默认配置</SectionTitle>
            <div className="text-xs leading-6 text-[var(--app-text-soft)]">
              选择默认使用的 Provider 和模型。图像生成、按层覆盖等进阶能力放在同一块高级设置里。
            </div>
          </div>
          <WorkspaceBadge tone={defaultProviderAvailable ? 'success' : 'warning'}>
            {defaultProviderAvailable ? '已就绪' : '待处理'}
          </WorkspaceBadge>
        </div>

        <div className="mt-4 space-y-4">
          <div className="grid gap-3 rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-4 md:grid-cols-2">
            <FieldRow label="默认 Provider">
              <ProviderSelect
                value={config.defaultProvider}
                onChange={setDefaultProvider}
                providerInventory={providerInventory}
                config={config}
                customProvider={config.customProvider}
                configuredOnly
              />
            </FieldRow>
            <FieldRow label="默认模型">
              <ProviderModelInput
                provider={config.defaultProvider}
                value={config.defaultModel ?? ''}
                onChange={setDefaultModel}
                customProvider={config.customProvider}
                placeholder="留空使用 provider 默认"
              />
            </FieldRow>
          </div>

          {!isProviderAvailable(config.defaultProvider, providerInventory, config.customProvider, config) ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700">
              当前 Provider <code className="font-mono text-amber-800">{PROVIDER_LABELS[config.defaultProvider]}</code> 还未完成接入。先保存凭证或补齐端点信息，再保存默认 Provider 选择。
            </div>
          ) : null}

          {config.defaultProvider === 'custom' ? (
            <div className="rounded-lg border border-sky-400/15 bg-sky-400/[0.08] px-4 py-3 text-xs text-sky-700">
              当前默认 Provider 使用上方的 AI 接入；请先在 `AI 接入` 中保存地址、密钥和默认模型。
            </div>
          ) : null}

          {!isInlineCredentialProvider(config.defaultProvider) && config.defaultProvider !== 'custom' ? (
            <div className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3 text-xs leading-6 text-[var(--app-text-soft)]">
              {config.defaultProvider === 'antigravity' && 'Antigravity 使用内置 runtime，不需要额外凭证。'}
              {config.defaultProvider === 'native-codex' && 'Codex Native 使用本机 OAuth 登录态，不需要额外 API Key。'}
            </div>
          ) : null}

          <div className="space-y-4 rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--app-text)]">高级设置</div>
                <div className="mt-1 text-xs text-[var(--app-text-soft)]">图像生成和按层覆盖通常只在需要时调整。</div>
              </div>
              <div className="flex items-center gap-2">
                <WorkspaceBadge tone={layerOverrideCount || imageGenerationEnabled ? 'info' : 'neutral'}>
                  {layerOverrideCount || imageGenerationEnabled ? '已启用' : '默认'}
                </WorkspaceBadge>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowAdvancedConfig((value) => !value)}
                  className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
                >
                  {showAdvancedConfig ? '收起' : '展开'}
                </Button>
              </div>
            </div>

            <div className="grid gap-3 rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4 md:grid-cols-2">
              <div className="min-w-0">
                <div className="text-[11px] text-[var(--app-text-muted)]">图像生成</div>
                <div className="mt-1 truncate text-sm font-medium text-[var(--app-text)]">
                  {imageGenerationEnabled
                    ? `${PROVIDER_LABELS[imageProvider] ?? imageProvider}${getImageGenerationModel(imageProvider) ? ` · ${getImageGenerationModel(imageProvider)}` : ''}`
                    : '未启用'}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[11px] text-[var(--app-text-muted)]">按层覆盖</div>
                <div className="mt-1 truncate text-sm font-medium text-[var(--app-text)]">
                  {layerOverrideCount ? `${layerOverrideCount} 层已覆盖` : '未设置覆盖'}
                </div>
              </div>
            </div>

            {showAdvancedConfig ? (
              <div className="space-y-5 border-t border-[var(--app-border-soft)] pt-4">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--app-text)]">图像生成</div>
                      <div className="mt-1 text-xs text-[var(--app-text-soft)]">只在需要调用生图时才调整这里。</div>
                    </div>
                    <WorkspaceBadge tone={imageGenerationEnabled ? 'success' : 'neutral'}>
                      {imageGenerationEnabled ? '已启用' : '未启用'}
                    </WorkspaceBadge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <FieldRow label="图像 Provider">
                      <ProviderSelect
                        value={imageProvider}
                        onChange={(provider) => setImageProvider(provider)}
                        providerInventory={providerInventory}
                        config={config}
                        customProvider={config.customProvider}
                        allowedProviders={imageCapableProviders}
                        configuredOnly
                      />
                    </FieldRow>
                    <FieldRow label="图像 Model">
                      <ProviderModelInput
                        provider={imageProvider}
                        value={getImageGenerationModel(imageProvider)}
                        onChange={(value) => setImageGenerationModel(imageProvider, value)}
                        customProvider={config.customProvider}
                        placeholder="例如 gpt-image-1"
                        capability="image-generation"
                      />
                    </FieldRow>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
                      onClick={() => setImageGenerationEnabled(imageProvider, !imageGenerationEnabled)}
                    >
                      {imageGenerationEnabled ? '停用图像生成' : '启用图像生成'}
                    </Button>
                    {imageGenerationEnabled ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
                        onClick={() => setShowImageTools((value) => !value)}
                      >
                        {showImageTools ? '收起测试' : '展开测试'}
                      </Button>
                    ) : null}
                    {imageProvider === 'custom' && !customProviderReady ? (
                      <span className="text-xs text-[var(--app-text-soft)]">自定义端点未配置时无法用于图像生成。</span>
                    ) : null}
                  </div>

                  {imageGenerationEnabled && showImageTools ? (
                    <div className="space-y-3 rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
                      <FieldRow label="测试提示词">
                        <Input
                          value={imagePrompt}
                          onChange={(event) => setImagePrompt(event.target.value)}
                          className={workspaceFieldClassName}
                          placeholder="输入一个简单的测试提示词"
                        />
                      </FieldRow>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
                          disabled={
                            imageTest.status === 'testing'
                            || !imageGenerationEnabled
                            || (imageProvider === 'custom' && !customProviderReady)
                          }
                          onClick={handleTestImageGeneration}
                        >
                          {imageTest.status === 'testing' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-2 h-3.5 w-3.5" />}
                          测试图像生成
                        </Button>
                      </div>

                      {imageTest.status !== 'idle' ? (
                        <div
                          className={cn(
                            'rounded-xl border px-3 py-3 text-xs',
                            imageTest.status === 'ok'
                              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                              : imageTest.status === 'testing'
                                ? 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-soft)]'
                                : 'border-red-500/20 bg-red-500/10 text-red-300',
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {imageTest.status === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : null}
                            {imageTest.status === 'error' ? <AlertCircle className="h-3.5 w-3.5 shrink-0" /> : null}
                            {imageTest.status === 'testing' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
                            <span>{imageTest.message}</span>
                          </div>
                          {imageTest.dataUrl ? (
                            <div className="mt-3 flex items-start gap-3">
                              <Image
                                src={imageTest.dataUrl}
                                alt="Provider image preview"
                                width={96}
                                height={96}
                                unoptimized
                                className="h-24 w-24 rounded-[12px] border border-white/10 bg-white object-cover"
                              />
                              <div className="space-y-1 text-[11px] leading-5 text-[currentColor]">
                                <div>Provider: {PROVIDER_LABELS[imageTest.provider || imageProvider] ?? imageTest.provider ?? imageProvider}</div>
                                <div>Model: {imageTest.model || 'unknown'}</div>
                                {imageTest.fallbackProvider ? (
                                  <div>Fallback: {PROVIDER_LABELS[imageTest.fallbackProvider] ?? imageTest.fallbackProvider}</div>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-4 border-t border-[var(--app-border-soft)] pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--app-text)]">按层覆盖</div>
                      <div className="mt-1 text-xs text-[var(--app-text-soft)]">只有确实要让 Executive / Execution 分层使用不同模型时才展开。</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {layerOverrideCount ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={clearLayerOverrides}
                          className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
                        >
                          清除覆盖
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setShowLayerConfig((value) => !value)}
                        className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
                      >
                        {showLayerConfig ? '收起覆盖项' : `展开覆盖项${layerOverrideCount ? ` · ${layerOverrideCount}` : ''}`}
                      </Button>
                    </div>
                  </div>
                  {showLayerConfig ? (
                    <div className="space-y-3">
                      {LAYERS.map((layer) => {
                        const layerProvider = getLayerProvider(layer);
                        const layerProviderAvailable = isProviderAvailable(layerProvider, providerInventory, config.customProvider, config);
                        return (
                          <div key={layer} className="space-y-2 rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-3">
                            <div className="flex items-center gap-2">
                              <div className="text-[10px] font-semibold uppercase tracking-widest text-sky-400/70">
                                {LAYER_LABELS[layer]}
                              </div>
                              <StatusDot providerId={layerProvider} />
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <FieldRow label="Provider">
                                <ProviderSelect
                                  value={layerProvider}
                                  onChange={(v) => setLayerProvider(layer, v)}
                                  providerInventory={providerInventory}
                                  config={config}
                                  customProvider={config.customProvider}
                                  configuredOnly
                                />
                              </FieldRow>
                              <FieldRow label="模型">
                                <ProviderModelInput
                                  provider={layerProvider}
                                  value={getLayerModel(layer)}
                                  onChange={(value) => setLayerModel(layer, value)}
                                  customProvider={config.customProvider}
                                  placeholder="继承默认"
                                />
                              </FieldRow>
                            </div>
                            {!layerProviderAvailable ? (
                              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                                当前 layer 指向 <code className="font-mono text-amber-800">{PROVIDER_LABELS[layerProvider]}</code>，但该 Provider 尚未配置。
                              </div>
                            ) : null}
                            {layerProvider === 'custom' ? (
                              <div className="rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-3 py-2 text-xs text-[var(--app-text-soft)]">
                                该 layer 使用 AI 接入中的兼容服务，地址和密钥仍在上方维护。
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3 text-xs text-[var(--app-text-soft)]">
                      未设置按层覆盖。
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="bg-sky-500 px-4 font-medium text-white hover:bg-sky-400"
        >
          {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
          保存默认配置
        </Button>
        <SaveFeedback saved={saved} error={saveError} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SettingsPanel
// ---------------------------------------------------------------------------

export default function SettingsPanel({
  requestedTab = 'profile',
  focusTarget = null,
  requestToken = 0,
}: {
  requestedTab?: SettingsTabId;
  focusTarget?: SettingsFocusTarget;
  requestToken?: number;
}) {
  const [config, setConfig] = useState<AIProviderConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<SettingsConfigError | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTabId>(requestedTab);
  const [providerInventory, setProviderInventory] = useState<ProviderInventory | null>(null);

  useEffect(() => {
    fetch('/api/ai-config')
      .then((res) => readJsonOrThrow<AIProviderConfig>(res, 'Failed to load config'))
      .then((data) => {
        setConfig(data);
        setConfigError(null);
      })
      .catch((error: unknown) => {
        if (isUnconfiguredWebApiError(error)) {
          setConfigError({
            kind: 'web-api-unavailable',
            message: error.message,
            path: error.path,
          });
          return;
        }
        setConfigError({
          kind: 'generic',
          message: error instanceof Error ? error.message : '无法加载 AI 配置',
        });
      })
      .finally(() => setConfigLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/api-keys')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load provider inventory');
        return res.json() as Promise<ProviderInventory>;
      })
      .then((data) => setProviderInventory(data))
      .catch(() => setProviderInventory(null));
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setActiveTab(requestedTab);
    });
  }, [requestedTab, requestToken]);

  if (configLoading) {
    return (
      <WorkspaceSurface className="rounded-[20px] border-[#dfe5ee] bg-white shadow-[0_18px_44px_rgba(28,44,73,0.06)]">
        <div className="flex items-center gap-2 px-2 py-8 text-sm text-[var(--app-text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      </WorkspaceSurface>
    );
  }

  if (configError) {
    return <SettingsBackendUnavailable error={configError} />;
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => value && setActiveTab(value as SettingsTabId)}
      className="space-y-4"
    >
      <div className="min-w-0 space-y-4">
        <WorkspaceSurface className="rounded-[20px] border-[#dfe5ee] bg-white shadow-[0_14px_30px_rgba(28,44,73,0.05)]" padding="sm">
          <WorkspaceTabsList
            variant="pill"
            className="h-auto flex-nowrap justify-start gap-1 overflow-x-auto rounded-[14px] border-[#dfe5ee] bg-[#f7f9fc] p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {SETTINGS_TABS.map((tab) => (
              <WorkspaceTabsTrigger
                key={tab.value}
                value={tab.value}
                variant="pill"
                className="h-10 flex-none rounded-[10px] px-3.5 text-[13px] font-medium text-[#556173] data-[state=active]:bg-white data-[state=active]:text-[#145fc2] data-[state=active]:shadow-[0_6px_18px_rgba(20,95,194,0.1)]"
              >
                {tab.label}
              </WorkspaceTabsTrigger>
            ))}
          </WorkspaceTabsList>
        </WorkspaceSurface>

        <TabsContent value="profile" className="mt-0">
          <CEOProfileSettingsTab />
        </TabsContent>
        <TabsContent value="provider" className="mt-0">
          <ProviderConfigTab
            initialConfig={config}
            providerInventory={providerInventory}
            onProviderInventoryChanged={setProviderInventory}
            focusThirdParty={focusTarget === 'third-party-provider'}
            focusRequestToken={requestToken}
          />
        </TabsContent>
        <TabsContent value="api-keys" className="mt-0">
          <ApiKeysTab onInventoryChanged={setProviderInventory} />
        </TabsContent>
        <TabsContent value="scenes" className="mt-0">
          <SceneOverridesTab initialConfig={config} providerInventory={providerInventory} />
        </TabsContent>
        <TabsContent value="autonomy" className="mt-0">
          <AutonomyBudgetTab />
        </TabsContent>
        <TabsContent value="mcp" className="mt-0">
          <McpServersTab />
        </TabsContent>
        <TabsContent value="messaging" className="mt-0">
          <CcConnectTab />
        </TabsContent>
      </div>
    </Tabs>
  );
}
