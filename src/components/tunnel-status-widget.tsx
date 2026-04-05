'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Globe, Loader2, Power, PowerOff, Settings, Save, X } from 'lucide-react';

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

  return (
    <div className={cn('rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-3', className)}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-widest text-white/40">
          🌐 Cloudflare Tunnel
        </div>
        <div className={cn(
          'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium',
          status.running
            ? 'bg-emerald-400/10 text-emerald-400'
            : status.starting
              ? 'bg-amber-400/10 text-amber-400'
              : 'bg-white/5 text-white/30'
        )}>
          <div className={cn(
            'h-1.5 w-1.5 rounded-full',
            status.running ? 'bg-emerald-400' : status.starting ? 'bg-amber-400 animate-pulse' : 'bg-white/20'
          )} />
          {status.running ? '运行中' : status.starting ? '启动中' : '已停止'}
        </div>
      </div>

      {!status.configured ? (
        <p className="text-xs text-white/30">
          Tunnel 未配置。设置 ~/.gemini/antigravity/tunnel_config.json
        </p>
      ) : null}

      {/* Config Editor */}
      {editing && (
        <div className="space-y-2 border-t border-white/5 pt-2">
          <div>
            <label className="text-[10px] text-white/40">Tunnel 名称</label>
            <Input
              className="h-7 text-xs bg-white/5 border-white/10"
              value={configForm.tunnelName}
              onChange={e => setConfigForm(f => ({ ...f, tunnelName: e.target.value }))}
              placeholder="my-tunnel"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/40">URL</label>
            <Input
              className="h-7 text-xs bg-white/5 border-white/10"
              value={configForm.url}
              onChange={e => setConfigForm(f => ({ ...f, url: e.target.value }))}
              placeholder="http://localhost:3000"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/40">Credentials 路径（可选）</label>
            <Input
              className="h-7 text-xs bg-white/5 border-white/10"
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
            <label className="text-[10px] text-white/40">自动启动</label>
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
              className="h-7 text-xs gap-1 border-white/10"
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
              <Globe className="h-3 w-3 text-white/30 shrink-0" />
              <a
                href={status.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-sky-400 hover:text-sky-300 truncate"
              >
                {status.url}
              </a>
            </div>
          )}

          {status.error && (
            <p className="text-xs text-red-400/80">{status.error}</p>
          )}

          <div className="flex gap-2 pt-1">
            {status.running ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 border-white/10"
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
              className="h-7 text-xs gap-1 border-white/10"
              onClick={() => setEditing(true)}
            >
              <Settings className="h-3 w-3" /> 配置
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
