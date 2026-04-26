'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Globe, Loader2, Power, PowerOff, Settings, Save, X } from 'lucide-react';
import {
  WorkspaceBadge,
  WorkspaceEmptyBlock,
  WorkspaceSectionHeader,
  WorkspaceStatusDot,
  WorkspaceSurface,
  workspaceFieldClassName,
  workspaceOutlineActionClassName,
} from '@/components/ui/workspace-primitives';

interface TunnelStatusWidgetProps {
  className?: string;
}

export default function TunnelStatusWidget({ className }: TunnelStatusWidgetProps) {
  const [status, setStatus] = useState<{
    running: boolean;
    starting: boolean;
    url: string | null;
    error: string | null;
    configured: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [configForm, setConfigForm] = useState({
    tunnelName: '',
    url: '',
    credentialsPath: '',
    autoStart: false,
  });
  const [saveLoading, setSaveLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.tunnelStatus();
      setStatus(result);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleStart = async () => {
    setActionLoading(true);
    try {
      await api.tunnelStart();
      await load();
    } catch { /* ignore */ } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    try {
      await api.tunnelStop();
      await load();
    } catch { /* ignore */ } finally {
      setActionLoading(false);
    }
  };

  if (loading) return null;
  if (!status) return null;

  const statusTone = status.running ? 'success' : status.starting ? 'warning' : 'neutral';

  return (
    <WorkspaceSurface className={cn('space-y-3', className)}>
      <WorkspaceSectionHeader
        eyebrow="Tunnel"
        title="Cloudflare Tunnel"
        icon={<Globe className="h-4 w-4" />}
        actions={(
          <WorkspaceBadge tone={statusTone}>
            <WorkspaceStatusDot tone={statusTone} pulse={status.starting} className="mr-1.5" />
            {status.running ? '运行中' : status.starting ? '启动中' : '已停止'}
          </WorkspaceBadge>
        )}
      />

      {!status.configured ? (
        <WorkspaceEmptyBlock
          title="Tunnel 未配置"
          description="设置 ~/.gemini/antigravity/tunnel_config.json 后可在这里启动。"
          className="py-5"
        />
      ) : null}

      {/* Config Editor */}
      {editing && (
        <div className="space-y-2 border-t border-[var(--app-border-soft)] pt-3">
          <div>
            <label className="text-[10px] text-[var(--app-text-muted)]">Tunnel 名称</label>
            <Input
              className={cn('h-8 text-xs', workspaceFieldClassName)}
              value={configForm.tunnelName}
              onChange={e => setConfigForm(f => ({ ...f, tunnelName: e.target.value }))}
              placeholder="my-tunnel"
            />
          </div>
          <div>
            <label className="text-[10px] text-[var(--app-text-muted)]">URL</label>
            <Input
              className={cn('h-8 text-xs', workspaceFieldClassName)}
              value={configForm.url}
              onChange={e => setConfigForm(f => ({ ...f, url: e.target.value }))}
              placeholder="http://localhost:3000"
            />
          </div>
          <div>
            <label className="text-[10px] text-[var(--app-text-muted)]">Credentials 路径（可选）</label>
            <Input
              className={cn('h-8 text-xs', workspaceFieldClassName)}
              value={configForm.credentialsPath}
              onChange={e => setConfigForm(f => ({ ...f, credentialsPath: e.target.value }))}
              placeholder="~/.cloudflared/cert.pem"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={configForm.autoStart}
              onChange={e => setConfigForm(f => ({ ...f, autoStart: e.target.checked }))}
              className="h-3 w-3"
            />
            <label className="text-[10px] text-[var(--app-text-muted)]">自动启动</label>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={async () => {
                if (!configForm.tunnelName || !configForm.url) return;
                setSaveLoading(true);
                try {
                  await api.tunnelSaveConfig({
                    tunnelName: configForm.tunnelName,
                    url: configForm.url,
                    credentialsPath: configForm.credentialsPath || undefined,
                    autoStart: configForm.autoStart,
                  });
                  setEditing(false);
                  await load();
                } catch { /* ignore */ } finally {
                  setSaveLoading(false);
                }
              }}
              disabled={saveLoading || !configForm.tunnelName || !configForm.url}
            >
              {saveLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              保存
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={cn('h-8 gap-1 text-xs', workspaceOutlineActionClassName)}
              onClick={() => setEditing(false)}
            >
              <X className="h-3 w-3" /> 取消
            </Button>
          </div>
        </div>
      )}

      {status.configured && !editing && (
        <div className="space-y-2">
          {status.url && (
            <div className="flex items-center gap-2">
              <Globe className="h-3 w-3 shrink-0 text-[var(--app-text-muted)]" />
              <a
                href={status.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-xs text-sky-700 hover:text-sky-800"
              >
                {status.url}
              </a>
            </div>
          )}

          {status.error && (
            <p className="rounded-[14px] border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-700">{status.error}</p>
          )}

          <div className="flex gap-2 pt-1">
            {status.running ? (
              <Button
                size="sm"
                variant="outline"
                className={cn('h-8 gap-1.5 text-xs', workspaceOutlineActionClassName)}
                onClick={handleStop}
                disabled={actionLoading}
              >
                {actionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <PowerOff className="h-3 w-3" />}
                停止
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleStart}
                disabled={actionLoading || status.starting}
              >
                {actionLoading || status.starting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
                启动
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className={cn('h-8 gap-1 text-xs', workspaceOutlineActionClassName)}
              onClick={() => setEditing(true)}
            >
              <Settings className="h-3 w-3" /> 配置
            </Button>
          </div>
        </div>
      )}
    </WorkspaceSurface>
  );
}
