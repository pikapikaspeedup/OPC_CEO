'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { CheckCircle2, Clock, ArrowUpRight, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import DepartmentSetupDialog from '@/components/department-setup-dialog';
import DailyDigestCard from '@/components/daily-digest-card';
import DepartmentDetailDrawer from '@/components/department-detail-drawer';
import AuditLogWidget from '@/components/audit-log-widget';
import DepartmentComparisonWidget from '@/components/department-comparison-widget';
import CEOSchedulerCommandCard from '@/components/ceo-scheduler-command-card';
import { api, type AuditEvent, type SchedulerJobResponse } from '@/lib/api';
import type { Workspace, Project, DepartmentConfig, DailyDigestFE } from '@/lib/types';

interface CEODashboardProps {
  workspaces: Workspace[];
  projects: Project[];
  departments: Map<string, DepartmentConfig>;
  onSelectDepartment: (workspaceUri: string) => void;
  onDepartmentSaved?: (uri: string, config: DepartmentConfig) => void;
  onNavigateToProject?: (projectId: string) => void;
  onOpenScheduler?: () => void;
}

export default function CEODashboard({
  workspaces,
  projects,
  departments,
  onSelectDepartment,
  onDepartmentSaved,
  onNavigateToProject,
  onOpenScheduler,
}: CEODashboardProps) {
  const [digests, setDigests] = useState<DailyDigestFE[]>([]);
  const [digestPeriod, setDigestPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [schedulerJobs, setSchedulerJobs] = useState<SchedulerJobResponse[]>([]);
  const [schedulerAuditEvents, setSchedulerAuditEvents] = useState<AuditEvent[]>([]);
  const [schedulerLoading, setSchedulerLoading] = useState(true);

  // Load digests for all workspaces (supports day/week/month period)
  const wsKey = useMemo(() => workspaces.map(w => w.uri).join(','), [workspaces]);
  useEffect(() => {
    if (!workspaces.length) return;
    Promise.all(
      workspaces.map(ws =>
        api.getDailyDigest(ws.uri, undefined, digestPeriod).catch(() => null),
      ),
    ).then(results => {
      setDigests(results.filter((d): d is DailyDigestFE => d !== null));
    });
  }, [wsKey, digestPeriod]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshSchedulerData = useCallback(() => {
    let cancelled = false;
    setSchedulerLoading(true);

    Promise.all([
      api.schedulerJobs().catch(() => [] as SchedulerJobResponse[]),
      api.auditEvents({ limit: 50 }).catch(() => [] as AuditEvent[]),
    ])
      .then(([jobs, auditEvents]) => {
        if (cancelled) return;
        setSchedulerJobs(jobs);
        setSchedulerAuditEvents(auditEvents.filter((event) => event.kind.startsWith('scheduler:')).slice(0, 6));
      })
      .finally(() => {
        if (!cancelled) {
          setSchedulerLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const dispose = refreshSchedulerData();
    const interval = setInterval(() => {
      void refreshSchedulerData();
    }, 10000);

    return () => {
      dispose?.();
      clearInterval(interval);
    };
  }, [refreshSchedulerData]);

  const recentJobs = useMemo(() => {
    const getSortKey = (job: SchedulerJobResponse) => job.nextRunAt || job.lastRunAt || '';
    return [...schedulerJobs]
      .sort((a, b) => {
        if (!!a.enabled !== !!b.enabled) {
          return a.enabled ? -1 : 1;
        }
        return getSortKey(b).localeCompare(getSortKey(a));
      })
      .slice(0, 5);
  }, [schedulerJobs]);

  const enabledJobCount = useMemo(
    () => schedulerJobs.filter(job => job.enabled).length,
    [schedulerJobs],
  );

  const failedSchedulerCount = useMemo(
    () => schedulerAuditEvents.filter((event) => event.kind === 'scheduler:failed').length,
    [schedulerAuditEvents],
  );

  const [setupWorkspaceUri, setSetupWorkspaceUri] = useState<string | null>(null);
  const [drillDownUri, setDrillDownUri] = useState<string | null>(null);
  const setupWs = setupWorkspaceUri ? workspaces.find(w => w.uri === setupWorkspaceUri) : null;
  const setupDept = setupWorkspaceUri ? (departments.get(setupWorkspaceUri) ?? { name: setupWs?.name ?? '', type: 'build' as const, skills: [], okr: null }) : null;

  return (
    <div className="space-y-6">
      {/* ══════ OVERVIEW: Department Grid ══════ */}

      {/* Department Grid */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--app-text-soft)]">
            <span>🏢</span> 部门
          </h3>
          <div className="flex items-center gap-2">
            <button
              className="text-xs text-sky-400/70 hover:text-sky-400 transition-colors"
              onClick={() => {
                const wsPath = prompt('输入新部门的工作区路径（如 /Users/xxx/my-project）');
                if (!wsPath?.trim()) return;
                api.launchWorkspace(wsPath.trim()).then(() => {
                  // Workspace will appear after polling
                }).catch(() => alert('启动失败，请检查路径'));
              }}
            >
              + 添加部门
            </button>
            <span className="text-xs text-[var(--app-text-muted)]">{workspaces.length} 部门</span>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {workspaces.map(ws => {
            const dept = departments.get(ws.uri);
            const deptType = dept?.type || 'build';
            const typeIcon = dept?.typeIcon || (deptType === 'ceo' ? '👔' : deptType === 'research' ? '🔬' : deptType === 'operations' ? '📡' : '🏗️');
            const wsProjects = projects.filter(p => p.workspace === ws.uri);
            const activeCount = wsProjects.filter(p => p.status === 'active').length;
            const completedCount = wsProjects.filter(p => p.status === 'completed').length;
            const failedCount = wsProjects.filter(p => p.status === 'failed').length;

            return (
              <div
                key={ws.uri}
                className="group relative flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.03] p-4 hover:bg-white/[0.06] hover:border-white/12 transition-colors cursor-pointer"
                onClick={() => setDrillDownUri(ws.uri)}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/10 text-lg">
                    {typeIcon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white/90 truncate">{dept?.name || ws.name}</div>
                    <div className="text-[10px] text-[var(--app-text-muted)] truncate">{ws.uri.split('/').pop()}</div>
                  </div>
                  <button
                    className="opacity-0 group-hover:opacity-100 rounded-md p-1.5 text-[var(--app-text-muted)] hover:text-white hover:bg-white/10 transition-all"
                    onClick={(e) => { e.stopPropagation(); setSetupWorkspaceUri(ws.uri); }}
                    title="部门设置"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                </div>
                {/* Status indicators */}
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  {activeCount > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-sky-500/10 border border-sky-500/20 px-2 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                      <span className="text-sky-300">{activeCount} 进行中</span>
                    </span>
                  )}
                  {completedCount > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-emerald-300">
                      ✓ {completedCount}
                    </span>
                  )}
                  {failedCount > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-red-300">
                      ✕ {failedCount}
                    </span>
                  )}
                  {wsProjects.length === 0 && (
                    <span className="text-[var(--app-text-muted)]">暂无项目</span>
                  )}
                </div>
                {/* OKR preview */}
                {dept?.okr?.objectives?.[0]?.title && (
                  <div className="text-[11px] text-[var(--app-text-muted)] truncate border-t border-white/5 pt-1.5 mt-0.5">
                    🎯 {dept.okr.objectives[0].title}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Cross-department comparison (P3-B3) */}
      <DepartmentComparisonWidget
        workspaces={workspaces}
        projects={projects}
        departments={departments}
      />

      <CEOSchedulerCommandCard
        workspaces={workspaces}
        projects={projects}
        departments={departments}
        onScheduled={() => {
          void refreshSchedulerData();
        }}
        onOpenScheduler={onOpenScheduler}
      />

      {/* Recent completions (G5) */}
      {(() => {
        const recentCompleted = projects
          .filter(p => p.status === 'completed')
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, 5);
        if (recentCompleted.length === 0) return null;
        return (
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4 space-y-2">
            <h3 className="text-sm font-semibold text-white/60 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              近期交付
            </h3>
            <div className="space-y-1">
              {recentCompleted.map(p => {
                const dept = departments.get(p.workspace || '');
                const ago = (() => {
                  const d = Math.floor((Date.now() - new Date(p.updatedAt).getTime()) / 60000);
                  if (d < 60) return `${d}m`;
                  if (d < 1440) return `${Math.floor(d / 60)}h`;
                  return `${Math.floor(d / 1440)}d`;
                })();
                return (
                  <button
                    key={p.projectId}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04] transition-colors"
                    onClick={() => onNavigateToProject?.(p.projectId)}
                  >
                    <span className="text-xs text-emerald-400/70">✓</span>
                    <span className="flex-1 truncate text-xs text-white/70">{p.name}</span>
                    {dept && <span className="text-[10px] text-white/30">{dept.name}</span>}
                    <span className="text-[10px] text-white/25 tabular-nums">{ago} ago</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Department Setup Dialog */}
      {setupWs && setupDept && (
        <DepartmentSetupDialog
          workspaceUri={setupWs.uri}
          workspaceName={setupWs.name}
          initialConfig={setupDept}
          open={!!setupWorkspaceUri}
          onOpenChange={open => { if (!open) setSetupWorkspaceUri(null); }}
          onSaved={(config) => {
            onDepartmentSaved?.(setupWs.uri, config);
            setSetupWorkspaceUri(null);
          }}
        />
      )}

      {/* Department Detail Drawer (SimCity drill-down) */}
      {drillDownUri && (() => {
        const ddWs = workspaces.find(w => w.uri === drillDownUri);
        const ddConfig = departments.get(drillDownUri) ?? { name: ddWs?.name ?? '', type: 'build' as const, skills: [], okr: null };
        const ddProjects = projects.filter(p => p.workspace === drillDownUri);
        return ddWs ? (
          <DepartmentDetailDrawer
            open={!!drillDownUri}
            onOpenChange={open => { if (!open) setDrillDownUri(null); }}
            workspace={ddWs}
            config={ddConfig}
            projects={ddProjects}
            onNavigateToProject={(id) => {
              setDrillDownUri(null);
              onNavigateToProject?.(id);
            }}
            onOpenSettings={() => {
              setDrillDownUri(null);
              setSetupWorkspaceUri(drillDownUri);
            }}
          />
        ) : null;
      })()}

      {/* ══════ REFERENCE: Scheduler + Reports + Audit ══════ */}

      {/* Scheduler */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--app-text-soft)]">
            <Clock className="h-4 w-4" /> Scheduler
          </h3>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium text-white/80 hover:bg-white/15 transition-colors"
            onClick={() => onOpenScheduler?.()}
          >
            Open
            <ArrowUpRight className="h-3 w-3" />
          </button>
        </div>

        <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-[var(--app-text-muted)]">
            <span>{enabledJobCount}/{schedulerJobs.length} enabled</span>
            <span>{schedulerLoading ? 'Loading...' : `Recent jobs · ${failedSchedulerCount} failed recently`}</span>
          </div>

          {schedulerLoading ? (
            <div className="text-sm text-[var(--app-text-muted)]">正在加载定时任务...</div>
          ) : recentJobs.length > 0 ? (
            <div className="space-y-2">
              {recentJobs.map(job => (
                <div key={job.jobId} className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', job.enabled ? 'bg-emerald-400' : 'bg-white/20')} />
                    <span className="truncate text-sm font-medium text-white/85">{job.name || job.jobId}</span>
                    {job.lastRunResult && (
                      <span className={cn(
                        'ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium',
                        job.lastRunResult === 'success'
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : job.lastRunResult === 'failed'
                          ? 'bg-red-500/10 text-red-300'
                          : 'bg-amber-500/10 text-amber-300',
                      )}>
                        {job.lastRunResult}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--app-text-muted)]">
                    <span>{job.opcAction ? 'create-project' : job.action?.kind || 'job'}</span>
                    {job.departmentWorkspaceUri && <span>{job.departmentWorkspaceUri.split('/').pop()}</span>}
                    {job.createdBy && <span>via {job.createdBy}</span>}
                    {job.nextRunAt && <span>Next: {new Date(job.nextRunAt).toLocaleString()}</span>}
                    {!job.nextRunAt && job.lastRunAt && <span>Last: {new Date(job.lastRunAt).toLocaleString()}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-[var(--app-text-muted)]">
              还没有任何定时任务。可从这里进入 Scheduler 面板进行创建。
            </div>
          )}

          {schedulerAuditEvents.length > 0 ? (
            <div className="border-t border-white/6 pt-3 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35">Recent activity</div>
              {schedulerAuditEvents.map((event) => (
                <div key={`${event.timestamp}-${event.kind}-${event.jobId || 'scheduler'}`} className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2 text-xs text-white/70">
                  <div className="flex items-center justify-between gap-3">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium',
                      event.kind === 'scheduler:failed'
                        ? 'bg-red-500/10 text-red-300'
                        : event.kind === 'scheduler:triggered'
                        ? 'bg-emerald-500/10 text-emerald-300'
                        : 'bg-white/8 text-white/55',
                    )}>
                      {event.kind}
                    </span>
                    <span className="text-[10px] text-white/35">{new Date(event.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 leading-relaxed text-white/55">{event.message}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Audit Log (P1-D3) */}
      <AuditLogWidget />

      {/* Digests with period selector */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/60">
            {digestPeriod === 'day' ? '📊 日报' : digestPeriod === 'week' ? '📊 周报' : '📊 月报'}
          </h3>
          <div className="flex gap-1 rounded-lg bg-white/[0.05] p-0.5">
            {(['day', 'week', 'month'] as const).map(p => (
              <button
                key={p}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${digestPeriod === p ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
                onClick={() => setDigestPeriod(p)}
              >
                {p === 'day' ? '日' : p === 'week' ? '周' : '月'}
              </button>
            ))}
          </div>
        </div>
        {digests.length > 0 ? (
          digests.map(digest => (
            <DailyDigestCard
              key={`${digest.workspaceUri}-${digest.date}-${digestPeriod}`}
              digest={digest}
              onNavigateToProject={(id) => onNavigateToProject?.(id)}
            />
          ))
        ) : (
          <p className="text-xs text-[var(--app-text-muted)] text-center py-4">暂无数据</p>
        )}
      </div>

    </div>
  );
}
