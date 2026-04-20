'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import {
  Activity,
  Clock,
  Globe,
  Loader2,
  MessageSquare,
  Play,
  Pause,
  Power,
  RefreshCw,
  Send,
  Settings,
  Trash2,
  Users,
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
  if (!heartbeat) return null;

  const handleToggle = useCallback(async () => {
    const action = heartbeat.paused ? 'resume' : 'pause';
    await ccApi(`projects/${projectName}/heartbeat/${action}`, { method: 'POST' });
    onRefresh();
  }, [heartbeat.paused, projectName, onRefresh]);

  const handleTrigger = useCallback(async () => {
    await ccApi(`projects/${projectName}/heartbeat/run`, { method: 'POST' });
    onRefresh();
  }, [projectName, onRefresh]);

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
  const [projects, setProjects] = useState<CcProject[]>([]);
  const [sessions, setSessions] = useState<CcSession[]>([]);
  const [cronJobs, setCronJobs] = useState<CcCronJob[]>([]);
  const [heartbeat, setHeartbeat] = useState<CcHeartbeat | null>(null);
  const [platformDetails, setPlatformDetails] = useState<{ type: string; connected: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProject, setActiveProject] = useState<string>('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, projectsRes] = await Promise.all([
        ccApi<CcStatus>('status'),
        ccApi<{ projects: CcProject[] }>('projects'),
      ]);

      if (statusRes.ok && statusRes.data) setStatus(statusRes.data);
      else setStatus(null);

      if (projectsRes.ok && projectsRes.data) {
        const prjs = projectsRes.data.projects ?? [];
        setProjects(prjs);

        // Auto-select first project
        const projName = activeProject || prjs[0]?.name || '';
        if (projName) {
          setActiveProject(projName);

          const [sessRes, cronRes, hbRes, projDetailRes] = await Promise.all([
            ccApi<{ sessions: CcSession[] }>(`projects/${projName}/sessions`),
            ccApi<{ jobs: CcCronJob[] }>('cron'),
            ccApi<CcHeartbeat>(`projects/${projName}/heartbeat`),
            ccApi<{ platforms?: { type: string; connected: boolean }[] }>(`projects/${projName}`),
          ]);

          if (sessRes.ok && sessRes.data) setSessions(sessRes.data.sessions ?? []);
          if (cronRes.ok && cronRes.data) setCronJobs(cronRes.data.jobs ?? []);
          if (hbRes.ok && hbRes.data) setHeartbeat(hbRes.data);
          if (projDetailRes.ok && projDetailRes.data?.platforms) {
            setPlatformDetails(projDetailRes.data.platforms);
          } else {
            // Fallback: derive from project list
            const proj = prjs.find(p => p.name === projName);
            if (proj) {
              const pds = (proj.platforms ?? []).map(p =>
                typeof p === 'string' ? { type: p, connected: true } : p
              );
              setPlatformDetails(pds);
            }
          }
        }
      }
    } catch { /* handled by StatusCard */ }
    setLoading(false);
  }, [activeProject]);

  useEffect(() => { refresh(); }, []);

  return (
    <ScrollArea className="h-[calc(100vh-200px)]">
      <div className="space-y-1">
        {/* Status */}
        <StatusCard status={status} onRefresh={refresh} loading={loading} />

        {status && (
          <>
            {/* Platforms */}
            <SectionHeader icon={<Globe className="h-3.5 w-3.5" />} title={`消息平台 (${platformDetails.length})`} />
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
        )}
      </div>
    </ScrollArea>
  );
}
