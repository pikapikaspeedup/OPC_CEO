'use client';

import { useState, useEffect, useCallback, useMemo, useRef, forwardRef } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  Plug,
  Terminal,
  Activity,
  Globe,
  MessageCircle,
  ArrowRight,
  CircleCheck,
  Cpu,
  Network,
  ServerCog,
  Wand2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import CcConnectTab from '@/components/cc-connect-tab';
import type { AIProviderConfig, AILayer, ProviderId, SceneProviderConfig } from '@/lib/providers/types';
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

export type SettingsTabId = 'provider' | 'api-keys' | 'scenes' | 'mcp' | 'messaging';
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
  { value: 'provider', label: 'Provider 配置', icon: <Layers className="mr-1.5 h-3.5 w-3.5" /> },
  { value: 'api-keys', label: 'API Keys', icon: <Key className="mr-1.5 h-3.5 w-3.5" /> },
  { value: 'scenes', label: 'Scene 覆盖', icon: <Map className="mr-1.5 h-3.5 w-3.5" /> },
  { value: 'mcp', label: 'MCP 服务器', icon: <Plug className="mr-1.5 h-3.5 w-3.5" /> },
  { value: 'messaging', label: '消息平台', icon: <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-sky-400">{icon}</span>
      <h3 className="text-sm font-semibold text-white">{children}</h3>
    </div>
  );
}

const Card = forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string }>(
  function Card({ children, className }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-xl border border-white/8 bg-white/[0.025] p-4',
          className,
        )}
      >
        {children}
      </div>
    );
  },
);

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
      <label className="w-32 shrink-0 text-xs text-white/50">{label}</label>
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
      <SelectTrigger className="h-8 rounded-lg border-white/8 bg-white/[0.04] text-xs text-white/80">
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
    await persistConfig(config, '第三方 Provider 配置已保存。');
  };

  const handleApplyThirdPartyAsDefault = async () => {
    if (!config) return;
    const nextConfig: AIProviderConfig = {
      ...config,
      defaultProvider: 'custom',
      defaultModel: config.customProvider?.defaultModel || config.defaultModel,
    };
    await persistConfig(nextConfig, '已应用为组织默认 Provider。');
  };

  const handleApplyThirdPartyToLayer = async (layer: AILayer) => {
    if (!config) return;
    const nextConfig: AIProviderConfig = {
      ...config,
      layers: {
        ...config.layers,
        [layer]: {
          ...(config.layers?.[layer] ?? {}),
          provider: 'custom',
          model: config.customProvider?.defaultModel || config.layers?.[layer]?.model,
        },
      },
    };
    await persistConfig(nextConfig, `已应用到 ${LAYER_LABELS[layer]} 层。`);
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
      <div className="flex items-center gap-2 py-8 text-sm text-white/40">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading config…
      </div>
    );
  }

  const customProvider = config.customProvider ?? {};
  const customProviderReady = isCustomProviderConfigured(customProvider);
  const customProviderConnected = thirdPartyTest.status === 'ok';
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
        : '请先完成上方第三方 Provider onboarding',
    },
  ] as const;

  const StatusDot = ({ providerId }: { providerId: string }) => {
    const status = providerStatus[providerId];
    if (!status || status === 'unknown') return null;
    if (status === 'checking') return <Loader2 className="h-3 w-3 animate-spin text-white/30" />;
    if (status === 'ok') return <div className="h-2 w-2 rounded-full bg-emerald-400" title="已连接" />;
      return <div className="h-2 w-2 rounded-full bg-red-400" title="未配置或连接失败" />;
  };

  const MatrixStatusBadge = ({ status }: { status: typeof providerMatrix[number]['status'] }) => {
    const styles: Record<string, string> = {
      ready: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
      configured: 'border-sky-500/20 bg-sky-500/10 text-sky-200',
      'needs-key': 'border-amber-500/20 bg-amber-500/10 text-amber-100',
      'needs-config': 'border-amber-500/20 bg-amber-500/10 text-amber-100',
      'login-needed': 'border-amber-500/20 bg-amber-500/10 text-amber-100',
      'not-installed': 'border-white/10 bg-white/[0.04] text-white/45',
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
      <span className={cn('inline-flex h-6 items-center rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em]', styles[status])}>
        {labelMap[status]}
      </span>
    );
  };

  return (
    <div className="space-y-5">
      <Card ref={thirdPartySectionRef} className="border-sky-400/15 bg-[linear-gradient(180deg,rgba(19,29,44,0.82),rgba(10,17,28,0.9))]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <SectionTitle icon={<Globe className="h-4 w-4" />}>OpenAI-compatible Provider Profiles</SectionTitle>
            <p className="text-sm leading-6 text-white/70">
              这里是“添加 + 配置 + 校验 + 应用” OpenAI-compatible profile 的主入口。当前支持 DeepSeek、Groq、Ollama，以及任意 OpenAI-compatible 端点。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/45">
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">单个活动 profile</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">统一映射到 custom provider</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">支持连通测试与即时应用</span>
            </div>
            <div className="mt-3 rounded-xl border border-white/8 bg-black/15 px-4 py-3 text-xs leading-6 text-white/55">
              官方 `Claude API / OpenAI API / Gemini API / Grok API` 仍通过下方 Provider 矩阵和 API Keys 区块单独配置；这里只有 OpenAI-compatible profile。
            </div>
          </div>

          <div className="min-w-[240px] rounded-2xl border border-white/8 bg-black/20 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Current profile</div>
            <div className="mt-2 text-base font-semibold text-white">{customProvider.name || selectedPreset.defaultName}</div>
            <div className="mt-1 text-xs text-white/45">
              {customProvider.vendor ? `Preset: ${customProvider.vendor}` : '未保存第三方 profile'}
            </div>
            <div className="mt-3 space-y-1 text-xs text-white/55">
              <div className="truncate">Endpoint: {customProvider.baseUrl || selectedPreset.endpointHint}</div>
              <div>Model: {customProvider.defaultModel || selectedPreset.modelHint}</div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
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
                    : 'border-white/8 bg-white/[0.025] hover:bg-white/[0.05]',
                )}
                onClick={() => applyThirdPartyPreset(preset.id)}
              >
                <div className="flex items-center gap-2">
                  <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl border', active ? 'border-sky-400/30 bg-sky-400/10 text-sky-300' : 'border-white/10 bg-white/[0.03] text-white/60')}>
                    {preset.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">{preset.title}</div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">{preset.deployment}</div>
                  </div>
                </div>
                <div className="mt-3 text-xs leading-5 text-white/55">{preset.description}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
          <div className="space-y-4 rounded-2xl border border-white/8 bg-black/15 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">连接配置</div>
                <div className="mt-1 text-xs text-white/45">
                  选择预设后填写连接信息；不需要先在默认 Provider 下拉里切到 Custom。
                </div>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-white/40">
                {selectedPreset.title}
              </div>
            </div>

            <FieldRow label="显示名称">
              <Input
                value={customProvider.name ?? ''}
                onChange={(e) => setCustomField('name', e.target.value)}
                placeholder={selectedPreset.defaultName}
                className="h-9 rounded-lg border-white/8 bg-white/[0.04] text-xs text-white/80 placeholder:text-white/20"
              />
            </FieldRow>
            <FieldRow label="API Base URL">
              <Input
                value={customProvider.baseUrl ?? ''}
                onChange={(e) => setCustomField('baseUrl', e.target.value)}
                placeholder={selectedPreset.endpointHint}
                className="h-9 rounded-lg border-white/8 bg-white/[0.04] font-mono text-xs text-white/80 placeholder:text-white/20"
              />
            </FieldRow>
            <FieldRow label="API Key">
              <Input
                type="password"
                value={customProvider.apiKey ?? ''}
                onChange={(e) => setCustomField('apiKey', e.target.value)}
                placeholder="sk-..."
                className="h-9 rounded-lg border-white/8 bg-white/[0.04] font-mono text-xs text-white/80 placeholder:text-white/20"
              />
            </FieldRow>
            <FieldRow label="默认模型">
              <Input
                value={customProvider.defaultModel ?? ''}
                onChange={(e) => setCustomField('defaultModel', e.target.value)}
                placeholder={selectedPreset.modelHint}
                className="h-9 rounded-lg border-white/8 bg-white/[0.04] font-mono text-xs text-white/80 placeholder:text-white/20"
              />
            </FieldRow>

            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-xs leading-6 text-white/55">
              <div><span className="text-white/35">部署形态：</span>{selectedPreset.deployment}</div>
              <div><span className="text-white/35">端点提示：</span>{selectedPreset.endpointHint}</div>
              <div><span className="text-white/35">推荐模型：</span>{selectedPreset.modelHint}</div>
              <div><span className="text-white/35">说明：</span>{selectedPreset.notes}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestThirdParty}
                disabled={!customProvider.apiKey || !customProvider.baseUrl || thirdPartyTest.status === 'testing'}
                className="border-white/10 bg-white/[0.04] text-xs text-white/70 hover:bg-white/[0.08] hover:text-white"
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
                保存 Provider 配置
              </Button>
            </div>

            {thirdPartyTest.status !== 'idle' ? (
              <div
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs',
                  thirdPartyTest.status === 'ok' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
                  thirdPartyTest.status === 'invalid' && 'border-red-500/20 bg-red-500/10 text-red-300',
                  thirdPartyTest.status === 'error' && 'border-amber-500/20 bg-amber-500/10 text-amber-300',
                  thirdPartyTest.status === 'testing' && 'border-white/10 bg-white/[0.04] text-white/55',
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
                  thirdPartyAction.status === 'saving' && 'border-white/10 bg-white/[0.04] text-white/55',
                )}
              >
                {thirdPartyAction.status === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : null}
                {thirdPartyAction.status === 'error' ? <XCircle className="h-3.5 w-3.5 shrink-0" /> : null}
                {thirdPartyAction.status === 'saving' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
                <span>{thirdPartyAction.message}</span>
              </div>
            ) : null}
          </div>

          <div className="space-y-4 rounded-2xl border border-white/8 bg-black/15 p-4">
            <div>
              <div className="text-sm font-semibold text-white">应用到运行配置</div>
              <div className="mt-1 text-xs text-white/45">
                先完成连接测试，再决定将当前第三方 Provider 应用到默认执行路径或某个 layer。
              </div>
            </div>

            <div className="space-y-2">
              <Button
                size="sm"
                onClick={handleApplyThirdPartyAsDefault}
                disabled={!customProviderReady || thirdPartyAction.status === 'saving'}
                className="w-full justify-between bg-white/[0.04] text-white hover:bg-white/[0.08]"
                variant="outline"
              >
                <span>设为组织默认 Provider</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
              {LAYERS.map((layer) => (
                <Button
                  key={layer}
                  size="sm"
                  onClick={() => handleApplyThirdPartyToLayer(layer)}
                  disabled={!customProviderReady || thirdPartyAction.status === 'saving'}
                  className="w-full justify-between border-white/10 bg-white/[0.03] text-white/75 hover:bg-white/[0.06] hover:text-white"
                  variant="outline"
                >
                  <span>应用到 {LAYER_LABELS[layer]}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ))}
            </div>

            <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.05] px-4 py-3 text-xs leading-6 text-amber-100/80">
              <div>1. “测试连接” 只校验端点与 key。</div>
              <div>2. “保存 Provider 配置” 只保存第三方 profile，不改默认路由。</div>
              <div>3. “应用到默认 / layer” 会把执行入口切到 `custom`，并立即保存。</div>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle icon={<ServerCog className="h-4 w-4" />}>Provider 支持矩阵</SectionTitle>
        <p className="mb-4 text-xs text-white/45">
          这里汇总当前所有 provider 的可用性：是否已安装、是否已登录、是否已配置 key，以及是否已经可以被立即应用到组织或 layer。
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {providerMatrix.map((item) => (
            <div key={item.id} className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">{item.title}</div>
                  <div className="mt-1 text-xs leading-5 text-white/45">{item.summary}</div>
                </div>
                <MatrixStatusBadge status={item.status} />
              </div>
              <div className="mt-4 text-xs leading-5 text-white/65">{item.detail}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle icon={<Layers className="h-4 w-4" />}>默认配置</SectionTitle>
        <div className="space-y-3">
          <FieldRow label="默认 Provider">
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
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-100/85">
              当前默认 Provider <code className="font-mono text-amber-50">{PROVIDER_LABELS[config.defaultProvider]}</code> 未配置，必须切换到可用 Provider 后才能保存。
            </div>
          ) : null}
          {config.defaultProvider === 'custom' ? (
            <div className="rounded-lg border border-sky-400/15 bg-sky-400/[0.04] px-4 py-3 text-xs text-sky-100/85">
              当前组织默认已指向 `custom`。如需修改连接信息，请先在上方“第三方 Provider”区块完成配置与测试。
            </div>
          ) : null}
          <FieldRow label="默认 Model">
            <Input
              value={config.defaultModel ?? ''}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="留空使用 provider 默认"
              className="h-8 rounded-lg border-white/8 bg-white/[0.04] text-xs text-white/80 placeholder:text-white/20"
            />
          </FieldRow>
        </div>
      </Card>

      <Card>
        <SectionTitle icon={<Layers className="h-4 w-4" />}>层级配置</SectionTitle>
        <div className="space-y-3">
          {LAYERS.map((layer) => {
            const layerProvider = getLayerProvider(layer);
            const layerProviderAvailable = isProviderAvailable(layerProvider, providerInventory, config.customProvider);
            return (
              <div key={layer} className="rounded-lg border border-white/5 bg-white/[0.02] p-3 space-y-2">
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
                      className="h-8 rounded-lg border-white/8 bg-white/[0.04] text-xs text-white/80 placeholder:text-white/20"
                    />
                  </FieldRow>
                </div>
                {!layerProviderAvailable ? (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/85">
                    当前 layer 指向 <code className="font-mono text-amber-50">{PROVIDER_LABELS[layerProvider]}</code>，但该 Provider 尚未配置。
                  </div>
                ) : null}
                {layerProvider === 'custom' ? (
                  <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-white/55">
                    该 layer 已使用第三方 Provider。若要调整端点、key 或模型，请返回上方“第三方 Provider”区块。
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="bg-sky-500 px-4 font-medium text-white hover:bg-sky-400"
        >
          {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
          保存组织配置
        </Button>
        <SaveFeedback saved={saved} error={saveError} />
        {customProviderConnected ? (
          <span className="text-xs text-emerald-400">最近一次第三方 Provider 测试已通过</span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: API Key Management
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
      {/* Anthropic */}
      <Card>
        <SectionTitle icon={<Key className="h-4 w-4" />}>Anthropic API Key</SectionTitle>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">状态：</span>
            {keyStatus.anthropic ? (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                已设置
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-white/30">
                <AlertCircle className="h-3 w-3" />
                未设置
              </span>
            )}
          </div>

          <FieldRow label="新 Key">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showAnthropicKey ? 'text' : 'password'}
                  value={anthropicKey}
                  onChange={(e) => {
                    setAnthropicKey(e.target.value);
                    setTestStatus('idle');
                  }}
                  placeholder={keyStatus.anthropic ? '输入新 key 以替换' : 'sk-ant-...'}
                  className="h-8 rounded-lg border-white/8 bg-white/[0.04] pr-9 text-xs text-white/80 placeholder:text-white/20"
                />
                <button
                  type="button"
                  onClick={() => setShowAnthropicKey((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                >
                  {showAnthropicKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestAnthropicKey}
                disabled={!anthropicKey.trim() || testStatus === 'testing'}
                className="shrink-0 border-white/10 bg-white/[0.04] text-xs text-white/60 hover:text-white hover:bg-white/[0.08]"
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

          {/* Test result */}
          {testStatus === 'ok' && (
            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              连接成功，Key 有效
            </div>
          )}
          {testStatus === 'invalid' && (
            <div className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <XCircle className="h-3.5 w-3.5 shrink-0" />
              {testError ?? 'Key 无效'}
            </div>
          )}
          {testStatus === 'error' && (
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {testError ?? '测试失败'}
            </div>
          )}
        </div>
      </Card>

      {/* OpenAI */}
      <Card>
        <SectionTitle icon={<Key className="h-4 w-4" />}>OpenAI API Key</SectionTitle>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">状态：</span>
            {keyStatus.openai ? (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                已设置
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-white/30">
                <AlertCircle className="h-3 w-3" />
                未设置
              </span>
            )}
          </div>

          <FieldRow label="新 Key">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showOpenaiKey ? 'text' : 'password'}
                  value={openaiKey}
                  onChange={(e) => {
                    setOpenaiKey(e.target.value);
                    setOpenaiTestStatus('idle');
                  }}
                  placeholder={keyStatus.openai ? '输入新 key 以替换' : 'sk-...'}
                  className="h-8 rounded-lg border-white/8 bg-white/[0.04] pr-9 text-xs text-white/80 placeholder:text-white/20"
                />
                <button
                  type="button"
                  onClick={() => setShowOpenaiKey((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                >
                  {showOpenaiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestOpenaiKey}
                disabled={!openaiKey.trim() || openaiTestStatus === 'testing'}
                className="shrink-0 border-white/10 bg-white/[0.04] text-xs text-white/60 hover:text-white hover:bg-white/[0.08]"
              >
                {openaiTestStatus === 'testing' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span className="ml-1.5">测试连接</span>
              </Button>
            </div>
          </FieldRow>

          {/* OpenAI Test result */}
          {openaiTestStatus === 'ok' && (
            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              连接成功，Key 有效
            </div>
          )}
          {openaiTestStatus === 'invalid' && (
            <div className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <XCircle className="h-3.5 w-3.5 shrink-0" />
              {openaiTestError ?? 'Key 无效'}
            </div>
          )}
          {openaiTestStatus === 'error' && (
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {openaiTestError ?? '测试失败'}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <SectionTitle icon={<Cpu className="h-4 w-4" />}>本地登录态</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">Codex Native</div>
                <div className="mt-1 text-xs text-white/45">读取 `~/.codex/auth.json`，复用本机 Codex 登录。</div>
              </div>
              <span className={cn(
                'inline-flex h-6 items-center rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em]',
                providerInventory?.providers.nativeCodex.loggedIn
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                  : providerInventory?.providers.nativeCodex.installed
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-100'
                    : 'border-white/10 bg-white/[0.04] text-white/45',
              )}>
                {providerInventory?.providers.nativeCodex.loggedIn ? 'Ready' : providerInventory?.providers.nativeCodex.installed ? 'Needs Login' : 'Not Installed'}
              </span>
            </div>
            <div className="mt-3 text-xs leading-5 text-white/65">
              {providerInventory?.providers.nativeCodex.loggedIn
                ? '已检测到 Codex OAuth 登录，可以直接应用为默认或 layer provider。'
                : providerInventory?.providers.nativeCodex.installed
                  ? '检测到 codex 命令，但未找到 auth.json。请先在终端完成 codex 登录。'
                  : '当前未检测到 codex 可执行文件。'}
            </div>
          </div>

          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">Claude Code</div>
                <div className="mt-1 text-xs text-white/45">本地 Claude Code CLI / profile 状态检测。</div>
              </div>
              <span className={cn(
                'inline-flex h-6 items-center rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em]',
                providerInventory?.providers.claudeCode.installed && providerInventory?.providers.claudeCode.loginDetected
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                  : providerInventory?.providers.claudeCode.installed
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-100'
                    : 'border-white/10 bg-white/[0.04] text-white/45',
              )}>
                {providerInventory?.providers.claudeCode.installed && providerInventory?.providers.claudeCode.loginDetected ? 'Ready' : providerInventory?.providers.claudeCode.installed ? 'Needs Login' : 'Not Installed'}
              </span>
            </div>
            <div className="mt-3 text-xs leading-5 text-white/65">
              {providerInventory?.providers.claudeCode.installed
                ? (providerInventory?.providers.claudeCode.loginDetected
                  ? '已检测到本地 Claude 配置，可切到 Claude Code provider。'
                  : '已检测到 Claude Code 安装，但未检测到登录配置。请先在本机 Claude Code 内完成 /login。')
                : '当前未检测到 claude CLI 或本地 Claude Code 安装。'}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle icon={<Key className="h-4 w-4" />}>Gemini API Key</SectionTitle>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">状态：</span>
            {keyStatus.gemini ? (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                已设置
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-white/30">
                <AlertCircle className="h-3 w-3" />
                未设置
              </span>
            )}
          </div>

          <FieldRow label="新 Key">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showGeminiKey ? 'text' : 'password'}
                  value={geminiKey}
                  onChange={(e) => {
                    setGeminiKey(e.target.value);
                    setGeminiTestStatus('idle');
                  }}
                  placeholder={keyStatus.gemini ? '输入新 key 以替换' : 'AIza...'}
                  className="h-8 rounded-lg border-white/8 bg-white/[0.04] pr-9 text-xs text-white/80 placeholder:text-white/20"
                />
                <button
                  type="button"
                  onClick={() => setShowGeminiKey((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                >
                  {showGeminiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestGeminiKey}
                disabled={!geminiKey.trim() || geminiTestStatus === 'testing'}
                className="shrink-0 border-white/10 bg-white/[0.04] text-xs text-white/60 hover:text-white hover:bg-white/[0.08]"
              >
                {geminiTestStatus === 'testing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                <span className="ml-1.5">测试连接</span>
              </Button>
            </div>
          </FieldRow>
          {geminiTestStatus === 'ok' ? <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">连接成功，Gemini Key 有效</div> : null}
          {geminiTestStatus === 'invalid' ? <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{geminiTestError ?? 'Key 无效'}</div> : null}
          {geminiTestStatus === 'error' ? <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{geminiTestError ?? '测试失败'}</div> : null}
        </div>
      </Card>

      <Card>
        <SectionTitle icon={<Key className="h-4 w-4" />}>Grok API Key</SectionTitle>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">状态：</span>
            {keyStatus.grok ? (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                已设置
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-white/30">
                <AlertCircle className="h-3 w-3" />
                未设置
              </span>
            )}
          </div>

          <FieldRow label="新 Key">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showGrokKey ? 'text' : 'password'}
                  value={grokKey}
                  onChange={(e) => {
                    setGrokKey(e.target.value);
                    setGrokTestStatus('idle');
                  }}
                  placeholder={keyStatus.grok ? '输入新 key 以替换' : 'xai-...'}
                  className="h-8 rounded-lg border-white/8 bg-white/[0.04] pr-9 text-xs text-white/80 placeholder:text-white/20"
                />
                <button
                  type="button"
                  onClick={() => setShowGrokKey((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                >
                  {showGrokKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestGrokKey}
                disabled={!grokKey.trim() || grokTestStatus === 'testing'}
                className="shrink-0 border-white/10 bg-white/[0.04] text-xs text-white/60 hover:text-white hover:bg-white/[0.08]"
              >
                {grokTestStatus === 'testing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                <span className="ml-1.5">测试连接</span>
              </Button>
            </div>
          </FieldRow>
          {grokTestStatus === 'ok' ? <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">连接成功，Grok Key 有效</div> : null}
          {grokTestStatus === 'invalid' ? <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{grokTestError ?? 'Key 无效'}</div> : null}
          {grokTestStatus === 'error' ? <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{grokTestError ?? '测试失败'}</div> : null}
        </div>
      </Card>

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
      <div className="flex items-center gap-2 py-8 text-sm text-white/40">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading config…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle icon={<Map className="h-4 w-4" />}>Scene 覆盖配置</SectionTitle>
        <p className="mb-4 text-xs text-white/40">
          Scene 配置优先级最高，覆盖层级配置和默认配置。留空 Model 则继承层级配置。
        </p>

        {sceneEntries.length > 0 ? (
          <div className="space-y-2 mb-4">
            {sceneEntries.map(([key, scene]) => (
              <div key={key} className="flex items-center gap-2 rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2">
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
                    className="h-8 rounded-lg border-white/8 bg-white/[0.04] text-xs text-white/80 placeholder:text-white/20"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => deleteScene(key)}
                  className="shrink-0 text-white/20 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-dashed border-white/8 px-4 py-6 text-center text-xs text-white/30">
            暂无 scene 覆盖配置
          </div>
        )}

        {/* Add scene */}
        <div className="rounded-lg border border-white/6 bg-white/[0.015] p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">
            添加 Scene
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addScene(); }}
              placeholder="scene 名称（如 code-summary）"
              className="h-8 flex-1 rounded-lg border-white/8 bg-white/[0.04] text-xs text-white/80 placeholder:text-white/20"
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
              className="h-8 w-32 rounded-lg border-white/8 bg-white/[0.04] text-xs text-white/80 placeholder:text-white/20"
            />
            <Button
              size="sm"
              onClick={addScene}
              disabled={!newKey.trim()}
              className="shrink-0 border border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20"
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
      <div className="flex items-center gap-2 text-sm text-white/40">
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
          <h3 className="text-sm font-medium text-white/80">MCP 服务器配置</h3>
          <p className="text-xs text-white/40 mt-1">管理 Model Context Protocol 服务器连接</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-xs h-8 border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06] hover:text-white/80"
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
              <label className="text-[11px] text-white/50 mb-1 block">名称 *</label>
              <Input
                value={newServer.name}
                onChange={(e) => setNewServer((s) => ({ ...s, name: e.target.value }))}
                placeholder="my-mcp-server"
                className="h-8 text-xs bg-black/20 border-white/10"
              />
            </div>
            <div>
              <label className="text-[11px] text-white/50 mb-1 block">类型</label>
              <Select value={newServer.type} onValueChange={(v: string | null) => setNewServer((s) => ({ ...s, type: v ?? s.type }))}>
                <SelectTrigger className="h-8 text-xs bg-black/20 border-white/10">
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
                <label className="text-[11px] text-white/50 mb-1 block">命令</label>
                <Input
                  value={newServer.command}
                  onChange={(e) => setNewServer((s) => ({ ...s, command: e.target.value }))}
                  placeholder="npx -y @modelcontextprotocol/server-xxx"
                  className="h-8 text-xs bg-black/20 border-white/10 font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-white/50 mb-1 block">参数 (空格分隔)</label>
                <Input
                  value={newServer.args}
                  onChange={(e) => setNewServer((s) => ({ ...s, args: e.target.value }))}
                  placeholder="--flag value"
                  className="h-8 text-xs bg-black/20 border-white/10 font-mono"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="text-[11px] text-white/50 mb-1 block">URL</label>
              <Input
                value={newServer.url}
                onChange={(e) => setNewServer((s) => ({ ...s, url: e.target.value }))}
                placeholder="http://localhost:8080/mcp"
                className="h-8 text-xs bg-black/20 border-white/10 font-mono"
              />
            </div>
          )}
          <div>
            <label className="text-[11px] text-white/50 mb-1 block">描述</label>
            <Input
              value={newServer.description}
              onChange={(e) => setNewServer((s) => ({ ...s, description: e.target.value }))}
              placeholder="可选描述"
              className="h-8 text-xs bg-black/20 border-white/10"
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
              className="h-7 text-xs text-white/50"
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
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center">
          <Plug className="mx-auto h-8 w-8 text-white/15 mb-3" />
          <p className="text-xs text-white/30 mb-1">尚未配置 MCP 服务器</p>
          <p className="text-[10px] text-white/20">点击&quot;添加服务器&quot;开始配置</p>
        </div>
      ) : (
        <div className="space-y-2">
          {servers.map((s) => (
            <div
              key={s.name}
              className="group flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 hover:bg-white/[0.04] transition-colors"
            >
              <div className="mt-0.5 h-2 w-2 rounded-full bg-emerald-400/70 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white/70">{s.name}</span>
                  <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/30">
                    {s.type ?? 'stdio'}
                  </span>
                </div>
                {s.description && <p className="text-[10px] text-white/30 mt-0.5">{s.description}</p>}
                <div className="flex items-center gap-1 mt-1">
                  <Terminal className="h-3 w-3 text-white/20" />
                  <code className="text-[10px] text-white/25 font-mono truncate">
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

      <p className="text-[10px] text-white/15">配置文件: ~/.gemini/antigravity/mcp_config.json</p>
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
  const [configError, setConfigError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTabId>(requestedTab);
  const [providerInventory, setProviderInventory] = useState<ProviderInventory | null>(null);

  useEffect(() => {
    fetch('/api/ai-config')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load config');
        return res.json() as Promise<AIProviderConfig>;
      })
      .then((data) => {
        setConfig(data);
        setConfigError(null);
      })
      .catch(() => {
        setConfigError('无法加载 AI 配置');
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
    <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(160deg,rgba(18,28,46,0.7)_0%,rgba(9,14,26,0.9)_100%)] shadow-2xl overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center gap-3 border-b border-white/6 px-6 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-400/10">
          <Key className="h-4 w-4 text-sky-400" />
        </div>
        <div>
          <div className="text-sm font-semibold text-white">Settings</div>
          <div className="text-[11px] text-white/40">第三方 Provider 接入 · AI Provider 配置 · API Key 管理</div>
        </div>
      </div>

      {configLoading ? (
        <div className="flex items-center gap-2 px-6 py-12 text-sm text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : configError ? (
        <div className="flex items-center gap-2 px-6 py-12 text-sm text-red-400">
          <XCircle className="h-4 w-4" />
          {configError}
        </div>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(value) => value && setActiveTab(value as SettingsTabId)}
          className="flex flex-col"
        >
          <div className="border-b border-white/6 px-6 pt-4 pb-0">
            <TabsList className="h-9 gap-1 rounded-none bg-transparent p-0">
              {SETTINGS_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="h-9 rounded-none border-0 border-b-2 border-transparent px-3 text-xs font-medium text-white/50 data-active:border-sky-400 data-active:text-sky-300 data-active:bg-transparent"
                >
                  {tab.icon}
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

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
          <TabsContent value="mcp" className="p-6">
            <McpServersTab />
          </TabsContent>
          <TabsContent value="messaging" className="p-6">
            <CcConnectTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
