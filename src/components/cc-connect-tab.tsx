'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Globe,
  Loader2,
  MessageSquare,
  Play,
  Pause,
  RefreshCw,
  Send,
  Settings,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import PlatformManager from '@/components/platform-manager';

// ─── Types ──────────────────────────────────────────────────────

type CcStatus = {
  version: string;
  uptime_seconds: number;
  connected_platforms: string[];
  projects_count: number;
};

type CcProject = {
  name: string;
  agent_type: string;
  platforms: string[] | { type: string; connected: boolean }[];
  sessions_count: number;
};

type CcSession = {
  id: string;
  session_key: string;
  name: string;
  platform: string;
  active: boolean;
  live: boolean;
  history_count: number;
  created_at: string;
  updated_at: string;
  last_message?: { role: string; content: string; timestamp: string } | null;
  user_name?: string;
};

type CcCronJob = {
  id: string;
  project: string;
  cron_expr: string;
  prompt: string;
  description: string;
  enabled: boolean;
  last_run: string;
};

type CcHeartbeat = {
  enabled: boolean;
  paused: boolean;
  interval_mins: number;
  run_count: number;
  last_run: string;
};

type CcLocalState = {
  installed: boolean;
  binaryPath: string | null;
  configPath: string;
  templatePath: string;
  configExists: boolean;
  configPrepared: boolean;
  platformConfigured: boolean;
  tokenConfigured: boolean;
  managementEnabled: boolean;
  managementPort: number;
  running: boolean;
  pid: number | null;
  connectedPlatforms: string[];
  projectsCount: number;
  version: string | null;
  issues: string[];
};

// ─── API Helper ─────────────────────────────────────────────────

async function ccApi<T>(path: string, options?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(`/api/cc-connect/${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Failed to connect to cc-connect proxy' };
  }
}

// ─── Sub-components ─────────────────────────────────────────────

function StatusCard({ status, onRefresh, loading }: { status: CcStatus | null; onRefresh: () => void; loading: boolean }) {
  if (!status) {
    return (
      <div className="rounded-xl border border-white/8 bg-white/[0.025] p-6 text-center">
        <WifiOff className="mx-auto mb-2 h-8 w-8 text-red-400/60" />
        <p className="text-sm text-white/50">cc-connect 未连接</p>
        <p className="mt-1 text-xs text-white/30">确保 cc-connect 已启动且 [management] 已启用</p>
        <Button variant="ghost" size="sm" onClick={onRefresh} className="mt-3" disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          <span className="ml-1.5">重试</span>
        </Button>
      </div>
    );
  }

  const uptime = formatUptime(status.uptime_seconds);

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wifi className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-medium text-white">cc-connect</span>
          <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30">
            {status.version}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading} className="h-7 w-7 p-0">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <span className="text-white/40">运行时间</span>
          <p className="text-white/80 mt-0.5">{uptime}</p>
        </div>
        <div>
          <span className="text-white/40">已连接平台</span>
          <p className="text-white/80 mt-0.5">{status.connected_platforms.join(', ') || '无'}</p>
        </div>
        <div>
          <span className="text-white/40">项目数</span>
          <p className="text-white/80 mt-0.5">{status.projects_count}</p>
        </div>
      </div>
    </div>
  );
}

function LocalGatewayCard({
  state,
  loading,
  actionState,
  onRefresh,
  onManage,
}: {
  state: CcLocalState | null;
  loading: boolean;
  actionState: { busy: boolean; error: string | null; message: string | null };
  onRefresh: () => void;
  onManage: (action: 'prepare-config' | 'start' | 'stop') => void;
}) {
  const statusTone = !state
    ? 'text-white/50'
    : !state.installed
      ? 'text-red-300'
      : state.running
        ? 'text-emerald-300'
        : state.tokenConfigured && state.configExists
          ? 'text-amber-200'
          : 'text-white/60';

  const statusTitle = !state
    ? '正在检查 cc-connect'
    : !state.installed
      ? '未安装 cc-connect'
      : !state.configExists
        ? '尚未创建配置'
        : !state.tokenConfigured
          ? '尚未绑定微信'
          : state.running
            ? 'cc-connect 已运行'
            : '已配置，待启动';

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className={cn('text-sm font-medium', statusTone)}>{statusTitle}</div>
          <div className="mt-1 text-xs leading-6 text-white/40">
            {state?.running
              ? `management API 已就绪，端口 ${state.managementPort}。`
              : '这个页面现在可以负责本地配置和启动，不再只显示断开提示。'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {state && (!state.configExists || !state.configPrepared || !state.managementEnabled) ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => onManage('prepare-config')}
              disabled={actionState.busy}
            >
              {actionState.busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Settings className="mr-1.5 h-3.5 w-3.5" />}
              修复默认配置
            </Button>
          ) : null}
          {state?.installed && state?.configExists && state?.configPrepared && state?.managementEnabled && state?.platformConfigured && state?.tokenConfigured && !state.running ? (
            <Button
              size="sm"
              className="h-8 bg-sky-500/80 text-xs text-white hover:bg-sky-500"
              onClick={() => onManage('start')}
              disabled={actionState.busy}
            >
              {actionState.busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
              启动 cc-connect
            </Button>
          ) : null}
          {state?.running ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => onManage('stop')}
              disabled={actionState.busy}
            >
              {actionState.busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Pause className="mr-1.5 h-3.5 w-3.5" />}
              停止
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onRefresh} className="h-8 px-3 text-xs" disabled={loading}>
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            重新检查
          </Button>
        </div>
      </div>

      {state ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">安装</div>
            <div className="mt-2 flex items-center gap-2 text-xs text-white/75">
              {state.installed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <AlertCircle className="h-3.5 w-3.5 text-red-300" />}
              {state.installed ? '已安装' : '未安装'}
            </div>
            {state.binaryPath ? <div className="mt-2 truncate font-mono text-[10px] text-white/35">{state.binaryPath}</div> : null}
          </div>
          <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">配置</div>
            <div className="mt-2 flex items-center gap-2 text-xs text-white/75">
              {state.configExists && state.configPrepared ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-300" />}
              {state.configExists ? (state.configPrepared ? '已就绪' : '需要修复') : '未创建'}
            </div>
            <div className="mt-2 truncate font-mono text-[10px] text-white/35">{state.configPath}</div>
          </div>
          <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">绑定</div>
            <div className="mt-2 flex items-center gap-2 text-xs text-white/75">
              {state.tokenConfigured ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-300" />}
              {state.tokenConfigured ? '已完成 weixin setup' : '需要运行 weixin setup'}
            </div>
            {!state.tokenConfigured ? (
              <div className="mt-2 font-mono text-[10px] text-white/35">cc-connect weixin setup --project antigravity</div>
            ) : null}
          </div>
          <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">运行</div>
            <div className="mt-2 flex items-center gap-2 text-xs text-white/75">
              {state.running ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-300" />}
              {state.running ? `运行中 · ${state.managementPort}` : '未运行'}
            </div>
            {state.connectedPlatforms.length > 0 ? (
              <div className="mt-2 text-[10px] text-white/35">平台：{state.connectedPlatforms.join(', ')}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {state?.issues?.length ? (
        <div className="mt-4 rounded-lg border border-amber-400/15 bg-amber-400/5 px-3 py-3 text-xs text-amber-100">
          <div className="font-medium">待处理</div>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {state.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {actionState.error ? (
        <div className="mt-4 rounded-lg border border-red-400/15 bg-red-400/10 px-3 py-3 text-xs text-red-200">
          {actionState.error}
        </div>
      ) : null}
      {actionState.message ? (
        <div className="mt-4 rounded-lg border border-emerald-400/15 bg-emerald-400/10 px-3 py-3 text-xs text-emerald-200">
          {actionState.message}
        </div>
      ) : null}
    </div>
  );
}

function SessionsList({ sessions, projectName, onRefresh }: { sessions: CcSession[]; projectName: string; onRefresh: () => void }) {
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const handleSend = useCallback(async (sessionKey: string) => {
    if (!message.trim()) return;
    setSendingTo(sessionKey);
    await ccApi(`projects/${projectName}/send`, {
      method: 'POST',
      body: JSON.stringify({ session_key: sessionKey, message: message.trim() }),
    });
    setMessage('');
    setSendingTo(null);
    onRefresh();
  }, [message, projectName, onRefresh]);

  if (sessions.length === 0) {
    return (
      <div className="text-center py-6 text-xs text-white/30">
        <MessageSquare className="mx-auto mb-2 h-6 w-6 text-white/15" />
        暂无会话
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map(s => (
        <div key={s.id} className="rounded-lg border border-white/6 bg-white/[0.015] p-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn(
                'text-[10px]',
                s.live ? 'text-emerald-400 border-emerald-400/30' : 'text-white/30 border-white/10',
              )}>
                {s.platform}
              </Badge>
              {s.name && <span className="text-xs text-white/70">{s.name}</span>}
              {s.user_name && <span className="text-xs text-white/40">({s.user_name})</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-white/30">{s.history_count} msgs</span>
              {s.live && <Activity className="h-3 w-3 text-emerald-400" />}
            </div>
          </div>
          {s.last_message && (
            <p className="text-[11px] text-white/40 line-clamp-1 mb-1.5">
              {s.last_message.role === 'user' ? '👤' : '🤖'} {s.last_message.content}
            </p>
          )}
          {s.live && (
            <div className="flex gap-1.5 mt-2">
              <Input
                value={sendingTo === s.session_key ? message : ''}
                onChange={(e) => { setSendingTo(s.session_key); setMessage(e.target.value); }}
                placeholder="发送消息..."
                className="h-7 text-xs bg-white/5 border-white/10"
                onKeyDown={(e) => e.key === 'Enter' && handleSend(s.session_key)}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 shrink-0"
                onClick={() => handleSend(s.session_key)}
                disabled={sendingTo === s.session_key && !message.trim()}
              >
                <Send className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CronJobsList({ jobs, onRefresh }: { jobs: CcCronJob[]; onRefresh: () => void }) {
  const handleDelete = useCallback(async (id: string) => {
    await ccApi(`cron/${id}`, { method: 'DELETE' });
    onRefresh();
  }, [onRefresh]);

  if (jobs.length === 0) {
    return (
      <div className="text-center py-4 text-xs text-white/30">
        <Clock className="mx-auto mb-2 h-6 w-6 text-white/15" />
        暂无定时任务
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {jobs.map(job => (
        <div key={job.id} className="flex items-center justify-between rounded-lg border border-white/6 bg-white/[0.015] p-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/70">{job.description || job.prompt?.slice(0, 40)}</span>
              <Badge variant="outline" className={cn(
                'text-[10px]',
                job.enabled ? 'text-emerald-400 border-emerald-400/30' : 'text-white/30 border-white/10',
              )}>
                {job.enabled ? '启用' : '禁用'}
              </Badge>
            </div>
            <p className="text-[10px] text-white/30 mt-0.5">
              <code>{job.cron_expr}</code> · 上次运行: {job.last_run ? new Date(job.last_run).toLocaleString('zh-CN') : '从未'}
            </p>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400/50 hover:text-red-400" onClick={() => handleDelete(job.id)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function HeartbeatCard({ heartbeat, projectName, onRefresh }: { heartbeat: CcHeartbeat | null; projectName: string; onRefresh: () => void }) {
  const handleToggle = useCallback(async () => {
    if (!heartbeat) return;
    const action = heartbeat.paused ? 'resume' : 'pause';
    await ccApi(`projects/${projectName}/heartbeat/${action}`, { method: 'POST' });
    onRefresh();
  }, [heartbeat, projectName, onRefresh]);

  const handleTrigger = useCallback(async () => {
    await ccApi(`projects/${projectName}/heartbeat/run`, { method: 'POST' });
    onRefresh();
  }, [projectName, onRefresh]);

  if (!heartbeat) return null;

  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.015] p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-sky-400" />
          <span className="text-xs text-white/70">心跳</span>
          <Badge variant="outline" className={cn(
            'text-[10px]',
            heartbeat.paused ? 'text-amber-400 border-amber-400/30' : 'text-emerald-400 border-emerald-400/30',
          )}>
            {heartbeat.paused ? '已暂停' : `每 ${heartbeat.interval_mins} 分钟`}
          </Badge>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={handleToggle}>
            {heartbeat.paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={handleTrigger}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <p className="text-[10px] text-white/30 mt-1">
        已运行 {heartbeat.run_count} 次 · 上次: {heartbeat.last_run ? new Date(heartbeat.last_run).toLocaleString('zh-CN') : '从未'}
      </p>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function SectionHeader({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3 mt-5">
      <div className="flex items-center gap-2">
        <span className="text-sky-400/70">{icon}</span>
        <h4 className="text-xs font-semibold text-white/70">{title}</h4>
      </div>
      {action}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export default function CcConnectTab() {
  const [status, setStatus] = useState<CcStatus | null>(null);
  const [localState, setLocalState] = useState<CcLocalState | null>(null);
  const [sessions, setSessions] = useState<CcSession[]>([]);
  const [cronJobs, setCronJobs] = useState<CcCronJob[]>([]);
  const [heartbeat, setHeartbeat] = useState<CcHeartbeat | null>(null);
  const [platformDetails, setPlatformDetails] = useState<{ type: string; connected: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProject, setActiveProject] = useState<string>('');
  const [actionState, setActionState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null,
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const localRes = await fetch('/api/cc-connect/local-state')
        .then((res) => res.json())
        .catch(() => ({ ok: false }));

      const nextLocalState = localRes.ok ? localRes.data as CcLocalState : null;
      setLocalState(nextLocalState);

      if (!nextLocalState?.running) {
        setStatus(null);
        setSessions([]);
        setCronJobs([]);
        setHeartbeat(null);
        setPlatformDetails([]);
        setLoading(false);
        return;
      }

      const [statusRes, projectsRes] = await Promise.all([
        ccApi<CcStatus>('status'),
        ccApi<{ projects: CcProject[] }>('projects'),
      ]);

      setStatus(statusRes.ok && statusRes.data ? statusRes.data : null);

      const prjs = projectsRes.ok && projectsRes.data ? (projectsRes.data.projects ?? []) : [];
      const projName = activeProject || prjs[0]?.name || '';
      if (projName) {
        setActiveProject(projName);

        const [sessRes, cronRes, hbRes, projDetailRes] = await Promise.all([
          ccApi<{ sessions: CcSession[] }>(`projects/${projName}/sessions`),
          ccApi<{ jobs: CcCronJob[] }>('cron'),
          ccApi<CcHeartbeat>(`projects/${projName}/heartbeat`),
          ccApi<{ platforms?: { type: string; connected: boolean }[] }>(`projects/${projName}`),
        ]);

        setSessions(sessRes.ok && sessRes.data ? (sessRes.data.sessions ?? []) : []);
        setCronJobs(cronRes.ok && cronRes.data ? (cronRes.data.jobs ?? []) : []);
        setHeartbeat(hbRes.ok && hbRes.data ? hbRes.data : null);
        if (projDetailRes.ok && projDetailRes.data?.platforms) {
          setPlatformDetails(projDetailRes.data.platforms);
        } else {
          const proj = prjs.find((p) => p.name === projName);
          if (proj) {
            const pds = (proj.platforms ?? []).map((p) =>
              typeof p === 'string' ? { type: p, connected: true } : p
            );
            setPlatformDetails(pds);
          } else {
            setPlatformDetails([]);
          }
        }
      } else {
        setSessions([]);
        setCronJobs([]);
        setHeartbeat(null);
        setPlatformDetails([]);
      }
    } catch { /* handled by StatusCard */ }
    setLoading(false);
  }, [activeProject]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const handleManage = useCallback(async (action: 'prepare-config' | 'start' | 'stop') => {
    setActionState({ busy: true, error: null, message: null });
    try {
      const res = await fetch('/api/cc-connect/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const payload = await res.json() as { ok?: boolean; error?: string; changed?: boolean; data?: CcLocalState };
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || 'cc-connect 操作失败');
      }
      setLocalState(payload.data ?? null);
      const nextState = payload.data ?? null;
      setActionState({
        busy: false,
        error: null,
        message: action === 'prepare-config'
          ? (payload.changed ? '已写入并修复本地 cc-connect 配置。' : '本地 cc-connect 配置已是最新。')
          : action === 'start'
            ? (nextState?.running ? 'cc-connect 已启动。' : 'cc-connect 启动请求已发送，但 management API 尚未就绪。')
            : 'cc-connect 已停止。',
      });
      await refresh();
    } catch (error) {
      setActionState({
        busy: false,
        error: error instanceof Error ? error.message : 'cc-connect 操作失败',
        message: null,
      });
    }
  }, [refresh]);

  return (
    <ScrollArea className="h-[calc(100vh-200px)]">
      <div className="space-y-1">
        <LocalGatewayCard
          state={localState}
          loading={loading}
          actionState={actionState}
          onRefresh={refresh}
          onManage={handleManage}
        />

        {status ? (
          <>
            <SectionHeader icon={<Wifi className="h-3.5 w-3.5" />} title="运行状态" />
            <StatusCard status={status} onRefresh={refresh} loading={loading} />

            {/* Platforms */}
            <SectionHeader icon={<Globe className="h-3.5 w-3.5" />} title={`会话平台 (${platformDetails.length})`} />
            <PlatformManager platforms={platformDetails} projectName={activeProject} onRefresh={refresh} />

            <Separator className="my-4 bg-white/6" />

            {/* Sessions */}
            <SectionHeader
              icon={<MessageSquare className="h-3.5 w-3.5" />}
              title={`会话 (${sessions.length})`}
              action={
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={refresh}>
                  <RefreshCw className="h-3 w-3" />
                </Button>
              }
            />
            <SessionsList sessions={sessions} projectName={activeProject} onRefresh={refresh} />

            <Separator className="my-4 bg-white/6" />

            {/* Heartbeat */}
            <SectionHeader icon={<Activity className="h-3.5 w-3.5" />} title="心跳监控" />
            <HeartbeatCard heartbeat={heartbeat} projectName={activeProject} onRefresh={refresh} />

            <Separator className="my-4 bg-white/6" />

            {/* Cron */}
            <SectionHeader icon={<Clock className="h-3.5 w-3.5" />} title={`定时任务 (${cronJobs.length})`} />
            <CronJobsList jobs={cronJobs} onRefresh={refresh} />
          </>
        ) : (
          <>
            <SectionHeader icon={<Globe className="h-3.5 w-3.5" />} title="会话平台配置" />
            <PlatformManager platforms={platformDetails} projectName={activeProject || 'antigravity'} onRefresh={refresh} />
          </>
        )}
      </div>
    </ScrollArea>
  );
}
