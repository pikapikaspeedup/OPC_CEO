'use client';

import { useState, useEffect } from 'react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isUnconfiguredWebApiError, readJsonOrThrow } from '@/lib/api-response';
import CcConnectTab from '@/components/cc-connect-tab';
import CEOProfileSettingsTab from '@/components/ceo-profile-settings-tab';
import McpServersTab from '@/components/settings/mcp-servers-tab';
import SceneOverridesTab from '@/components/settings/scene-overrides-tab';
import ApiKeysTab from '@/components/settings/api-keys-tab';
import AutonomyBudgetTab from '@/components/settings/autonomy-budget-tab';
import ProviderConfigTab from '@/components/settings/provider-config-tab';
import {
  WorkspaceBadge,
  WorkspaceSurface,
  WorkspaceTabsList,
  WorkspaceTabsTrigger,
  workspaceOutlineActionClassName,
} from '@/components/ui/workspace-primitives';
import type { AIProviderConfig } from '@/lib/providers/types';
import type { ProviderInventory } from '@/lib/providers/provider-availability';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export type SettingsTabId = 'profile' | 'provider' | 'api-keys' | 'scenes' | 'autonomy' | 'mcp' | 'messaging';
export type SettingsFocusTarget = 'third-party-provider' | null;
type SettingsConfigError =
  | { kind: 'web-api-unavailable'; message: string; path?: string }
  | { kind: 'generic'; message: string };

const SETTINGS_TABS: Array<{ value: SettingsTabId; label: string }> = [
  { value: 'profile', label: '个人偏好' },
  { value: 'provider', label: 'Provider 配置' },
  { value: 'scenes', label: 'Scene 覆盖' },
  { value: 'autonomy', label: '预算策略' },
  { value: 'mcp', label: 'MCP 服务器' },
  { value: 'messaging', label: '会话平台' },
];

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
