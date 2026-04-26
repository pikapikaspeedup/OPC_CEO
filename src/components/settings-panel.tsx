'use client';

import { useState, useEffect, useCallback, useMemo, useRef, forwardRef } from 'react';
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
  Map,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertCircle,
  ShieldAlert,
  Plug,
  Terminal,
  Activity,
  Globe,
  MessageCircle,
  CircleCheck,
  Cpu,
  Network,
  ServerCog,
  UserRound,
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
import type { AIProviderConfig, AILayer, ProviderId, SceneProviderConfig } from '@/lib/providers/types';
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

export type SettingsTabId = 'profile' | 'provider' | 'api-keys' | 'scenes' | 'autonomy' | 'mcp' | 'messaging';
export type SettingsFocusTarget = 'third-party-provider' | null;

type ThirdPartyProviderPresetId = 'deepseek' | 'groq' | 'ollama' | 'openai-compatible' | 'custom';

type ThirdPartyTestState = {
  status: 'idle' | 'testing' | 'ok' | 'invalid' | 'error';
  message?: string;
};

type ProviderActionState = {
  status: 'idle' | 'saving' | 'ok' | 'error';
  message?: string;
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

const SETTINGS_TABS: Array<{ value: SettingsTabId; label: string; icon: React.ReactNode }> = [
  { value: 'profile', label: 'Profile 偏好', icon: <UserRound className="mr-1.5 h-3.5 w-3.5" /> },
  { value: 'provider', label: 'Provider 配置', icon: <Layers className="mr-1.5 h-3.5 w-3.5" /> },
  { value: 'api-keys', label: 'API Keys', icon: <Key className="mr-1.5 h-3.5 w-3.5" /> },
  { value: 'scenes', label: 'Scene 覆盖', icon: <Map className="mr-1.5 h-3.5 w-3.5" /> },
  { value: 'autonomy', label: 'Autonomy 预算', icon: <Activity className="mr-1.5 h-3.5 w-3.5" /> },
  { value: 'mcp', label: 'MCP 服务器', icon: <Plug className="mr-1.5 h-3.5 w-3.5" /> },
  { value: 'messaging', label: '消息平台', icon: <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> },
];

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

function ProviderSelect({
  value,
  onChange,
  providerInventory,
  customProvider,
}: {
  value: ProviderId;
  onChange: (v: ProviderId) => void;
  providerInventory: ProviderInventory | null;
  customProvider?: AIProviderConfig['customProvider'];
}) {
  const options = getSelectableProviderOptions(providerInventory, customProvider, value);

  return (
    <Select value={value} onValueChange={(v) => onChange(v as ProviderId)}>
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
  focusThirdParty = false,
  focusRequestToken = 0,
}: {
  initialConfig: AIProviderConfig | null;
  providerInventory: ProviderInventory | null;
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
  const [showLayerConfig, setShowLayerConfig] = useState(false);
  const [showProviderMatrix, setShowProviderMatrix] = useState(false);
  const thirdPartySectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setConfig(initialConfig);
    setThirdPartyPreset(inferThirdPartyPreset(initialConfig));
    setThirdPartyTest({ status: 'idle' });
    setThirdPartyAction({ status: 'idle' });
  }, [initialConfig]);

  useEffect(() => {
    if (focusThirdParty && focusRequestToken > 0) {
      window.setTimeout(() => {
        thirdPartySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [focusThirdParty, focusRequestToken]);

  const checkProviderHealth = useCallback((providerId: ProviderId, customProvider?: AIProviderConfig['customProvider']) => {
    if (!providerInventory && providerId !== 'antigravity' && !(providerId === 'custom' && isCustomProviderConfigured(customProvider))) {
      setProviderStatus(prev => ({ ...prev, [providerId]: 'unknown' }));
      return;
    }

    setProviderStatus(prev => ({
      ...prev,
      [providerId]: isProviderAvailable(providerId, providerInventory, customProvider) ? 'ok' : 'error',
    }));
  }, [providerInventory]);

  useEffect(() => {
    if (!config) return;
    const providers = new Set<ProviderId>([config.defaultProvider]);
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

  const getLayerProvider = useCallback(
    (layer: AILayer): ProviderId => config?.layers?.[layer]?.provider ?? config?.defaultProvider ?? 'antigravity',
    [config],
  );

  const getLayerModel = useCallback(
    (layer: AILayer): string => config?.layers?.[layer]?.model ?? '',
    [config],
  );

  const setDefaultProvider = (provider: ProviderId) => {
    setConfig(prev => (prev ? { ...prev, defaultProvider: provider } : prev));
    checkProviderHealth(provider, config?.customProvider);
  };

  const setDefaultModel = (model: string) => {
    setConfig(prev => (prev ? { ...prev, defaultModel: model || undefined } : prev));
  };

  const setLayerProvider = (layer: AILayer, provider: ProviderId) => {
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

  const setCustomField = (field: keyof NonNullable<AIProviderConfig['customProvider']>, value: string) => {
    setConfig(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        customProvider: {
          ...(prev.customProvider ?? {}),
          [field]: value || undefined,
        },
      };
    });
    setThirdPartyAction({ status: 'idle' });
  };

  const applyThirdPartyPreset = (presetId: ThirdPartyProviderPresetId) => {
    const preset = getThirdPartyPreset(presetId);
    setThirdPartyPreset(presetId);
    setThirdPartyTest({ status: 'idle' });
    setThirdPartyAction({ status: 'idle' });
    setConfig(prev => {
      if (!prev) return prev;
      const previous = prev.customProvider ?? {};
      const keepExisting = previous.vendor === presetId;
      return {
        ...prev,
        customProvider: {
          vendor: presetId,
          name: keepExisting ? (previous.name ?? preset.defaultName) : preset.defaultName,
          baseUrl: keepExisting ? (previous.baseUrl ?? preset.defaultBaseUrl) : preset.defaultBaseUrl,
          apiKey: keepExisting ? (previous.apiKey ?? '') : '',
          defaultModel: keepExisting ? (previous.defaultModel ?? preset.defaultModel) : preset.defaultModel,
        },
      };
    });
  };

  const persistConfig = useCallback(async (nextConfig: AIProviderConfig, successMessage: string) => {
    setThirdPartyAction({ status: 'saving', message: '正在保存配置…' });
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
      setThirdPartyAction({ status: 'ok', message: successMessage });
      checkProviderHealth('custom', nextConfig.customProvider);
      return true;
    } catch (err) {
      setThirdPartyAction({
        status: 'error',
        message: err instanceof Error ? err.message : 'Save failed',
      });
      return false;
    }
  }, [checkProviderHealth]);

  const handleTestThirdParty = async () => {
    const customProvider = config?.customProvider;
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
        setThirdPartyTest({ status: 'ok', message: '连接成功，可用于 OpenAI-compatible 请求。' });
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
    await persistConfig(config, '第三方连接信息已保存。');
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

  const customProvider = config.customProvider ?? {};
  const customProviderReady = isCustomProviderConfigured(customProvider);
  const customProviderConnected = thirdPartyTest.status === 'ok';
  const layerOverrideCount = Object.values(config.layers ?? {})
    .filter((layer) => Boolean(layer?.provider || layer?.model))
    .length;
  const providerMatrix = [
    {
      id: 'claude-api',
      title: 'Claude API',
      summary: 'Anthropic 官方 API，适合直连 Claude 模型。',
      status: providerInventory?.anthropic.set ? 'ready' : 'needs-key',
      detail: providerInventory?.anthropic.set ? 'Anthropic API Key 已配置' : '需要在 API Keys 中设置 Anthropic key',
    },
    {
      id: 'claude-code',
      title: 'Claude Code',
      summary: '本地 Claude Code CLI / 会话壳，适合复用现有 Claude 工作流。',
      status: providerInventory?.providers.claudeCode.installed
        ? (providerInventory?.providers.claudeCode.loginDetected ? 'ready' : 'login-needed')
        : 'not-installed',
      detail: providerInventory?.providers.claudeCode.installed
        ? (providerInventory?.providers.claudeCode.loginDetected ? '检测到本地 Claude 配置' : '已检测到 CLI，但未发现登录配置')
        : '未检测到 claude CLI 或本地 Claude Code 安装',
    },
    {
      id: 'native-codex',
      title: 'Codex Native',
      summary: '直接读取 ~/.codex/auth.json，复用本机 Codex 登录态。',
      status: providerInventory?.providers.nativeCodex.loggedIn
        ? 'ready'
        : providerInventory?.providers.nativeCodex.installed
          ? 'login-needed'
          : 'not-installed',
      detail: providerInventory?.providers.nativeCodex.loggedIn
        ? '已检测到 Codex OAuth 登录'
        : providerInventory?.providers.nativeCodex.installed
          ? 'Codex 已安装，但未检测到 auth.json'
          : '未检测到 codex 可执行文件',
    },
    {
      id: 'codex',
      title: 'Codex (MCP)',
      summary: '基于 codex MCP 的旧执行路径，适合兼容已有 codex CLI。',
      status: providerInventory?.providers.codex.installed ? 'ready' : 'not-installed',
      detail: providerInventory?.providers.codex.installed ? '已检测到 codex 命令' : '未检测到 codex 命令',
    },
    {
      id: 'openai-api',
      title: 'OpenAI API',
      summary: '官方 OpenAI API Key 路径。',
      status: providerInventory?.openai.set ? 'ready' : 'needs-key',
      detail: providerInventory?.openai.set ? 'OpenAI API Key 已配置' : '需要在 API Keys 中设置 OpenAI key',
    },
    {
      id: 'gemini-api',
      title: 'Gemini API',
      summary: 'Gemini REST API 路径，复用 Claude-Engine 多 provider 层。',
      status: providerInventory?.gemini.set ? 'ready' : 'needs-key',
      detail: providerInventory?.gemini.set ? 'Gemini API Key 已配置' : '需要在 API Keys 中设置 Gemini key',
    },
    {
      id: 'grok-api',
      title: 'Grok API',
      summary: 'xAI / Grok API 路径，复用 OpenAI-compatible 流适配。',
      status: providerInventory?.grok.set ? 'ready' : 'needs-key',
      detail: providerInventory?.grok.set ? 'Grok API Key 已配置' : '需要在 API Keys 中设置 Grok key',
    },
    {
      id: 'custom',
      title: 'OpenAI Compatible',
      summary: 'DeepSeek / Ollama / 代理网关 / 私有部署统一走这一层。',
      status: customProviderReady ? (customProviderConnected ? 'ready' : 'configured') : 'needs-config',
      detail: customProviderReady
        ? (customProviderConnected ? '第三方 profile 已测试通过' : '第三方 profile 已填写，建议先测试连接')
        : '请先完成上方第三方连接信息',
    },
  ] as const;

  const StatusDot = ({ providerId }: { providerId: string }) => {
    const status = providerStatus[providerId];
    if (!status || status === 'unknown') return null;
    if (status === 'checking') return <Loader2 className="h-3 w-3 animate-spin text-[var(--app-text-muted)]" />;
    if (status === 'ok') return <div className="h-2 w-2 rounded-full bg-emerald-400" title="已连接" />;
      return <div className="h-2 w-2 rounded-full bg-red-400" title="未配置或连接失败" />;
  };

  const MatrixStatusBadge = ({ status }: { status: typeof providerMatrix[number]['status'] }) => {
    const tones: Record<string, WorkspacePrimitiveTone> = {
      ready: 'success',
      configured: 'info',
      'needs-key': 'warning',
      'needs-config': 'warning',
      'login-needed': 'warning',
      'not-installed': 'neutral',
    };
    const labelMap: Record<string, string> = {
      ready: 'Ready',
      configured: 'Configured',
      'needs-key': 'Needs Key',
      'needs-config': 'Needs Config',
      'login-needed': 'Needs Login',
      'not-installed': 'Not Installed',
    };

    return (
      <WorkspaceBadge tone={tones[status] ?? 'neutral'}>
        {labelMap[status]}
      </WorkspaceBadge>
    );
  };

  return (
    <div className="space-y-5">
      <Card ref={thirdPartySectionRef} className="border-sky-400/15 bg-[linear-gradient(180deg,#ffffff,#f4f8ff)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <SectionTitle icon={<Globe className="h-4 w-4" />}>第三方连接信息</SectionTitle>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <WorkspaceBadge>DeepSeek</WorkspaceBadge>
              <WorkspaceBadge>Groq</WorkspaceBadge>
              <WorkspaceBadge>Ollama</WorkspaceBadge>
              <WorkspaceBadge>Custom endpoint</WorkspaceBadge>
            </div>
          </div>

          <div className="min-w-[240px] rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-muted)]">Current profile</div>
            <div className="mt-2 text-base font-semibold text-[var(--app-text)]">{customProvider.name || selectedPreset.defaultName}</div>
            <div className="mt-1 text-xs text-[var(--app-text-soft)]">
              {customProvider.vendor ? `Preset: ${customProvider.vendor}` : '未保存第三方 profile'}
            </div>
            <div className="mt-3 space-y-1 text-xs text-[var(--app-text-soft)]">
              <div className="truncate">Endpoint: {customProvider.baseUrl || selectedPreset.endpointHint}</div>
              <div>Model: {customProvider.defaultModel || selectedPreset.modelHint}</div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          {THIRD_PARTY_PRESETS.map((preset) => {
            const active = preset.id === thirdPartyPreset;
            return (
              <button
                key={preset.id}
                type="button"
                className={cn(
                  'rounded-2xl border p-4 text-left transition-all',
                  active
                    ? 'border-sky-400/35 bg-sky-400/[0.08] shadow-[0_18px_44px_rgba(14,165,233,0.12)]'
                    : 'border-[var(--app-border-soft)] bg-[var(--app-surface)] hover:bg-[var(--app-raised)]',
                )}
                onClick={() => applyThirdPartyPreset(preset.id)}
              >
                <div className="flex items-center gap-2">
                  <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl border', active ? 'border-sky-400/30 bg-sky-400/10 text-sky-700' : 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-soft)]')}>
                    {preset.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--app-text)]">{preset.title}</div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">{preset.deployment}</div>
                  </div>
                </div>
                <div className="mt-3 text-xs leading-5 text-[var(--app-text-soft)]">{preset.description}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 space-y-4 rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--app-text)]">连接配置</div>
              </div>
              <WorkspaceBadge tone="accent">
                {selectedPreset.title}
              </WorkspaceBadge>
            </div>

            <FieldRow label="显示名称">
              <Input
                value={customProvider.name ?? ''}
                onChange={(e) => setCustomField('name', e.target.value)}
                placeholder={selectedPreset.defaultName}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </FieldRow>
            <FieldRow label="API Base URL">
              <Input
                value={customProvider.baseUrl ?? ''}
                onChange={(e) => setCustomField('baseUrl', e.target.value)}
                placeholder={selectedPreset.endpointHint}
                className={cn('h-9 rounded-lg font-mono text-xs', workspaceFieldClassName)}
              />
            </FieldRow>
            <FieldRow label="API Key">
              <Input
                type="password"
                value={customProvider.apiKey ?? ''}
                onChange={(e) => setCustomField('apiKey', e.target.value)}
                placeholder="sk-..."
                className={cn('h-9 rounded-lg font-mono text-xs', workspaceFieldClassName)}
              />
            </FieldRow>
            <FieldRow label="默认模型">
              <Input
                value={customProvider.defaultModel ?? ''}
                onChange={(e) => setCustomField('defaultModel', e.target.value)}
                placeholder={selectedPreset.modelHint}
                className={cn('h-9 rounded-lg font-mono text-xs', workspaceFieldClassName)}
              />
            </FieldRow>

            <div className="rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3 text-xs leading-6 text-[var(--app-text-soft)]">
              <div><span className="text-[var(--app-text-muted)]">部署形态：</span>{selectedPreset.deployment}</div>
              <div><span className="text-[var(--app-text-muted)]">端点提示：</span>{selectedPreset.endpointHint}</div>
              <div><span className="text-[var(--app-text-muted)]">推荐模型：</span>{selectedPreset.modelHint}</div>
              <div><span className="text-[var(--app-text-muted)]">备注：</span>{selectedPreset.notes}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestThirdParty}
                disabled={!customProvider.apiKey || !customProvider.baseUrl || thirdPartyTest.status === 'testing'}
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
                disabled={!customProviderReady || thirdPartyAction.status === 'saving'}
                className="bg-sky-500 text-white hover:bg-sky-400"
              >
                {thirdPartyAction.status === 'saving' ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CircleCheck className="mr-1.5 h-3.5 w-3.5" />
                )}
                保存连接信息
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
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle icon={<Layers className="h-4 w-4" />}>运行 Provider</SectionTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowProviderMatrix((value) => !value)}
            className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
          >
            {showProviderMatrix ? '收起诊断' : 'Provider 诊断'}
          </Button>
        </div>
        <div className="space-y-3">
          <FieldRow label="组织默认">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <ProviderSelect
                  value={config.defaultProvider}
                  onChange={setDefaultProvider}
                  providerInventory={providerInventory}
                  customProvider={config.customProvider}
                />
              </div>
              <StatusDot providerId={config.defaultProvider} />
            </div>
          </FieldRow>
          {!isProviderAvailable(config.defaultProvider, providerInventory, config.customProvider) ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700">
              当前运行 Provider <code className="font-mono text-amber-800">{PROVIDER_LABELS[config.defaultProvider]}</code> 未配置，必须切换到可用 Provider 后才能保存。
            </div>
          ) : null}
          {config.defaultProvider === 'custom' ? (
            <div className="rounded-lg border border-sky-400/15 bg-sky-400/[0.08] px-4 py-3 text-xs text-sky-700">
              当前组织默认已指向第三方连接信息。端点、key 或模型在上方维护。
            </div>
          ) : null}
          <FieldRow label="组织默认 Model">
            <Input
              value={config.defaultModel ?? ''}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="留空使用 provider 默认"
              className={cn('h-8 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </FieldRow>
        </div>

        {showProviderMatrix ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {providerMatrix.map((item) => (
              <div key={item.id} className="rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--app-text)]">{item.title}</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--app-text-soft)]">{item.summary}</div>
                  </div>
                  <MatrixStatusBadge status={item.status} />
                </div>
                <div className="mt-4 text-xs leading-5 text-[var(--app-text-soft)]">{item.detail}</div>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle icon={<Layers className="h-4 w-4" />}>高级覆盖</SectionTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowLayerConfig((value) => !value)}
            className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
          >
            {showLayerConfig ? '收起' : `展开${layerOverrideCount ? ` · ${layerOverrideCount}` : ''}`}
          </Button>
        </div>
        {showLayerConfig ? (
          <div className="space-y-3">
            {LAYERS.map((layer) => {
              const layerProvider = getLayerProvider(layer);
              const layerProviderAvailable = isProviderAvailable(layerProvider, providerInventory, config.customProvider);
              return (
                <div key={layer} className="space-y-2 rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-3">
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
                        customProvider={config.customProvider}
                      />
                    </FieldRow>
                    <FieldRow label="Model">
                      <Input
                        value={getLayerModel(layer)}
                        onChange={(e) => setLayerModel(layer, e.target.value)}
                        placeholder="继承默认"
                        className={cn('h-8 rounded-lg text-xs', workspaceFieldClassName)}
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
                      该 layer 已使用第三方连接信息。端点、key 或模型在上方维护。
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3 text-xs text-[var(--app-text-soft)]">
            未设置 layer override。
          </div>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="bg-sky-500 px-4 font-medium text-white hover:bg-sky-400"
        >
          {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
          保存运行配置
        </Button>
        <SaveFeedback saved={saved} error={saveError} />
        {customProviderConnected ? (
          <span className="text-xs text-emerald-400">最近一次第三方连接测试已通过</span>
        ) : null}
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
  const [cooldownDraft, setCooldownDraft] = useState('');
  const [departmentCooldownDraft, setDepartmentCooldownDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setSaveError(null);
    try {
      const [organizationRes, departmentRes, loopRes] = await Promise.all([
        fetch('/api/company/budget/policies?scope=organization&period=day&pageSize=1'),
        fetch(`/api/company/budget/policies/${encodeURIComponent(DEPARTMENT_DEFAULT_BUDGET_POLICY_ID)}`),
        fetch(`/api/company/loops/policies/${encodeURIComponent(ORGANIZATION_LOOP_POLICY_ID)}`),
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
      setPolicy(nextPolicy);
      setDepartmentPolicy(nextDepartmentPolicy);
      setLoopPolicy(nextLoopPolicy);
      setCooldownDraft(cooldownToDraft(nextPolicy));
      setDepartmentCooldownDraft(cooldownToDraft(nextDepartmentPolicy));
    } catch (err) {
      const fallback = buildDefaultOrganizationBudgetPolicy();
      const departmentFallback = buildDefaultDepartmentBudgetPolicy();
      setPolicy(fallback);
      setDepartmentPolicy(departmentFallback);
      setLoopPolicy(buildDefaultCompanyLoopPolicy());
      setCooldownDraft(cooldownToDraft(fallback));
      setDepartmentCooldownDraft(cooldownToDraft(departmentFallback));
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

  return (
    <div className="space-y-5">
      <Card className="border-sky-400/15 bg-[linear-gradient(180deg,#ffffff,#f4f8ff)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <SectionTitle icon={<Activity className="h-4 w-4" />}>组织自运营预算</SectionTitle>
            <p className="max-w-2xl text-xs leading-6 text-[var(--app-text-soft)]">
              这里控制 autonomous agenda、scheduler、growth proposal 的预算闸门。手动任务仍会记录 ledger，但不消耗 autonomous dispatch quota。
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3 text-xs leading-6 text-[var(--app-text-soft)]">
            <div><span className="text-[var(--app-text-muted)]">Policy:</span> {policy.id}</div>
            <div><span className="text-[var(--app-text-muted)]">Scope:</span> organization / day</div>
            <div><span className="text-[var(--app-text-muted)]">Mode:</span> {policy.hardStop ? 'hard stop' : 'warn only'}</div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FieldRow label="Max tokens">
            <Input
              type="number"
              value={policy.maxTokens}
              onChange={(event) => updateNumber('organization', 'maxTokens', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </FieldRow>
          <FieldRow label="Max minutes">
            <Input
              type="number"
              value={policy.maxMinutes}
              onChange={(event) => updateNumber('organization', 'maxMinutes', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </FieldRow>
          <FieldRow label="Dispatch cap">
            <Input
              type="number"
              value={policy.maxDispatches}
              onChange={(event) => updateNumber('organization', 'maxDispatches', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </FieldRow>
          <FieldRow label="Concurrent">
            <Input
              type="number"
              value={policy.maxConcurrentRuns ?? 0}
              onChange={(event) => updateNumber('organization', 'maxConcurrentRuns', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </FieldRow>
        </div>
      </Card>

      <Card className="border-emerald-400/15 bg-[linear-gradient(180deg,#ffffff,#f5fbf8)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <SectionTitle icon={<Layers className="h-4 w-4" />}>部门默认预算</SectionTitle>
            <p className="max-w-2xl text-xs leading-6 text-[var(--app-text-soft)]">
              新部门或未配置专属 budget policy 的部门会继承这组默认值；已有专属策略不会被覆盖。
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3 text-xs leading-6 text-[var(--app-text-soft)]">
            <div><span className="text-[var(--app-text-muted)]">Policy:</span> {departmentPolicy.id}</div>
            <div><span className="text-[var(--app-text-muted)]">Scope:</span> department / default / day</div>
            <div><span className="text-[var(--app-text-muted)]">Mode:</span> {departmentPolicy.hardStop ? 'hard stop' : 'warn only'}</div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FieldRow label="Max tokens">
            <Input
              type="number"
              value={departmentPolicy.maxTokens}
              onChange={(event) => updateNumber('department', 'maxTokens', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </FieldRow>
          <FieldRow label="Max minutes">
            <Input
              type="number"
              value={departmentPolicy.maxMinutes}
              onChange={(event) => updateNumber('department', 'maxMinutes', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </FieldRow>
          <FieldRow label="Dispatch cap">
            <Input
              type="number"
              value={departmentPolicy.maxDispatches}
              onChange={(event) => updateNumber('department', 'maxDispatches', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </FieldRow>
          <FieldRow label="Concurrent">
            <Input
              type="number"
              value={departmentPolicy.maxConcurrentRuns ?? 0}
              onChange={(event) => updateNumber('department', 'maxConcurrentRuns', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </FieldRow>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.85fr]">
          <FieldRow label="Department cooldown">
            <textarea
              value={departmentCooldownDraft}
              onChange={(event) => setDepartmentCooldownDraft(event.target.value)}
              spellCheck={false}
              className={cn('min-h-[120px] w-full resize-y rounded-2xl border px-4 py-3 font-mono text-xs leading-6 outline-none', workspaceFieldClassName)}
              placeholder={'manual.prompt=0\nmanual.template=0\nagenda.dispatch=10'}
            />
          </FieldRow>
          <div className="grid gap-3 md:grid-cols-2">
            <FieldRow label="Failure count">
              <Input
                type="number"
                value={departmentPolicy.failureBudget?.maxConsecutiveFailures ?? 3}
                onChange={(event) => updateFailureBudget('department', 'maxConsecutiveFailures', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </FieldRow>
            <FieldRow label="Cooldown min">
              <Input
                type="number"
                value={departmentPolicy.failureBudget?.coolDownMinutes ?? 30}
                onChange={(event) => updateFailureBudget('department', 'coolDownMinutes', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </FieldRow>
            <FieldRow label="Warn ratio">
              <Input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={departmentPolicy.warningThreshold}
                onChange={(event) => updateNumber('department', 'warningThreshold', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </FieldRow>
            <label className="flex items-center gap-2 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-2 text-xs text-[var(--app-text-soft)]">
              <input
                type="checkbox"
                checked={departmentPolicy.hardStop}
                onChange={(event) => setDepartmentPolicy((prev) => prev ? { ...prev, hardStop: event.target.checked } : prev)}
              />
              Hard stop
            </label>
          </div>
        </div>
      </Card>

      <Card className="border-blue-400/15 bg-[linear-gradient(180deg,#ffffff,#f5f8ff)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <SectionTitle icon={<RefreshCw className="h-4 w-4" />}>公司循环策略</SectionTitle>
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-3 py-2 text-xs text-[var(--app-text-soft)]">
            <input
              type="checkbox"
              checked={loopPolicy.enabled}
              onChange={(event) => setLoopPolicy((prev) => prev ? { ...prev, enabled: event.target.checked } : prev)}
            />
            Enabled
          </label>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <FieldRow label="Timezone">
            <Input
              value={loopPolicy.timezone}
              onChange={(event) => setLoopPolicy((prev) => prev ? { ...prev, timezone: event.target.value } : prev)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </FieldRow>
          <FieldRow label="Daily hour">
            <Input
              type="number"
              min="0"
              max="23"
              value={loopPolicy.dailyReviewHour}
              onChange={(event) => updateLoopNumber('dailyReviewHour', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </FieldRow>
          <FieldRow label="Weekly day">
            <Input
              type="number"
              min="0"
              max="6"
              value={loopPolicy.weeklyReviewDay}
              onChange={(event) => updateLoopNumber('weeklyReviewDay', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </FieldRow>
          <FieldRow label="Weekly hour">
            <Input
              type="number"
              min="0"
              max="23"
              value={loopPolicy.weeklyReviewHour}
              onChange={(event) => updateLoopNumber('weeklyReviewHour', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </FieldRow>
          <FieldRow label="Top agenda">
            <Input
              type="number"
              value={loopPolicy.maxAgendaPerDailyLoop}
              onChange={(event) => updateLoopNumber('maxAgendaPerDailyLoop', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </FieldRow>
          <FieldRow label="Dispatch cap">
            <Input
              type="number"
              value={loopPolicy.maxAutonomousDispatchesPerLoop}
              onChange={(event) => updateLoopNumber('maxAutonomousDispatchesPerLoop', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </FieldRow>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-xs text-[var(--app-text-soft)]">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={loopPolicy.growthReviewEnabled}
              onChange={(event) => setLoopPolicy((prev) => prev ? { ...prev, growthReviewEnabled: event.target.checked } : prev)}
            />
            Growth review
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
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-muted)]">Notification channels</div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--app-text-soft)]">
            {(['web', 'email', 'webhook'] as CompanyLoopPolicyFE['notificationChannels']).map((channel) => (
              <label key={channel} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={loopPolicy.notificationChannels.includes(channel)}
                  onChange={(event) => setLoopPolicy((prev) => {
                    if (!prev) return prev;
                    const nextChannels = event.target.checked
                      ? Array.from(new Set([...prev.notificationChannels, channel]))
                      : prev.notificationChannels.filter((item) => item !== channel);
                    return { ...prev, notificationChannels: nextChannels };
                  })}
                />
                {channel}
              </label>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
        <Card>
          <SectionTitle icon={<RefreshCw className="h-4 w-4" />}>Operation cooldown</SectionTitle>
          <textarea
            value={cooldownDraft}
            onChange={(event) => setCooldownDraft(event.target.value)}
            spellCheck={false}
            className={cn('min-h-[180px] w-full resize-y rounded-2xl border px-4 py-3 font-mono text-xs leading-6 outline-none', workspaceFieldClassName)}
            placeholder={'growth.generate=60\ngrowth.evaluate=15\nagenda.dispatch=10'}
          />
          <p className="mt-3 text-xs leading-6 text-[var(--app-text-soft)]">
            每行一个 `operationKind=minutes`。budget gate 会按 ledger metadata 拦截冷却期内重复动作。
          </p>
        </Card>

        <Card>
          <SectionTitle icon={<ShieldAlert className="h-4 w-4" />}>风险与熔断</SectionTitle>
          <div className="space-y-3">
            <FieldRow label="Failure count">
              <Input
                type="number"
                value={policy.failureBudget?.maxConsecutiveFailures ?? 3}
                onChange={(event) => updateFailureBudget('organization', 'maxConsecutiveFailures', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </FieldRow>
            <FieldRow label="Cooldown min">
              <Input
                type="number"
                value={policy.failureBudget?.coolDownMinutes ?? 30}
                onChange={(event) => updateFailureBudget('organization', 'coolDownMinutes', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </FieldRow>
            <FieldRow label="Warn ratio">
              <Input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={policy.warningThreshold}
                onChange={(event) => updateNumber('organization', 'warningThreshold', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </FieldRow>
            <FieldRow label="Approval risk">
              <Input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={highRiskApprovalThreshold}
                onChange={(event) => updateApprovalThreshold(event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </FieldRow>
            <label className="flex items-center gap-2 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-2 text-xs text-[var(--app-text-soft)]">
              <input
                type="checkbox"
                checked={policy.hardStop}
                onChange={(event) => setPolicy((prev) => prev ? { ...prev, hardStop: event.target.checked } : prev)}
              />
              Hard stop when budget is exceeded
            </label>
          </div>
        </Card>
      </div>

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
// Tab 3: API Key Management
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
          保存 Keys
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
  const [newProvider, setNewProvider] = useState<ProviderId>('antigravity');
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
          [key]: { ...existing, [field]: field === 'provider' ? (value as ProviderId) : value || undefined },
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
        <SectionTitle icon={<Map className="h-4 w-4" />}>Scene 覆盖配置</SectionTitle>
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
                    customProvider={config.customProvider}
                  />
                  <Input
                    value={scene.model ?? ''}
                    onChange={(e) => updateScene(key, 'model', e.target.value)}
                    placeholder="继承默认"
                    className={cn('h-8 rounded-lg text-xs', workspaceFieldClassName)}
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
              customProvider={config.customProvider}
            />
            <Input
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              placeholder="Model（可选）"
              className={cn('h-8 w-32 rounded-lg text-xs', workspaceFieldClassName)}
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
  requestedTab = 'provider',
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

  return (
    <WorkspaceSurface padding="none" className="overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,#ffffff,#f7faff)] shadow-[0_24px_60px_rgba(28,44,73,0.08)]">
      {configLoading ? (
        <div className="flex items-center gap-2 px-6 py-12 text-sm text-[var(--app-text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : configError ? (
        <SettingsBackendUnavailable error={configError} />
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(value) => value && setActiveTab(value as SettingsTabId)}
          className="flex flex-col"
        >
          <div className="border-b border-[var(--app-border-soft)] px-6 pt-4 pb-0">
            <WorkspaceTabsList variant="underline">
              {SETTINGS_TABS.map((tab) => (
                <WorkspaceTabsTrigger
                  key={tab.value}
                  value={tab.value}
                  variant="underline"
                >
                  {tab.icon}
                  {tab.label}
                </WorkspaceTabsTrigger>
              ))}
            </WorkspaceTabsList>
          </div>

          <TabsContent value="profile" className="p-6">
            <CEOProfileSettingsTab />
          </TabsContent>
          <TabsContent value="provider" className="p-6">
            <ProviderConfigTab
              initialConfig={config}
              providerInventory={providerInventory}
              focusThirdParty={focusTarget === 'third-party-provider'}
              focusRequestToken={requestToken}
            />
          </TabsContent>
          <TabsContent value="api-keys" className="p-6">
            <ApiKeysTab onInventoryChanged={setProviderInventory} />
          </TabsContent>
          <TabsContent value="scenes" className="p-6">
            <SceneOverridesTab initialConfig={config} providerInventory={providerInventory} />
          </TabsContent>
          <TabsContent value="autonomy" className="p-6">
            <AutonomyBudgetTab />
          </TabsContent>
          <TabsContent value="mcp" className="p-6">
            <McpServersTab />
          </TabsContent>
          <TabsContent value="messaging" className="p-6">
            <CcConnectTab />
          </TabsContent>
        </Tabs>
      )}
    </WorkspaceSurface>
  );
}
