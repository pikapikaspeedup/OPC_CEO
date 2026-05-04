'use client';

import { useState, useEffect, useCallback, useMemo, useRef, forwardRef } from 'react';
import Image from 'next/image';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Eye,
  EyeOff,
  Save,
  Layers,
  Key,
  Map as MapIcon,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertCircle,
  Plug,
  Terminal,
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
  type ProviderTransportId,
  type SceneProviderConfig,
} from '@/lib/providers/types';
import type { CompanyLoopPolicyFE, OperatingBudgetPolicyFE } from '@/lib/types';
import {
  PROVIDER_LABELS,
  getSelectableProviderOptions,
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

type ProviderModelCatalogModel = {
  id: string;
  label: string;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  supportsImageGeneration?: boolean;
  contextWindow?: number;
};

type ProviderModelCatalogEntry = {
  provider: AIProviderId;
  transport: ProviderTransportId;
  source: 'antigravity-runtime' | 'pi-registry' | 'remote-discovery' | 'manual';
  fetchedAt: string;
  models: ProviderModelCatalogModel[];
  warning?: string;
  stale?: boolean;
};

type ProviderModelCatalogPayload = {
  entry: ProviderModelCatalogEntry;
  cachePath?: string;
};

type CompanyLoopNotificationTarget = {
  channel: CompanyLoopPolicyFE['notificationChannels'][number];
  label: string;
  description: string;
  available: boolean;
  fixed?: boolean;
  reason?: string;
};

const providerCatalogCache = new Map<string, ProviderModelCatalogEntry>();

function buildProviderCatalogCacheKey(
  provider: AIProviderId,
  customProvider?: AIProviderConfig['customProvider'],
): string {
  return JSON.stringify({
    provider,
    baseUrl: customProvider?.baseUrl ?? null,
    defaultModel: customProvider?.defaultModel ?? null,
    vendor: customProvider?.vendor ?? null,
  });
}

async function fetchProviderCatalog(
  provider: AIProviderId,
  options?: {
    refresh?: boolean;
    customProvider?: AIProviderConfig['customProvider'];
  },
): Promise<ProviderModelCatalogEntry> {
  const cacheKey = buildProviderCatalogCacheKey(provider, options?.customProvider);
  if (!options?.refresh && providerCatalogCache.has(cacheKey)) {
    return providerCatalogCache.get(cacheKey)!;
  }

  const res = await fetch('/api/provider-model-catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      refresh: options?.refresh ?? false,
      customProviderOverride: options?.customProvider,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to load provider models' })) as { error?: string };
    throw new Error(data.error || 'Failed to load provider models');
  }

  const data = await res.json() as ProviderModelCatalogPayload;
  providerCatalogCache.set(cacheKey, data.entry);
  return data.entry;
}

const ORGANIZATION_BUDGET_POLICY_ID = 'budget:organization:default:day';
const DEPARTMENT_DEFAULT_BUDGET_POLICY_ID = 'budget:department:default:day';
const ORGANIZATION_LOOP_POLICY_ID = 'company-loop-policy:organization:default';

function buildDefaultOrganizationBudgetPolicy(): OperatingBudgetPolicyFE {
  const now = new Date().toISOString();
  return {
    id: ORGANIZATION_BUDGET_POLICY_ID,
    scope: 'organization',
    period: 'day',
    maxTokens: 1_000_000,
    maxMinutes: 480,
    maxDispatches: 80,
    maxConcurrentRuns: 12,
    cooldownMinutesByKind: {
      'growth.generate': 60,
      'growth.evaluate': 15,
      'agenda.dispatch': 10,
    },
    failureBudget: {
      maxConsecutiveFailures: 3,
      coolDownMinutes: 30,
    },
    warningThreshold: 0.8,
    hardStop: true,
    createdAt: now,
    updatedAt: now,
    metadata: {
      highRiskApprovalThreshold: 0.7,
    },
  };
}

function buildDefaultDepartmentBudgetPolicy(): OperatingBudgetPolicyFE {
  const now = new Date().toISOString();
  return {
    id: DEPARTMENT_DEFAULT_BUDGET_POLICY_ID,
    scope: 'department',
    period: 'day',
    maxTokens: 250_000,
    maxMinutes: 120,
    maxDispatches: 20,
    maxConcurrentRuns: 3,
    cooldownMinutesByKind: {
      'manual.prompt': 0,
      'manual.template': 0,
      'agenda.dispatch': 10,
    },
    failureBudget: {
      maxConsecutiveFailures: 3,
      coolDownMinutes: 30,
    },
    warningThreshold: 0.8,
    hardStop: true,
    createdAt: now,
    updatedAt: now,
    metadata: {
      source: 'settings-department-default',
    },
  };
}

function buildDefaultCompanyLoopPolicy(): CompanyLoopPolicyFE {
  const now = new Date().toISOString();
  return {
    id: ORGANIZATION_LOOP_POLICY_ID,
    scope: 'organization',
    enabled: true,
    timezone: 'Asia/Shanghai',
    dailyReviewHour: 20,
    weeklyReviewDay: 5,
    weeklyReviewHour: 20,
    maxAgendaPerDailyLoop: 5,
    maxAutonomousDispatchesPerLoop: 1,
    allowedAgendaActions: ['observe', 'dispatch', 'snooze', 'dismiss'],
    growthReviewEnabled: true,
    notificationChannels: ['web'],
    createdAt: now,
    updatedAt: now,
  };
}

function cooldownToDraft(policy: OperatingBudgetPolicyFE): string {
  return Object.entries(policy.cooldownMinutesByKind || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, minutes]) => `${kind}=${minutes}`)
    .join('\n');
}

function draftToCooldown(value: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const line of value.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [rawKey, rawValue] = trimmed.split('=');
    const key = rawKey?.trim();
    const minutes = Number(rawValue?.trim());
    if (!key || Number.isNaN(minutes)) continue;
    result[key] = Math.max(0, Math.trunc(minutes));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-[var(--app-accent)]">{icon}</span>
      <h3 className="text-sm font-semibold text-[var(--app-text)]">{children}</h3>
    </div>
  );
}

const Card = forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string }>(
  function Card({ children, className }, ref) {
    return (
      <WorkspaceSurface
        ref={ref}
        className={className}
      >
        {children}
      </WorkspaceSurface>
    );
  },
);

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
      <label className="w-32 shrink-0 text-xs text-[var(--app-text-muted)]">{label}</label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function StackedField({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium text-[var(--app-text-muted)]">{label}</div>
      {children}
      {hint ? <div className="text-[10px] text-[var(--app-text-muted)]">{hint}</div> : null}
    </div>
  );
}

function ProviderSelect({
  value,
  onChange,
  providerInventory,
  config,
  customProvider,
  allowedProviders,
  configuredOnly = false,
  allowUnavailableSelection = false,
}: {
  value: AIProviderId;
  onChange: (v: AIProviderId) => void;
  providerInventory: ProviderInventory | null;
  config?: AIProviderConfig | null;
  customProvider?: AIProviderConfig['customProvider'];
  allowedProviders?: AIProviderId[];
  configuredOnly?: boolean;
  allowUnavailableSelection?: boolean;
}) {
  let options = getSelectableProviderOptions(providerInventory, customProvider, value, config)
    .filter((option) => !allowedProviders || allowedProviders.includes(option.value))
    .filter((option) => !configuredOnly || !option.disabled || option.value === value);

  if (allowUnavailableSelection) {
    options = options.map((option) => ({
      ...option,
      label: PROVIDER_LABELS[option.value] ?? option.label,
      disabled: false,
    }));
  }

  return (
    <Select value={value} onValueChange={(v) => onChange(v as AIProviderId)}>
      <SelectTrigger className="h-8 rounded-lg border-[var(--app-border-soft)] bg-[var(--app-raised)] text-xs text-[var(--app-text)]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="text-xs" disabled={opt.disabled}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ProviderModelInput({
  provider,
  value,
  onChange,
  customProvider,
  placeholder,
  disabled = false,
  className,
  capability,
  showRefreshButton = false,
  showHelperText = false,
}: {
  provider: AIProviderId;
  value: string;
  onChange: (value: string) => void;
  customProvider?: AIProviderConfig['customProvider'];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  capability?: 'image-generation';
  showRefreshButton?: boolean;
  showHelperText?: boolean;
}) {
  const [catalog, setCatalog] = useState<ProviderModelCatalogEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useMemo(
    () => `provider-models-${provider}-${Math.random().toString(36).slice(2, 10)}`,
    [provider],
  );

  const loadCatalog = useCallback(async (refresh = false) => {
    if (disabled) return;
    if (provider === 'custom' && !customProvider?.baseUrl?.trim()) {
      setCatalog(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const entry = await fetchProviderCatalog(provider, { refresh, customProvider });
      setCatalog(entry);
      if (entry.warning) {
        setError(entry.warning);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载模型目录');
    } finally {
      setLoading(false);
    }
  }, [provider, customProvider, disabled]);

  useEffect(() => {
    void loadCatalog(false);
  }, [loadCatalog]);

  const visibleModels = useMemo(() => {
    if (!catalog?.models) {
      return [];
    }
    if (capability === 'image-generation') {
      return catalog.models.filter((model) => model.supportsImageGeneration);
    }
    return catalog.models;
  }, [capability, catalog]);

  const helperText = useMemo(() => {
    if (loading) return '正在读取模型目录…';
    if (catalog) {
      const parts = [
        `${visibleModels.length} 个模型`,
        catalog.source === 'pi-registry'
          ? 'pi-ai registry'
          : catalog.source === 'remote-discovery'
            ? '远端发现'
            : catalog.source === 'antigravity-runtime'
              ? 'Antigravity runtime'
              : '手动/缓存',
      ];
      if (catalog.fetchedAt) {
        parts.push(new Date(catalog.fetchedAt).toLocaleString('zh-CN', { hour12: false }));
      }
      if (capability === 'image-generation' && visibleModels.length === 0) {
        parts.push('未标记图像能力，可手动输入');
      }
      return parts.join(' · ');
    }
    if (provider === 'custom') {
      return '填写 Base URL 和 API Key 后可刷新模型列表。';
    }
    return '可直接输入模型名，或刷新读取 provider 支持列表。';
  }, [capability, catalog, loading, provider, visibleModels.length]);

  const helperTone = error ? 'text-amber-600' : 'text-[var(--app-text-muted)]';

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          list={listId}
          disabled={disabled}
          className={cn('h-8 rounded-lg text-xs', workspaceFieldClassName)}
        />
        {showRefreshButton ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void loadCatalog(true)}
            disabled={disabled || loading || (provider === 'custom' && !customProvider?.baseUrl?.trim())}
            className={cn('h-8 w-8 shrink-0 rounded-lg px-0', workspaceOutlineActionClassName)}
            aria-label="刷新模型"
            title="刷新模型"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        ) : null}
      </div>
      <datalist id={listId}>
        {visibleModels.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </datalist>
      {showHelperText || error ? (
        <div className={cn('text-[10px]', helperTone)}>{error ?? helperText}</div>
      ) : null}
    </div>
  );
}

function SaveFeedback({ saved, error }: { saved: boolean; error: string | null }) {
  if (error) {
    return (
      <span className="flex items-center gap-1 text-xs text-red-400">
        <XCircle className="h-3 w-3" />
        {error}
      </span>
    );
  }
  if (saved) {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        已保存
      </span>
    );
  }
  return null;
}

type ApiKeyTestStatus = 'idle' | 'testing' | 'ok' | 'invalid' | 'error';

function ApiKeyCard({
  title,
  isSet,
  value,
  showValue,
  placeholder,
  testStatus,
  testError,
  successMessage,
  onValueChange,
  onToggleShow,
  onTest,
}: {
  title: string;
  isSet: boolean;
  value: string;
  showValue: boolean;
  placeholder: string;
  testStatus: ApiKeyTestStatus;
  testError: string | null;
  successMessage: string;
  onValueChange: (value: string) => void;
  onToggleShow: () => void;
  onTest: () => void;
}) {
  return (
    <Card>
      <SectionTitle icon={<Key className="h-4 w-4" />}>{title}</SectionTitle>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--app-text-muted)]">状态：</span>
          {isSet ? (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              已设置
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-[var(--app-text-muted)]">
              <AlertCircle className="h-3 w-3" />
              未设置
            </span>
          )}
        </div>

        <FieldRow label="新 Key">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showValue ? 'text' : 'password'}
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                placeholder={isSet ? '输入新 key 以替换' : placeholder}
                className={cn('h-8 rounded-lg pr-9 text-xs', workspaceFieldClassName)}
              />
              <button
                type="button"
                onClick={onToggleShow}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--app-text-muted)] transition-colors hover:text-[var(--app-text-soft)]"
              >
                {showValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onTest}
              disabled={!value.trim() || testStatus === 'testing'}
              className={cn('shrink-0 text-xs', workspaceOutlineActionClassName)}
            >
              {testStatus === 'testing' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span className="ml-1.5">测试连接</span>
            </Button>
          </div>
        </FieldRow>

        {testStatus === 'ok' ? (
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            {successMessage}
          </div>
        ) : null}
        {testStatus === 'invalid' ? (
          <div className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <XCircle className="h-3.5 w-3.5 shrink-0" />
            {testError ?? 'Key 无效'}
          </div>
        ) : null}
        {testStatus === 'error' ? (
          <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {testError ?? '测试失败'}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

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
// Tab 2: Autonomy / Budget
// ---------------------------------------------------------------------------

function AutonomyBudgetTab() {
  const [policy, setPolicy] = useState<OperatingBudgetPolicyFE | null>(null);
  const [departmentPolicy, setDepartmentPolicy] = useState<OperatingBudgetPolicyFE | null>(null);
  const [loopPolicy, setLoopPolicy] = useState<CompanyLoopPolicyFE | null>(null);
  const [notificationTargets, setNotificationTargets] = useState<CompanyLoopNotificationTarget[]>([]);
  const [cooldownDraft, setCooldownDraft] = useState('');
  const [departmentCooldownDraft, setDepartmentCooldownDraft] = useState('');
  const [showOrgAdvanced, setShowOrgAdvanced] = useState(false);
  const [showDepartmentAdvanced, setShowDepartmentAdvanced] = useState(false);
  const [showLoopAdvanced, setShowLoopAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setSaveError(null);
    try {
      const [organizationRes, departmentRes, loopRes, notificationTargetsRes] = await Promise.all([
        fetch('/api/company/budget/policies?scope=organization&period=day&pageSize=1'),
        fetch(`/api/company/budget/policies/${encodeURIComponent(DEPARTMENT_DEFAULT_BUDGET_POLICY_ID)}`),
        fetch(`/api/company/loops/policies/${encodeURIComponent(ORGANIZATION_LOOP_POLICY_ID)}`),
        fetch('/api/company/loops/notification-targets'),
      ]);
      if (!organizationRes.ok) {
        const data = (await organizationRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Failed to load autonomy policy');
      }
      const organizationData = (await organizationRes.json()) as { items?: OperatingBudgetPolicyFE[] };
      const nextPolicy = organizationData.items?.[0] || buildDefaultOrganizationBudgetPolicy();
      const nextDepartmentPolicy = departmentRes.ok
        ? (await departmentRes.json()) as OperatingBudgetPolicyFE
        : buildDefaultDepartmentBudgetPolicy();
      const nextLoopPolicy = loopRes.ok
        ? (await loopRes.json()) as CompanyLoopPolicyFE
        : buildDefaultCompanyLoopPolicy();
      const nextNotificationTargets = notificationTargetsRes.ok
        ? ((await notificationTargetsRes.json()) as { items?: CompanyLoopNotificationTarget[] }).items ?? []
        : [];
      setPolicy(nextPolicy);
      setDepartmentPolicy(nextDepartmentPolicy);
      setLoopPolicy(nextLoopPolicy);
      setNotificationTargets(nextNotificationTargets);
      setCooldownDraft(cooldownToDraft(nextPolicy));
      setDepartmentCooldownDraft(cooldownToDraft(nextDepartmentPolicy));
      setShowOrgAdvanced(false);
      setShowDepartmentAdvanced(false);
      setShowLoopAdvanced(false);
    } catch (err) {
      const fallback = buildDefaultOrganizationBudgetPolicy();
      const departmentFallback = buildDefaultDepartmentBudgetPolicy();
      setPolicy(fallback);
      setDepartmentPolicy(departmentFallback);
      setLoopPolicy(buildDefaultCompanyLoopPolicy());
      setNotificationTargets([
        {
          channel: 'web',
          label: 'Web 收件箱',
          description: '在 CEO / Web 界面保留公司循环摘要。',
          available: true,
          fixed: true,
        },
      ]);
      setCooldownDraft(cooldownToDraft(fallback));
      setDepartmentCooldownDraft(cooldownToDraft(departmentFallback));
      setShowOrgAdvanced(false);
      setShowDepartmentAdvanced(false);
      setShowLoopAdvanced(false);
      setSaveError(err instanceof Error ? err.message : 'Failed to load autonomy policy');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  const updateNumber = (
    target: 'organization' | 'department',
    field: keyof Pick<OperatingBudgetPolicyFE, 'maxTokens' | 'maxMinutes' | 'maxDispatches' | 'maxConcurrentRuns' | 'warningThreshold'>,
    value: string,
  ) => {
    const parsed = Number(value);
    const setter = target === 'organization' ? setPolicy : setDepartmentPolicy;
    setter((prev) => {
      if (!prev) return prev;
      if (field === 'warningThreshold') {
        return { ...prev, warningThreshold: Math.max(0, Math.min(1, parsed || 0)) };
      }
      return { ...prev, [field]: Math.max(0, Math.trunc(parsed || 0)) };
    });
  };

  const updateFailureBudget = (
    target: 'organization' | 'department',
    field: 'maxConsecutiveFailures' | 'coolDownMinutes',
    value: string,
  ) => {
    const parsed = Math.max(0, Math.trunc(Number(value) || 0));
    const setter = target === 'organization' ? setPolicy : setDepartmentPolicy;
    setter((prev) => prev ? {
      ...prev,
      failureBudget: {
        maxConsecutiveFailures: prev.failureBudget?.maxConsecutiveFailures ?? 3,
        coolDownMinutes: prev.failureBudget?.coolDownMinutes ?? 30,
        [field]: parsed,
      },
    } : prev);
  };

  const updateApprovalThreshold = (value: string) => {
    const parsed = Math.max(0, Math.min(1, Number(value) || 0));
    setPolicy((prev) => prev ? {
      ...prev,
      metadata: {
        ...(prev.metadata || {}),
        highRiskApprovalThreshold: parsed,
      },
    } : prev);
  };

  const updateLoopNumber = (
    field: keyof Pick<CompanyLoopPolicyFE, 'dailyReviewHour' | 'weeklyReviewDay' | 'weeklyReviewHour' | 'maxAgendaPerDailyLoop' | 'maxAutonomousDispatchesPerLoop'>,
    value: string,
  ) => {
    const parsed = Math.trunc(Number(value) || 0);
    setLoopPolicy((prev) => prev ? {
      ...prev,
      [field]: field === 'weeklyReviewDay'
        ? Math.max(0, Math.min(6, parsed))
        : field.endsWith('Hour')
          ? Math.max(0, Math.min(23, parsed))
          : Math.max(0, parsed),
    } : prev);
  };

  const handleSave = async () => {
    if (!policy || !departmentPolicy || !loopPolicy) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const nextPolicy: OperatingBudgetPolicyFE = {
        ...policy,
        id: policy.id || ORGANIZATION_BUDGET_POLICY_ID,
        scope: 'organization',
        period: 'day',
        cooldownMinutesByKind: draftToCooldown(cooldownDraft),
      };
      const nextDepartmentPolicy: OperatingBudgetPolicyFE = {
        ...departmentPolicy,
        id: departmentPolicy.id || DEPARTMENT_DEFAULT_BUDGET_POLICY_ID,
        scope: 'department',
        scopeId: undefined,
        period: 'day',
        cooldownMinutesByKind: draftToCooldown(departmentCooldownDraft),
      };
      const nextLoopPolicy: CompanyLoopPolicyFE = {
        ...loopPolicy,
        id: loopPolicy.id || ORGANIZATION_LOOP_POLICY_ID,
        scope: 'organization',
        notificationChannels: Array.from(new Set([
          'web',
          ...loopPolicy.notificationChannels.filter((channel) =>
            notificationTargets.some((target) => target.channel === channel && (target.fixed || target.available)),
          ),
        ])) as CompanyLoopPolicyFE['notificationChannels'],
      };
      const [organizationRes, departmentRes, loopRes] = await Promise.all([
        fetch(`/api/company/budget/policies/${encodeURIComponent(nextPolicy.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextPolicy),
        }),
        fetch(`/api/company/budget/policies/${encodeURIComponent(nextDepartmentPolicy.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextDepartmentPolicy),
        }),
        fetch(`/api/company/loops/policies/${encodeURIComponent(nextLoopPolicy.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextLoopPolicy),
        }),
      ]);
      if (!organizationRes.ok || !departmentRes.ok || !loopRes.ok) {
        const failed = !organizationRes.ok ? organizationRes : !departmentRes.ok ? departmentRes : loopRes;
        const data = (await failed.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Save failed');
      }
      const organizationData = (await organizationRes.json()) as { policy: OperatingBudgetPolicyFE };
      const departmentData = (await departmentRes.json()) as { policy: OperatingBudgetPolicyFE };
      const loopData = (await loopRes.json()) as { policy: CompanyLoopPolicyFE };
      setPolicy(organizationData.policy);
      setDepartmentPolicy(departmentData.policy);
      setLoopPolicy(loopData.policy);
      setCooldownDraft(cooldownToDraft(organizationData.policy));
      setDepartmentCooldownDraft(cooldownToDraft(departmentData.policy));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !policy || !departmentPolicy || !loopPolicy) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-[var(--app-text-soft)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading autonomy policy…
      </div>
    );
  }

  const highRiskApprovalThreshold = Number(policy.metadata?.highRiskApprovalThreshold ?? 0.7);
  const organizationModeLabel = policy.hardStop ? '超限即停止' : '仅预警';
  const departmentModeLabel = departmentPolicy.hardStop ? '超限即停止' : '仅预警';
  const loopModeLabel = loopPolicy.enabled ? '已启用' : '已停用';
  const availableExternalTargets = notificationTargets.filter((target) => target.channel !== 'web' && target.available);

  return (
    <div className="space-y-5">
      <Card className="border-sky-400/15 bg-[linear-gradient(180deg,#ffffff,#f4f8ff)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <SectionTitle icon={<Activity className="h-4 w-4" />}>组织自运营预算</SectionTitle>
            <p className="max-w-2xl text-xs leading-6 text-[var(--app-text-soft)]">
              控制公司级自治任务的预算边界。这里只配总量和风险阈值，不把内部 policy 标识暴露给使用者。
            </p>
          </div>
          <WorkspaceBadge tone={policy.hardStop ? 'warning' : 'info'}>{organizationModeLabel}</WorkspaceBadge>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StackedField label="Token 上限">
            <Input
              type="number"
              value={policy.maxTokens}
              onChange={(event) => updateNumber('organization', 'maxTokens', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="分钟上限">
            <Input
              type="number"
              value={policy.maxMinutes}
              onChange={(event) => updateNumber('organization', 'maxMinutes', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="派发上限">
            <Input
              type="number"
              value={policy.maxDispatches}
              onChange={(event) => updateNumber('organization', 'maxDispatches', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="并发上限">
            <Input
              type="number"
              value={policy.maxConcurrentRuns ?? 0}
              onChange={(event) => updateNumber('organization', 'maxConcurrentRuns', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StackedField label="连续失败">
              <Input
                type="number"
                value={policy.failureBudget?.maxConsecutiveFailures ?? 3}
                onChange={(event) => updateFailureBudget('organization', 'maxConsecutiveFailures', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </StackedField>
            <StackedField label="冷却分钟">
              <Input
                type="number"
                value={policy.failureBudget?.coolDownMinutes ?? 30}
                onChange={(event) => updateFailureBudget('organization', 'coolDownMinutes', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </StackedField>
            <StackedField label="预警阈值" hint="0 到 1">
              <Input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={policy.warningThreshold}
                onChange={(event) => updateNumber('organization', 'warningThreshold', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </StackedField>
            <StackedField label="审批阈值" hint="高于该值需要审批">
              <Input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={highRiskApprovalThreshold}
                onChange={(event) => updateApprovalThreshold(event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </StackedField>
          </div>

          <div className="rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">执行模式</div>
            <label className="mt-3 flex items-center gap-2 text-sm text-[var(--app-text)]">
              <input
                type="checkbox"
                checked={policy.hardStop}
                onChange={(event) => setPolicy((prev) => prev ? { ...prev, hardStop: event.target.checked } : prev)}
              />
              超限后立即停止自治任务
            </label>
            <div className="mt-2 text-xs leading-6 text-[var(--app-text-soft)]">
              关闭后只会预警，不会自动拦截。
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3">
          <div className="text-xs text-[var(--app-text-soft)]">operation 冷却规则属于高级项，默认不在主画面展开。</div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowOrgAdvanced((value) => !value)}
            className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
          >
            {showOrgAdvanced ? '收起高级规则' : '展开高级规则'}
          </Button>
        </div>

        {showOrgAdvanced ? (
          <div className="mt-4 rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
            <div className="text-sm font-semibold text-[var(--app-text)]">操作冷却</div>
            <textarea
              value={cooldownDraft}
              onChange={(event) => setCooldownDraft(event.target.value)}
              spellCheck={false}
              className={cn('mt-3 min-h-[160px] w-full resize-y rounded-2xl border px-4 py-3 font-mono text-xs leading-6 outline-none', workspaceFieldClassName)}
              placeholder={'growth.generate=60\ngrowth.evaluate=15\nagenda.dispatch=10'}
            />
            <p className="mt-3 text-xs leading-6 text-[var(--app-text-soft)]">
              每行一个 `operationKind=minutes`。只在你明确要限制某类自治动作冷却时才需要填写。
            </p>
          </div>
        ) : null}
      </Card>

      <Card className="border-emerald-400/15 bg-[linear-gradient(180deg,#ffffff,#f5fbf8)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <SectionTitle icon={<Layers className="h-4 w-4" />}>部门默认预算</SectionTitle>
            <p className="max-w-2xl text-xs leading-6 text-[var(--app-text-soft)]">
              新部门或未配置专属预算的部门会继承这组默认值。大多数情况下只需要改总量和拦截模式。
            </p>
          </div>
          <WorkspaceBadge tone={departmentPolicy.hardStop ? 'warning' : 'info'}>{departmentModeLabel}</WorkspaceBadge>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StackedField label="Token 上限">
            <Input
              type="number"
              value={departmentPolicy.maxTokens}
              onChange={(event) => updateNumber('department', 'maxTokens', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="分钟上限">
            <Input
              type="number"
              value={departmentPolicy.maxMinutes}
              onChange={(event) => updateNumber('department', 'maxMinutes', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="派发上限">
            <Input
              type="number"
              value={departmentPolicy.maxDispatches}
              onChange={(event) => updateNumber('department', 'maxDispatches', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="并发上限">
            <Input
              type="number"
              value={departmentPolicy.maxConcurrentRuns ?? 0}
              onChange={(event) => updateNumber('department', 'maxConcurrentRuns', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <StackedField label="连续失败">
              <Input
                type="number"
                value={departmentPolicy.failureBudget?.maxConsecutiveFailures ?? 3}
                onChange={(event) => updateFailureBudget('department', 'maxConsecutiveFailures', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </StackedField>
            <StackedField label="冷却分钟">
              <Input
                type="number"
                value={departmentPolicy.failureBudget?.coolDownMinutes ?? 30}
                onChange={(event) => updateFailureBudget('department', 'coolDownMinutes', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </StackedField>
            <StackedField label="预警阈值" hint="0 到 1">
              <Input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={departmentPolicy.warningThreshold}
                onChange={(event) => updateNumber('department', 'warningThreshold', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </StackedField>
          </div>
          <div className="rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">执行模式</div>
            <label className="mt-3 flex items-center gap-2 text-sm text-[var(--app-text)]">
              <input
                type="checkbox"
                checked={departmentPolicy.hardStop}
                onChange={(event) => setDepartmentPolicy((prev) => prev ? { ...prev, hardStop: event.target.checked } : prev)}
              />
              部门超限后立即停止自治任务
            </label>
            <div className="mt-2 text-xs leading-6 text-[var(--app-text-soft)]">
              默认部门策略尽量保持简单，新部门直接继承，不必在这里做功能级拆分。
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3">
          <div className="text-xs text-[var(--app-text-soft)]">部门冷却规则属于高级项，只在确实需要压某类动作时再展开。</div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowDepartmentAdvanced((value) => !value)}
            className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
          >
            {showDepartmentAdvanced ? '收起高级规则' : '展开高级规则'}
          </Button>
        </div>

        {showDepartmentAdvanced ? (
          <div className="mt-4 rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
            <div className="text-sm font-semibold text-[var(--app-text)]">部门冷却规则</div>
            <textarea
              value={departmentCooldownDraft}
              onChange={(event) => setDepartmentCooldownDraft(event.target.value)}
              spellCheck={false}
              className={cn('mt-3 min-h-[140px] w-full resize-y rounded-2xl border px-4 py-3 font-mono text-xs leading-6 outline-none', workspaceFieldClassName)}
              placeholder={'manual.prompt=0\nmanual.template=0\nagenda.dispatch=10'}
            />
            <p className="mt-3 text-xs leading-6 text-[var(--app-text-soft)]">
              每行一个 `operationKind=minutes`。比如限制 `agenda.dispatch` 重复派发，或把 `manual.prompt` 保持为 0。
            </p>
          </div>
        ) : null}
      </Card>

      <Card className="border-blue-400/15 bg-[linear-gradient(180deg,#ffffff,#f5f8ff)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <SectionTitle icon={<RefreshCw className="h-4 w-4" />}>公司循环策略</SectionTitle>
            <p className="max-w-2xl text-xs leading-6 text-[var(--app-text-soft)]">
              控制 daily / weekly review 的触发节奏和允许的自治动作。默认只显示主节奏，高级选项按需展开。
            </p>
          </div>
          <WorkspaceBadge tone={loopPolicy.enabled ? 'success' : 'neutral'}>{loopModeLabel}</WorkspaceBadge>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StackedField label="时区">
            <Input
              value={loopPolicy.timezone}
              onChange={(event) => setLoopPolicy((prev) => prev ? { ...prev, timezone: event.target.value } : prev)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="日报小时">
            <Input
              type="number"
              min="0"
              max="23"
              value={loopPolicy.dailyReviewHour}
              onChange={(event) => updateLoopNumber('dailyReviewHour', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="周报星期">
            <Input
              type="number"
              min="0"
              max="6"
              value={loopPolicy.weeklyReviewDay}
              onChange={(event) => updateLoopNumber('weeklyReviewDay', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="周报小时">
            <Input
              type="number"
              min="0"
              max="23"
              value={loopPolicy.weeklyReviewHour}
              onChange={(event) => updateLoopNumber('weeklyReviewHour', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="每日议程数">
            <Input
              type="number"
              value={loopPolicy.maxAgendaPerDailyLoop}
              onChange={(event) => updateLoopNumber('maxAgendaPerDailyLoop', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="单次派发上限">
            <Input
              type="number"
              value={loopPolicy.maxAutonomousDispatchesPerLoop}
              onChange={(event) => updateLoopNumber('maxAutonomousDispatchesPerLoop', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3">
          <div className="text-xs text-[var(--app-text-soft)]">是否启用、允许哪些动作、摘要投递到哪里，都属于高级项。</div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-[var(--app-text-soft)]">
              <input
                type="checkbox"
                checked={loopPolicy.enabled}
                onChange={(event) => setLoopPolicy((prev) => prev ? { ...prev, enabled: event.target.checked } : prev)}
              />
              启用公司循环
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowLoopAdvanced((value) => !value)}
              className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
            >
              {showLoopAdvanced ? '收起高级规则' : '展开高级规则'}
            </Button>
          </div>
        </div>

        {showLoopAdvanced ? (
          <div className="mt-4 rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-4">
            <div className="flex flex-wrap gap-3 text-xs text-[var(--app-text-soft)]">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={loopPolicy.growthReviewEnabled}
                  onChange={(event) => setLoopPolicy((prev) => prev ? { ...prev, growthReviewEnabled: event.target.checked } : prev)}
                />
                启用增长复盘
              </label>
              {(['observe', 'dispatch', 'approve', 'snooze', 'dismiss'] as CompanyLoopPolicyFE['allowedAgendaActions']).map((action) => (
                <label key={action} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={loopPolicy.allowedAgendaActions.includes(action)}
                    onChange={(event) => setLoopPolicy((prev) => {
                      if (!prev) return prev;
                      const nextActions = event.target.checked
                        ? Array.from(new Set([...prev.allowedAgendaActions, action]))
                        : prev.allowedAgendaActions.filter((item) => item !== action);
                      return { ...prev, allowedAgendaActions: nextActions };
                    })}
                  />
                  {action}
                </label>
              ))}
            </div>
            <div className="mt-4 rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-muted)]">摘要投递</div>
              <div className="mt-2 text-xs leading-6 text-[var(--app-text-soft)]">
                会话平台负责对话入口；这里控制公司循环摘要往哪里投递。
              </div>
              <div className="mt-3 space-y-2">
                {notificationTargets.map((target) => {
                  const checked = target.fixed || (target.available && loopPolicy.notificationChannels.includes(target.channel));
                  const disabled = target.fixed || !target.available;
                  return (
                    <label
                      key={target.channel}
                      className={cn(
                        'flex items-start justify-between gap-3 rounded-xl border px-3 py-3',
                        target.available
                          ? 'border-[var(--app-border-soft)] bg-[var(--app-surface)]'
                          : 'border-[var(--app-border-soft)] bg-[var(--app-surface)] opacity-70',
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--app-text)]">{target.label}</div>
                        <div className="mt-1 text-xs leading-5 text-[var(--app-text-soft)]">
                          {target.available ? target.description : target.reason || target.description}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <WorkspaceBadge tone={target.fixed ? 'success' : target.available ? 'info' : 'neutral'}>
                          {target.fixed ? '默认启用' : target.available ? '可用' : '未接入'}
                        </WorkspaceBadge>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={(event) => setLoopPolicy((prev) => {
                            if (!prev || target.fixed || !target.available) return prev;
                            const nextChannels = event.target.checked
                              ? Array.from(new Set([...prev.notificationChannels, target.channel]))
                              : prev.notificationChannels.filter((item) => item !== target.channel);
                            return { ...prev, notificationChannels: nextChannels };
                          })}
                        />
                      </div>
                    </label>
                  );
                })}
              </div>
              {availableExternalTargets.length === 0 ? (
                <div className="mt-3 text-xs text-[var(--app-text-soft)]">
                  当前只有 Web 收件箱会接收公司循环摘要；外部投递尚未接入。
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="bg-sky-500 px-4 font-medium text-white hover:bg-sky-400"
        >
          {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
          保存自运营策略
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void loadPolicy()}
          className={cn('text-xs', workspaceOutlineActionClassName)}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          重新加载
        </Button>
        <SaveFeedback saved={saved} error={saveError} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: Credential Center
// ---------------------------------------------------------------------------

function ApiKeysTab({ onInventoryChanged }: { onInventoryChanged?: (inventory: ProviderInventory) => void }) {
  const [keyStatus, setKeyStatus] = useState<{ anthropic: boolean; openai: boolean; gemini: boolean; grok: boolean }>({
    anthropic: false,
    openai: false,
    gemini: false,
    grok: false,
  });
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [grokKey, setGrokKey] = useState('');
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showGrokKey, setShowGrokKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'invalid' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [openaiTestStatus, setOpenaiTestStatus] = useState<'idle' | 'testing' | 'ok' | 'invalid' | 'error'>('idle');
  const [openaiTestError, setOpenaiTestError] = useState<string | null>(null);
  const [geminiTestStatus, setGeminiTestStatus] = useState<'idle' | 'testing' | 'ok' | 'invalid' | 'error'>('idle');
  const [geminiTestError, setGeminiTestError] = useState<string | null>(null);
  const [grokTestStatus, setGrokTestStatus] = useState<'idle' | 'testing' | 'ok' | 'invalid' | 'error'>('idle');
  const [grokTestError, setGrokTestError] = useState<string | null>(null);
  const [providerInventory, setProviderInventory] = useState<ProviderInventory | null>(null);

  const loadKeyStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/api-keys');
      if (res.ok) {
        const data = (await res.json()) as ProviderInventory;
        setProviderInventory(data);
        onInventoryChanged?.(data);
        setKeyStatus({
          anthropic: data.anthropic.set,
          openai: data.openai.set,
          gemini: data.gemini.set,
          grok: data.grok.set,
        });
      }
    } catch {
      // silent
    }
  }, [onInventoryChanged]);

  useEffect(() => {
    void loadKeyStatus();
  }, [loadKeyStatus]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const body: { anthropic?: string; openai?: string; gemini?: string; grok?: string } = {};
      if (anthropicKey) body.anthropic = anthropicKey;
      if (openaiKey) body.openai = openaiKey;
      if (geminiKey) body.gemini = geminiKey;
      if (grokKey) body.grok = grokKey;

      const res = await fetch('/api/api-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Save failed');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      setAnthropicKey('');
      setOpenaiKey('');
      setGeminiKey('');
      setGrokKey('');
      await loadKeyStatus();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleTestAnthropicKey = async () => {
    const keyToTest = anthropicKey.trim();
    if (!keyToTest) return;
    setTestStatus('testing');
    setTestError(null);
    try {
      const res = await fetch('/api/api-keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', apiKey: keyToTest }),
      });
      const data = (await res.json()) as { status: string; error?: string };
      if (data.status === 'ok') {
        setTestStatus('ok');
      } else if (data.status === 'invalid') {
        setTestStatus('invalid');
        setTestError(data.error ?? 'Invalid key');
      } else {
        setTestStatus('error');
        setTestError(data.error ?? 'Test failed');
      }
    } catch {
      setTestStatus('error');
      setTestError('Network error');
    }
    setTimeout(() => setTestStatus('idle'), 5000);
  };

  const handleTestOpenaiKey = async () => {
    const keyToTest = openaiKey.trim();
    if (!keyToTest) return;
    setOpenaiTestStatus('testing');
    setOpenaiTestError(null);
    try {
      const res = await fetch('/api/api-keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', apiKey: keyToTest }),
      });
      const data = (await res.json()) as { status: string; error?: string };
      if (data.status === 'ok') {
        setOpenaiTestStatus('ok');
      } else if (data.status === 'invalid') {
        setOpenaiTestStatus('invalid');
        setOpenaiTestError(data.error ?? 'Invalid key');
      } else {
        setOpenaiTestStatus('error');
        setOpenaiTestError(data.error ?? 'Test failed');
      }
    } catch {
      setOpenaiTestStatus('error');
      setOpenaiTestError('Network error');
    }
    setTimeout(() => setOpenaiTestStatus('idle'), 5000);
  };

  const handleTestGeminiKey = async () => {
    const keyToTest = geminiKey.trim();
    if (!keyToTest) return;
    setGeminiTestStatus('testing');
    setGeminiTestError(null);
    try {
      const res = await fetch('/api/api-keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'gemini', apiKey: keyToTest }),
      });
      const data = (await res.json()) as { status: string; error?: string };
      if (data.status === 'ok') {
        setGeminiTestStatus('ok');
      } else if (data.status === 'invalid') {
        setGeminiTestStatus('invalid');
        setGeminiTestError(data.error ?? 'Invalid key');
      } else {
        setGeminiTestStatus('error');
        setGeminiTestError(data.error ?? 'Test failed');
      }
    } catch {
      setGeminiTestStatus('error');
      setGeminiTestError('Network error');
    }
    setTimeout(() => setGeminiTestStatus('idle'), 5000);
  };

  const handleTestGrokKey = async () => {
    const keyToTest = grokKey.trim();
    if (!keyToTest) return;
    setGrokTestStatus('testing');
    setGrokTestError(null);
    try {
      const res = await fetch('/api/api-keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'grok', apiKey: keyToTest }),
      });
      const data = (await res.json()) as { status: string; error?: string };
      if (data.status === 'ok') {
        setGrokTestStatus('ok');
      } else if (data.status === 'invalid') {
        setGrokTestStatus('invalid');
        setGrokTestError(data.error ?? 'Invalid key');
      } else {
        setGrokTestStatus('error');
        setGrokTestError(data.error ?? 'Test failed');
      }
    } catch {
      setGrokTestStatus('error');
      setGrokTestError('Network error');
    }
    setTimeout(() => setGrokTestStatus('idle'), 5000);
  };

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle icon={<Key className="h-4 w-4" />}>凭证中心</SectionTitle>
        <div className="text-xs leading-6 text-[var(--app-text-soft)]">
          首次接入建议直接在 `Provider 配置` 中完成。这里用于集中轮换和维护所有 API 凭证。
        </div>
      </Card>

      <ApiKeyCard
        title="Anthropic API Key"
        isSet={keyStatus.anthropic}
        value={anthropicKey}
        showValue={showAnthropicKey}
        placeholder="sk-ant-..."
        testStatus={testStatus}
        testError={testError}
        successMessage="连接成功，Key 有效"
        onValueChange={(value) => {
          setAnthropicKey(value);
          setTestStatus('idle');
        }}
        onToggleShow={() => setShowAnthropicKey((value) => !value)}
        onTest={handleTestAnthropicKey}
      />

      <ApiKeyCard
        title="OpenAI API Key"
        isSet={keyStatus.openai}
        value={openaiKey}
        showValue={showOpenaiKey}
        placeholder="sk-..."
        testStatus={openaiTestStatus}
        testError={openaiTestError}
        successMessage="连接成功，Key 有效"
        onValueChange={(value) => {
          setOpenaiKey(value);
          setOpenaiTestStatus('idle');
        }}
        onToggleShow={() => setShowOpenaiKey((value) => !value)}
        onTest={handleTestOpenaiKey}
      />

      <Card>
        <SectionTitle icon={<Cpu className="h-4 w-4" />}>本地登录态</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--app-text)]">Codex Native</div>
                <div className="mt-1 text-xs text-[var(--app-text-soft)]">读取 `~/.codex/auth.json`，复用本机 Codex 登录。</div>
              </div>
              <span className={cn(
                'inline-flex h-6 items-center rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em]',
                providerInventory?.providers.nativeCodex.loggedIn
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                  : providerInventory?.providers.nativeCodex.installed
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-100'
                    : 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-muted)]',
              )}>
                {providerInventory?.providers.nativeCodex.loggedIn ? 'Ready' : providerInventory?.providers.nativeCodex.installed ? 'Needs Login' : 'Not Installed'}
              </span>
            </div>
            <div className="mt-3 text-xs leading-5 text-[var(--app-text-soft)]">
              {providerInventory?.providers.nativeCodex.loggedIn
                ? '已检测到 Codex OAuth 登录，可以直接应用为默认或 layer provider。'
                : providerInventory?.providers.nativeCodex.installed
                  ? '检测到 codex 命令，但未找到 auth.json。请先在终端完成 codex 登录。'
                  : '当前未检测到 codex 可执行文件。'}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--app-text)]">Claude Code</div>
                <div className="mt-1 text-xs text-[var(--app-text-soft)]">本地 Claude Code CLI / profile 状态检测。</div>
              </div>
              <span className={cn(
                'inline-flex h-6 items-center rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em]',
                providerInventory?.providers.claudeCode.installed && providerInventory?.providers.claudeCode.loginDetected
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                  : providerInventory?.providers.claudeCode.installed
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-100'
                    : 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-muted)]',
              )}>
                {providerInventory?.providers.claudeCode.installed && providerInventory?.providers.claudeCode.loginDetected ? 'Ready' : providerInventory?.providers.claudeCode.installed ? 'Needs Login' : 'Not Installed'}
              </span>
            </div>
            <div className="mt-3 text-xs leading-5 text-[var(--app-text-soft)]">
              {providerInventory?.providers.claudeCode.installed
                ? (providerInventory?.providers.claudeCode.loginDetected
                  ? '已检测到本地 Claude 配置，可切到 Claude Code provider。'
                  : '已检测到 Claude Code 安装，但未检测到登录配置。请先在本机 Claude Code 内完成 /login。')
                : '当前未检测到 claude CLI 或本地 Claude Code 安装。'}
            </div>
          </div>
        </div>
      </Card>

      <ApiKeyCard
        title="Gemini API Key"
        isSet={keyStatus.gemini}
        value={geminiKey}
        showValue={showGeminiKey}
        placeholder="AIza..."
        testStatus={geminiTestStatus}
        testError={geminiTestError}
        successMessage="连接成功，Gemini Key 有效"
        onValueChange={(value) => {
          setGeminiKey(value);
          setGeminiTestStatus('idle');
        }}
        onToggleShow={() => setShowGeminiKey((value) => !value)}
        onTest={handleTestGeminiKey}
      />

      <ApiKeyCard
        title="Grok API Key"
        isSet={keyStatus.grok}
        value={grokKey}
        showValue={showGrokKey}
        placeholder="xai-..."
        testStatus={grokTestStatus}
        testError={grokTestError}
        successMessage="连接成功，Grok Key 有效"
        onValueChange={(value) => {
          setGrokKey(value);
          setGrokTestStatus('idle');
        }}
        onToggleShow={() => setShowGrokKey((value) => !value)}
        onTest={handleTestGrokKey}
      />

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || (!anthropicKey && !openaiKey && !geminiKey && !grokKey)}
          className="bg-sky-500 hover:bg-sky-400 text-white font-medium px-4"
        >
          {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
          保存凭证
        </Button>
        <SaveFeedback saved={saved} error={saveError} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: Scene Overrides
// ---------------------------------------------------------------------------

function SceneOverridesTab({
  initialConfig,
  providerInventory,
}: {
  initialConfig: AIProviderConfig | null;
  providerInventory: ProviderInventory | null;
}) {
  const [config, setConfig] = useState<AIProviderConfig | null>(initialConfig);
  const [newKey, setNewKey] = useState('');
  const [newProvider, setNewProvider] = useState<AIProviderId>('antigravity');
  const [newModel, setNewModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setConfig(initialConfig);
  }, [initialConfig]);

  const scenes = config?.scenes ?? {};
  const sceneEntries = Object.entries(scenes);

  const updateScene = (key: string, field: 'provider' | 'model', value: string) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const existing: SceneProviderConfig = prev.scenes?.[key] ?? { provider: 'antigravity' };
      return {
        ...prev,
        scenes: {
          ...prev.scenes,
          [key]: { ...existing, [field]: field === 'provider' ? (value as AIProviderId) : value || undefined },
        },
      };
    });
  };

  const deleteScene = (key: string) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const newScenes = { ...(prev.scenes ?? {}) };
      delete newScenes[key];
      return { ...prev, scenes: newScenes };
    });
  };

  const addScene = () => {
    const trimmedKey = newKey.trim();
    if (!trimmedKey) return;
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: {
          ...prev.scenes,
          [trimmedKey]: { provider: newProvider, model: newModel.trim() || undefined },
        },
      };
    });
    setNewKey('');
    setNewModel('');
    setNewProvider('antigravity');
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

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle icon={<MapIcon className="h-4 w-4" />}>Scene 覆盖配置</SectionTitle>
        <p className="mb-4 text-xs text-[var(--app-text-soft)]">
          Scene 覆盖优先级最高，留空 Model 则继承运行 Provider。
        </p>

        {sceneEntries.length > 0 ? (
          <div className="space-y-2 mb-4">
            {sceneEntries.map(([key, scene]) => (
              <div key={key} className="flex items-center gap-2 rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-2">
                <span className="w-36 shrink-0 truncate font-mono text-[11px] text-sky-300/80">{key}</span>
                <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
                  <ProviderSelect
                    value={scene.provider}
                    onChange={(v) => updateScene(key, 'provider', v)}
                    providerInventory={providerInventory}
                    config={config}
                    customProvider={config.customProvider}
                  />
                  <ProviderModelInput
                    provider={scene.provider}
                    value={scene.model ?? ''}
                    onChange={(value) => updateScene(key, 'model', value)}
                    customProvider={config.customProvider}
                    placeholder="继承默认"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => deleteScene(key)}
                  className="shrink-0 text-[var(--app-text-muted)] transition-colors hover:text-red-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <WorkspaceEmptyBlock title="暂无 scene 覆盖配置" className="mb-4 py-6" />
        )}

        {/* Add scene */}
        <div className="rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--app-text-muted)]">
            添加 Scene
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addScene(); }}
              placeholder="scene 名称（如 code-summary）"
              className={cn('h-8 flex-1 rounded-lg text-xs', workspaceFieldClassName)}
            />
            <ProviderSelect
              value={newProvider}
              onChange={setNewProvider}
              providerInventory={providerInventory}
              config={config}
              customProvider={config.customProvider}
            />
            <ProviderModelInput
              provider={newProvider}
              value={newModel}
              onChange={setNewModel}
              customProvider={config.customProvider}
              placeholder="Model（可选）"
              className="sm:w-64"
            />
            <Button
              size="sm"
              onClick={addScene}
              disabled={!newKey.trim()}
              className={cn('shrink-0', workspaceOutlineActionClassName)}
              variant="outline"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              添加
            </Button>
          </div>
        </div>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="bg-sky-500 hover:bg-sky-400 text-white font-medium px-4"
        >
          {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
          保存 Scenes
        </Button>
        <SaveFeedback saved={saved} error={saveError} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 4: MCP Servers Management
// ---------------------------------------------------------------------------

type McpServerFE = {
  name: string;
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  description?: string;
  env?: Record<string, string>;
};

function McpServersTab() {
  const [servers, setServers] = useState<McpServerFE[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'ok' | 'error' | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newServer, setNewServer] = useState({
    name: '',
    type: 'stdio' as string,
    command: '',
    args: '',
    url: '',
    description: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/mcp');
      const data = (await res.json()) as { servers?: McpServerFE[] };
      setServers(data.servers ?? []);
    } catch {
      setServers([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const handleAdd = async () => {
    if (!newServer.name.trim()) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const body: Record<string, unknown> = {
        name: newServer.name.trim(),
        type: newServer.type,
        description: newServer.description || undefined,
      };
      if (newServer.type === 'stdio') {
        body.command = newServer.command;
        body.args = newServer.args.split(/\s+/).filter(Boolean);
      } else {
        body.url = newServer.url;
      }
      const res = await fetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSaveResult('ok');
        setShowAddForm(false);
        setNewServer({ name: '', type: 'stdio', command: '', args: '', url: '', description: '' });
        await load();
      } else {
        setSaveResult('error');
      }
    } catch {
      setSaveResult('error');
    }
    setSaving(false);
  };

  const handleDelete = async (name: string) => {
    setSaving(true);
    try {
      await fetch('/api/mcp/servers', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      await load();
    } catch {
      // ignore
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--app-text-soft)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载中...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-[var(--app-text)]">MCP 服务器配置</h3>
          <p className="mt-1 text-xs text-[var(--app-text-soft)]">管理 Model Context Protocol 服务器连接</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddForm(!showAddForm)}
          className={cn('h-8 text-xs', workspaceOutlineActionClassName)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          添加服务器
        </Button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="space-y-3 rounded-xl border border-sky-400/15 bg-sky-400/5 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] text-[var(--app-text-soft)]">名称 *</label>
              <Input
                value={newServer.name}
                onChange={(e) => setNewServer((s) => ({ ...s, name: e.target.value }))}
                placeholder="my-mcp-server"
                className={cn('h-8 text-xs', workspaceFieldClassName)}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-[var(--app-text-soft)]">类型</label>
              <Select value={newServer.type} onValueChange={(v: string | null) => setNewServer((s) => ({ ...s, type: v ?? s.type }))}>
                <SelectTrigger className={cn('h-8 text-xs', workspaceFieldClassName)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">stdio</SelectItem>
                  <SelectItem value="sse">SSE</SelectItem>
                  <SelectItem value="http">HTTP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {newServer.type === 'stdio' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] text-[var(--app-text-soft)]">命令</label>
                <Input
                  value={newServer.command}
                  onChange={(e) => setNewServer((s) => ({ ...s, command: e.target.value }))}
                  placeholder="npx -y @modelcontextprotocol/server-xxx"
                  className={cn('h-8 text-xs font-mono', workspaceFieldClassName)}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-[var(--app-text-soft)]">参数 (空格分隔)</label>
                <Input
                  value={newServer.args}
                  onChange={(e) => setNewServer((s) => ({ ...s, args: e.target.value }))}
                  placeholder="--flag value"
                  className={cn('h-8 text-xs font-mono', workspaceFieldClassName)}
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-[11px] text-[var(--app-text-soft)]">URL</label>
              <Input
                value={newServer.url}
                onChange={(e) => setNewServer((s) => ({ ...s, url: e.target.value }))}
                placeholder="http://localhost:8080/mcp"
                className={cn('h-8 text-xs font-mono', workspaceFieldClassName)}
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-[11px] text-[var(--app-text-soft)]">描述</label>
            <Input
              value={newServer.description}
              onChange={(e) => setNewServer((s) => ({ ...s, description: e.target.value }))}
              placeholder="可选描述"
              className={cn('h-8 text-xs', workspaceFieldClassName)}
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={saving || !newServer.name.trim()}
              className="h-7 text-xs bg-sky-500/80 text-white hover:bg-sky-500"
            >
              {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
              保存
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAddForm(false)}
              className="h-7 text-xs text-[var(--app-text-soft)] hover:text-[var(--app-text)]"
            >
              取消
            </Button>
            {saveResult === 'ok' && (
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                已添加
              </span>
            )}
            {saveResult === 'error' && (
              <span className="text-xs text-red-400 flex items-center gap-1">
                <XCircle className="h-3 w-3" />
                保存失败
              </span>
            )}
          </div>
        </div>
      )}

      {/* Server list */}
      {servers.length === 0 ? (
        <WorkspaceEmptyBlock
          icon={<Plug className="h-5 w-5" />}
          title="尚未配置 MCP 服务器"
          description="点击“添加服务器”开始配置"
        />
      ) : (
        <div className="space-y-2">
          {servers.map((s) => (
            <div
              key={s.name}
              className="group flex items-start gap-3 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3 transition-colors hover:bg-[var(--app-raised)]"
            >
              <div className="mt-0.5 h-2 w-2 rounded-full bg-emerald-400/70 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--app-text)]">{s.name}</span>
                  <span className="rounded-full bg-[var(--app-raised)] px-1.5 py-0.5 text-[10px] text-[var(--app-text-muted)]">
                    {s.type ?? 'stdio'}
                  </span>
                </div>
                {s.description && <p className="mt-0.5 text-[10px] text-[var(--app-text-soft)]">{s.description}</p>}
                <div className="flex items-center gap-1 mt-1">
                  <Terminal className="h-3 w-3 text-[var(--app-text-muted)]" />
                  <code className="truncate font-mono text-[10px] text-[var(--app-text-muted)]">
                    {s.command ? `${s.command} ${(s.args ?? []).join(' ')}`.trim() : s.url ?? '-'}
                  </code>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(s.name)}
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-red-400/50 hover:text-red-400 hover:bg-red-400/10 transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-[var(--app-text-muted)]">配置文件: ~/.gemini/antigravity/mcp_config.json</p>
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
