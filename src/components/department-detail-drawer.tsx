'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
  Settings,
  XCircle,
  Activity,
  Zap,
} from 'lucide-react';
import type { Workspace, Project, DepartmentConfig, DailyDigestFE } from '@/lib/types';
import PipelineMiniDAG from '@/components/pipeline-mini-dag';

interface DepartmentDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: Workspace;
  config: DepartmentConfig;
  projects: Project[];
  onNavigateToProject?: (projectId: string) => void;
  onOpenSettings?: () => void;
}

export default function DepartmentDetailDrawer({
  open,
  onOpenChange,
  workspace,
  config,
  projects,
  onNavigateToProject,
  onOpenSettings,
}: DepartmentDetailDrawerProps) {
  const [digest, setDigest] = useState<DailyDigestFE | null>(null);
  const [quota, setQuota] = useState<{ daily: number; monthly: number; used: { daily: number; monthly: number } } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const [digestResult, quotaResult] = await Promise.allSettled([
        api.getDailyDigest(workspace.uri),
        api.getDepartmentQuota(workspace.uri),
      ]);
      setDigest(digestResult.status === 'fulfilled' ? digestResult.value : null);
      setQuota(quotaResult.status === 'fulfilled' ? quotaResult.value.quota : null);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [open, workspace.uri]);

  useEffect(() => { void load(); }, [load]);

  const typeIcon = config.typeIcon || (config.type === 'ceo' ? '👔' : config.type === 'research' ? '🔬' : config.type === 'operations' ? '📡' : '🏗️');
  const activeProjects = projects.filter(p => p.status === 'active');
  const completedProjects = projects.filter(p => p.status === 'completed');
  const failedProjects = projects.filter(p => p.status === 'failed');
  const blockedProjects = projects.filter(p => p.pipelineState?.stages?.find((s: any) => s.status === 'blocked'));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-[var(--app-bg)] border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="text-2xl">{typeIcon}</span>
            <div>
              <div className="text-lg font-bold text-white">{config.name || workspace.name}</div>
              <div className="text-xs text-white/40 font-normal">{workspace.uri.split('/').pop()}</div>
            </div>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-white/40" />
          </div>
        ) : (
          <div className="space-y-5 mt-2">
            {/* OKR */}
            {config.okr?.objectives?.[0] && (
              <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-widest text-white/40">🎯 OKR</div>
                <div className="text-sm text-white/80">{config.okr.objectives[0].title}</div>
                {config.okr.objectives[0].keyResults?.map((kr: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-white/50">
                    <span className="text-white/20">KR{i + 1}</span>
                    <span>{kr.title || kr}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Stats summary */}
            <div className="grid grid-cols-4 gap-2">
              <StatBox icon={Activity} label="进行中" value={activeProjects.length} color="text-sky-400 bg-sky-400/10" />
              <StatBox icon={CheckCircle2} label="已完成" value={completedProjects.length} color="text-emerald-400 bg-emerald-400/10" />
              <StatBox icon={XCircle} label="失败" value={failedProjects.length} color="text-red-400 bg-red-400/10" />
              <StatBox icon={AlertTriangle} label="阻塞" value={blockedProjects.length} color="text-amber-400 bg-amber-400/10" />
            </div>

            {/* Token Quota */}
            {quota && (quota.daily > 0 || quota.monthly > 0) && (
              <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-widest text-white/40">🎫 Token 配额</div>
                {quota.daily > 0 && (
                  <QuotaBar label="今日" used={quota.used.daily} limit={quota.daily} />
                )}
                {quota.monthly > 0 && (
                  <QuotaBar label="本月" used={quota.used.monthly} limit={quota.monthly} />
                )}
              </div>
            )}

            {/* Active projects */}
            {activeProjects.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-widest text-white/40">📋 进行中项目</div>
                <div className="space-y-1.5">
                  {activeProjects.map(p => (
                    <ProjectRow
                      key={p.projectId}
                      project={p}
                      onNavigate={() => onNavigateToProject?.(p.projectId)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Blockers */}
            {(failedProjects.length > 0 || blockedProjects.length > 0) && (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-widest text-red-400/60">⚠️ 需要关注</div>
                <div className="space-y-1.5">
                  {[...failedProjects, ...blockedProjects].map(p => (
                    <ProjectRow
                      key={p.projectId}
                      project={p}
                      onNavigate={() => onNavigateToProject?.(p.projectId)}
                      highlight
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Daily digest summary */}
            {digest && (
              <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-widest text-white/40">📊 今日日报</div>
                <div className="text-sm text-white/70">{digest.summary || '暂无活动'}</div>
              </div>
            )}

            {/* Completed projects (recent 5) */}
            {completedProjects.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-widest text-white/40">✅ 近期完成</div>
                <div className="space-y-1.5">
                  {completedProjects.slice(0, 5).map(p => (
                    <ProjectRow
                      key={p.projectId}
                      project={p}
                      onNavigate={() => onNavigateToProject?.(p.projectId)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-red-500/20 text-red-400 hover:bg-red-500/10"
                onClick={async () => {
                  if (!confirm(`确定要强制终止 ${config.name} 的工作区进程吗？这将杀死所有相关的语言服务器。`)) return;
                  try {
                    await api.killWorkspace(workspace.uri);
                  } catch { /* best effort */ }
                }}
              >
                <Zap className="h-3.5 w-3.5" />
                强制终止
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-white/10"
                onClick={() => {
                  onOpenChange(false);
                  onOpenSettings?.();
                }}
              >
                <Settings className="h-3.5 w-3.5" />
                部门设置
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Sub-components ---

function StatBox({ icon: Icon, label, value, color }: { icon: typeof Activity; label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] p-3 text-center">
      <div className={cn('mx-auto flex h-7 w-7 items-center justify-center rounded-lg mb-1.5', color.split(' ')[1])}>
        <Icon className={cn('h-3.5 w-3.5', color.split(' ')[0])} />
      </div>
      <div className="text-lg font-bold text-white tabular-nums">{value}</div>
      <div className="text-[10px] text-white/40">{label}</div>
    </div>
  );
}

function QuotaBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min((used / Math.max(limit, 1)) * 100, 100);
  const isDanger = pct >= 100;
  const isWarning = pct >= 80;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-white/50">{label}</span>
        <span className={cn('font-mono tabular-nums', isDanger ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-white/60')}>
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            isDanger ? 'bg-red-500/70' : isWarning ? 'bg-amber-500/60' : 'bg-sky-500/60',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ProjectRow({ project, onNavigate, highlight }: { project: Project; onNavigate?: () => void; highlight?: boolean }) {
  const stages = project.pipelineState?.stages || [];
  const done = stages.filter((s: any) => s.status === 'completed' || s.status === 'skipped').length;
  const total = stages.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer hover:bg-white/[0.04] transition-colors',
        highlight ? 'border-red-500/20 bg-red-500/5' : 'border-white/6 bg-white/[0.02]',
      )}
      onClick={onNavigate}
    >
      <div className="flex-1 min-w-0">
        <div className="text-white/80 truncate">{project.name}</div>
        {total > 0 && (
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-1 rounded-full bg-white/8 overflow-hidden">
              <div className="h-full rounded-full bg-sky-500/60" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] text-white/30 tabular-nums">{done}/{total}</span>
          </div>
        )}
        {/* Pipeline DAG (B2) */}
        <PipelineMiniDAG projectId={project.projectId} className="mt-1.5" />
      </div>
      <Badge
        variant="outline"
        className={cn(
          'text-[10px] border-white/10',
          project.status === 'active' ? 'text-sky-300' :
          project.status === 'completed' ? 'text-emerald-300' :
          project.status === 'failed' ? 'text-red-300' : 'text-white/40',
        )}
      >
        {project.status}
      </Badge>
      {onNavigate && <ArrowUpRight className="h-3 w-3 text-white/20 shrink-0" />}
    </div>
  );
}
