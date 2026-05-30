'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Map as MapIcon, Plus, Save, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  WorkspaceEmptyBlock,
  workspaceFieldClassName,
  workspaceOutlineActionClassName,
} from '@/components/ui/workspace-primitives';
import type { AIProviderConfig, AIProviderId, SceneProviderConfig } from '@/lib/providers/types';
import type { ProviderInventory } from '@/lib/providers/provider-availability';
import { Card, SectionTitle, ProviderSelect, ProviderModelInput, SaveFeedback } from '@/components/settings/shared';

export default function SceneOverridesTab({
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
