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
import type {
  Workspace,
  Project,
  DepartmentConfig,
  DailyDigestFE,
  CEORoutineSummaryFE,
  ManagementOverviewFE,
  EvolutionProposalFE,
} from '@/lib/types';

interface CEODashboardProps {
  workspaces: Workspace[];
  projects: Project[];
  departments: Map<string, DepartmentConfig>;
  onSelectDepartment: (workspaceUri: string) => void;
  onDepartmentSaved?: (uri: string, config: DepartmentConfig) => void;
  onRefresh?: () => void;
  onNavigateToProject?: (projectId: string) => void;
  onOpenScheduler?: () => void;
  onProjectCreated?: (projectId: string) => void;
}

export default function CEODashboard({
  workspaces,
  projects,
  departments,
  onDepartmentSaved,
  onRefresh,
  onNavigateToProject,
  onOpenScheduler,
  onProjectCreated,
}: CEODashboardProps) {
  const [digests, setDigests] = useState<DailyDigestFE[]>([]);
  const [digestPeriod, setDigestPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [schedulerJobs, setSchedulerJobs] = useState<SchedulerJobResponse[]>([]);
  const [schedulerAuditEvents, setSchedulerAuditEvents] = useState<AuditEvent[]>([]);
  const [schedulerLoading, setSchedulerLoading] = useState(true);
  const [ceoRoutine, setCeoRoutine] = useState<CEORoutineSummaryFE | null>(null);
  const [managementOverview, setManagementOverview] = useState<ManagementOverviewFE | null>(null);
  const [evolutionProposals, setEvolutionProposals] = useState<EvolutionProposalFE[]>([]);
  const [evolutionLoading, setEvolutionLoading] = useState(true);
  const [evolutionBusyId, setEvolutionBusyId] = useState<string | null>(null);

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

  const enabledJobCount = schedulerJobs.filter((job) => job.enabled).length;
  const failedSchedulerCount = schedulerAuditEvents.filter((event) => event.kind === 'scheduler:failed').length;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.ceoRoutine().catch(() => null),
      api.managementOverview().catch(() => null),
    ]).then(([routine, overview]) => {
      if (cancelled) return;
      setCeoRoutine(routine as CEORoutineSummaryFE | null);
      setManagementOverview(overview as ManagementOverviewFE | null);
    });

    return () => {
      cancelled = true;
    };
  }, [projects.length, workspaces.length, enabledJobCount, failedSchedulerCount]);

  const refreshEvolutionData = useCallback(async () => {
    setEvolutionLoading(true);
    try {
      const result = await api.evolutionProposals();
      setEvolutionProposals(result.proposals || []);
    } catch {
      setEvolutionProposals([]);
    } finally {
      setEvolutionLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshEvolutionData();
  }, [refreshEvolutionData]);

  const handleGenerateEvolution = useCallback(async () => {
    setEvolutionBusyId('__generate__');
    try {
      await api.generateEvolutionProposals();
      await refreshEvolutionData();
    } finally {
      setEvolutionBusyId(null);
    }
  }, [refreshEvolutionData]);

  const handleEvaluateProposal = useCallback(async (proposalId: string) => {
    setEvolutionBusyId(proposalId);
    try {
      await api.evaluateEvolutionProposal(proposalId);
      await refreshEvolutionData();
    } finally {
      setEvolutionBusyId(null);
    }
  }, [refreshEvolutionData]);

  const handlePublishProposal = useCallback(async (proposalId: string) => {
    setEvolutionBusyId(proposalId);
    try {
      await api.publishEvolutionProposal(proposalId);
      await refreshEvolutionData();
    } finally {
      setEvolutionBusyId(null);
    }
  }, [refreshEvolutionData]);

  const handleObserveProposal = useCallback(async (proposalId: string) => {
    setEvolutionBusyId(proposalId);
    try {
      await api.observeEvolutionProposal(proposalId);
      await refreshEvolutionData();
    } finally {
      setEvolutionBusyId(null);
    }
  }, [refreshEvolutionData]);

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

  const [setupWorkspaceUri, setSetupWorkspaceUri] = useState<string | null>(null);
  const [drillDownUri, setDrillDownUri] = useState<string | null>(null);
  const [extraWorkspaces, setExtraWorkspaces] = useState<Workspace[]>([]);
  const allWorkspaces = useMemo(() => {
    const merged = new Map<string, Workspace>();
    for (const workspace of workspaces) {
      merged.set(workspace.uri, workspace);
    }
    for (const workspace of extraWorkspaces) {
      merged.set(workspace.uri, workspace);
    }
    return [...merged.values()];
  }, [extraWorkspaces, workspaces]);
  const setupWs = setupWorkspaceUri ? allWorkspaces.find(w => w.uri === setupWorkspaceUri) : null;
  const setupDept = setupWorkspaceUri ? (departments.get(setupWorkspaceUri) ?? { name: setupWs?.name ?? '', type: 'build' as const, skills: [], okr: null }) : null;

  return (
    <div className="space-y-6">
      {(managementOverview || ceoRoutine) && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
            <div className="text-[11px] uppercase tracking-widest text-white/40">Active Projects</div>
            <div className="mt-2 text-2xl font-bold text-white">{managementOverview?.activeProjects ?? 0}</div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
            <div className="text-[11px] uppercase tracking-widest text-white/40">Pending Approvals</div>
            <div className="mt-2 text-2xl font-bold text-amber-300">{managementOverview?.pendingApprovals ?? ceoRoutine?.pendingApprovals ?? 0}</div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
            <div className="text-[11px] uppercase tracking-widest text-white/40">Active Schedulers</div>
            <div className="mt-2 text-2xl font-bold text-sky-300">{managementOverview?.activeSchedulers ?? ceoRoutine?.activeSchedulers ?? 0}</div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
            <div className="text-[11px] uppercase tracking-widest text-white/40">Recent Knowledge</div>
            <div className="mt-2 text-2xl font-bold text-emerald-300">{managementOverview?.recentKnowledge ?? ceoRoutine?.recentKnowledge ?? 0}</div>
          </div>
        </div>
      )}

      {managementOverview && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4 space-y-2">
            <h3 className="text-sm font-semibold text-white/70">OKR Progress</h3>
            <div className="text-3xl font-bold text-white">
              {managementOverview.okrProgress !== null
                ? `${Math.round(managementOverview.okrProgress * 100)}%`
                : '—'}
            </div>
            <p className="text-xs text-white/45">组织级关键结果平均进度</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4 space-y-2">
            <h3 className="text-sm font-semibold text-white/70">Risk Dashboard</h3>
            {managementOverview.risks.length > 0 ? (
              <div className="space-y-2">
                {managementOverview.risks.slice(0, 4).map((risk, index) => (
                  <div key={`${risk.title}-${index}`} className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-white/85">{risk.title}</div>
                      <div className={cn(
                        'rounded-full px-2 py-0.5 text-[10px]',
                        risk.level === 'critical' ? 'bg-red-500/10 text-red-300' :
                        risk.level === 'warning' ? 'bg-amber-500/10 text-amber-300' :
                        'bg-white/10 text-white/60',
                      )}>
                        {risk.level}
                      </div>
                    </div>
                    {risk.description ? (
                      <div className="mt-1 text-[11px] text-white/45">{risk.description}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-white/45">暂无高优风险</div>
            )}
          </div>
        </div>
      )}

      {ceoRoutine && ceoRoutine.highlights.length > 0 && (
        <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4 space-y-2">
          <h3 className="text-sm font-semibold text-white/70">CEO Routine Summary</h3>
          <p className="text-sm text-white/70">{ceoRoutine.overview}</p>
          <div className="space-y-1">
            {ceoRoutine.highlights.slice(0, 4).map((highlight, index) => (
              <div key={index} className="text-xs text-white/50">
                • {highlight}
              </div>
            ))}
          </div>
          {ceoRoutine.reminders.length > 0 && (
            <div className="pt-2 border-t border-white/5">
              <div className="text-[11px] uppercase tracking-widest text-white/35 mb-1">Reminders</div>
              <div className="space-y-1">
                {ceoRoutine.reminders.slice(0, 3).map((item, index) => (
                  <div key={index} className="text-xs text-white/50">• {item}</div>
                ))}
              </div>
            </div>
          )}
          {ceoRoutine.escalations.length > 0 && (
            <div className="pt-2 border-t border-white/5">
              <div className="text-[11px] uppercase tracking-widest text-red-300/50 mb-1">Escalations</div>
              <div className="space-y-1">
                {ceoRoutine.escalations.slice(0, 3).map((item, index) => (
                  <div key={index} className="text-xs text-red-200/70">• {item}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white/70">Evolution Pipeline</h3>
            <p className="text-xs text-white/40">Proposal → evaluate → approval → publish → observe</p>
          </div>
          <button
            className="rounded-lg border border-sky-400/20 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-200 transition-colors hover:bg-sky-500/15 disabled:opacity-40"
            onClick={() => void handleGenerateEvolution()}
            disabled={evolutionBusyId === '__generate__'}
          >
            Generate Proposals
          </button>
        </div>

        {evolutionLoading ? (
          <div className="text-xs text-white/45">Loading evolution proposals…</div>
        ) : evolutionProposals.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {evolutionProposals.slice(0, 6).map((proposal) => (
              <div key={proposal.id} className="rounded-lg border border-white/6 bg-white/[0.02] p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white/85">{proposal.title}</div>
                    <div className="mt-1 text-[11px] text-white/45">{proposal.targetRef}</div>
                  </div>
                  <div className={cn(
                    'rounded-full px-2 py-0.5 text-[10px]',
                    proposal.status === 'published' ? 'bg-emerald-500/10 text-emerald-300' :
                    proposal.status === 'pending-approval' ? 'bg-amber-500/10 text-amber-300' :
                    proposal.status === 'rejected' ? 'bg-red-500/10 text-red-300' :
                    proposal.status === 'evaluated' ? 'bg-sky-500/10 text-sky-300' :
                    'bg-white/10 text-white/60',
                  )}>
                    {proposal.status}
                  </div>
                </div>

                <div className="text-xs leading-5 text-white/55">{proposal.rationale}</div>

                {proposal.evaluation && (
                  <div className="rounded-md border border-white/6 bg-white/[0.02] px-3 py-2 text-[11px] text-white/50">
                    Eval: {proposal.evaluation.summary}
                  </div>
                )}

                {proposal.rollout && (
                  <div className="rounded-md border border-white/6 bg-white/[0.02] px-3 py-2 text-[11px] text-white/50">
                    Observe: {proposal.rollout.summary}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {proposal.status === 'draft' && (
                    <button
                      className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/10 disabled:opacity-40"
                      onClick={() => void handleEvaluateProposal(proposal.id)}
                      disabled={evolutionBusyId === proposal.id}
                    >
                      Evaluate
                    </button>
                  )}
                  {proposal.status === 'evaluated' && (
                    <button
                      className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-200 transition-colors hover:bg-amber-500/15 disabled:opacity-40"
                      onClick={() => void handlePublishProposal(proposal.id)}
                      disabled={evolutionBusyId === proposal.id}
                    >
                      Request Publish
                    </button>
                  )}
                  {proposal.status === 'published' && (
                    <button
                      className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200 transition-colors hover:bg-emerald-500/15 disabled:opacity-40"
                      onClick={() => void handleObserveProposal(proposal.id)}
                      disabled={evolutionBusyId === proposal.id}
                    >
                      Refresh Observe
                    </button>
                  )}
                  {proposal.status === 'pending-approval' && proposal.approvalRequestId && (
                    <div className="text-[11px] text-white/45">
                      Awaiting approval #{proposal.approvalRequestId.slice(0, 8)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-white/45">暂无 evolution proposals，可从 knowledge proposal 或重复 prompt 执行自动生成。</div>
        )}
      </div>

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
              onClick={async () => {
                const wsPath = prompt('输入新部门的工作区路径（如 /Users/xxx/my-project）');
                if (!wsPath?.trim()) return;
                try {
                  const result = await api.importWorkspace(wsPath.trim());
                  setExtraWorkspaces(prev => {
                    const merged = new Map(prev.map((workspace) => [workspace.uri, workspace]));
                    merged.set(result.workspace.uri, result.workspace);
                    return [...merged.values()];
                  });
                  setSetupWorkspaceUri(result.workspace.uri);
                  onRefresh?.();
                } catch {
                  alert('导入失败，请检查路径');
                }
              }}
            >
              + 添加部门
            </button>
            <span className="text-xs text-[var(--app-text-muted)]">{allWorkspaces.length} 部门</span>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {allWorkspaces.map(ws => {
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
        workspaces={allWorkspaces}
        projects={projects}
        departments={departments}
      />

      <CEOSchedulerCommandCard
        workspaces={allWorkspaces}
        projects={projects}
        departments={departments}
        onScheduled={() => {
          void refreshSchedulerData();
        }}
        onOpenScheduler={onOpenScheduler}
        onProjectCreated={(projectId) => onProjectCreated?.(projectId)}
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
        const ddWs = allWorkspaces.find(w => w.uri === drillDownUri);
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
