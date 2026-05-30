'use client';

import { useState, useEffect, useCallback, useMemo, forwardRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, RefreshCw, XCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  WorkspaceSurface,
  workspaceFieldClassName,
  workspaceOutlineActionClassName,
} from '@/components/ui/workspace-primitives';
import type { AIProviderConfig, AIProviderId, ProviderTransportId } from '@/lib/providers/types';
import {
  PROVIDER_LABELS,
  getSelectableProviderOptions,
  type ProviderInventory,
} from '@/lib/providers/provider-availability';

// Shared API-key connection-test status (ApiKeyCard + ProviderConfigTab inline credential test).
export type ApiKeyTestStatus = 'idle' | 'testing' | 'ok' | 'invalid' | 'error';

// ---------------------------------------------------------------------------
// Provider model catalog (internal to ProviderModelInput)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shared presentational primitives
// ---------------------------------------------------------------------------

export function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-[var(--app-accent)]">{icon}</span>
      <h3 className="text-sm font-semibold text-[var(--app-text)]">{children}</h3>
    </div>
  );
}

export const Card = forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(
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

export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
      <label className="w-32 shrink-0 text-xs text-[var(--app-text-muted)]">{label}</label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export function StackedField({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
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

export function ProviderSelect({
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

export function ProviderModelInput({
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

export function SaveFeedback({ saved, error }: { saved: boolean; error: string | null }) {
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
