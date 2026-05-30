'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, Loader2, Plug, Plus, Save, Terminal, Trash2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  WorkspaceEmptyBlock,
  workspaceFieldClassName,
  workspaceOutlineActionClassName,
} from '@/components/ui/workspace-primitives';

type McpServerFE = {
  name: string;
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  description?: string;
  env?: Record<string, string>;
};

export default function McpServersTab() {
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
