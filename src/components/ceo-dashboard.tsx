'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { CheckCircle2, Settings, Building2, UserRound, FlaskConical, Radio, Hammer } from 'lucide-react';
import { cn } from '@/lib/utils';
import DepartmentSetupDialog from '@/components/department-setup-dialog';
import DailyDigestCard from '@/components/daily-digest-card';
import DepartmentDetailDrawer from '@/components/department-detail-drawer';
import AuditLogWidget from '@/components/audit-log-widget';
import DepartmentComparisonWidget from '@/components/department-comparison-widget';
import {
  WorkspaceBadge,
  WorkspaceInteractiveSurface,
  WorkspaceListItem,
  WorkspaceMiniMetric,
  WorkspaceSurface,
  workspaceOutlineActionClassName,
} from '@/components/ui/workspace-primitives';
import { api } from '@/lib/api';
import { isTauriDesktop, selectLocalFolder } from '@/lib/desktop-folder-picker';
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
}

export default function CEODashboard({
  workspaces,
  projects,
  departments,
  onDepartmentSaved,
  onRefresh,
  onNavigateToProject,
}: CEODashboardProps) {
  const [digests, setDigests] = useState<DailyDigestFE[]>([]);
  const [digestPeriod, setDigestPeriod] = useState<'day' | 'week' | 'month'>('day');
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
  }, [projects.length, workspaces.length]);

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

  const [setupWorkspaceUri, setSetupWorkspaceUri] = useState<string | null>(null);
  const [drillDownUri, setDrillDownUri] = useState<string | null>(null);
  const [extraWorkspaces, setExtraWorkspaces] = useState<Workspace[]>([]);
  const [importingDepartment, setImportingDepartment] = useState(false);
  const [departmentImportError, setDepartmentImportError] = useState<string | null>(null);
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

  const handleAddDepartment = useCallback(async () => {
    setDepartmentImportError(null);
    setImportingDepartment(true);
    try {
      const selectedPath = isTauriDesktop()
        ? await selectLocalFolder('选择要作为部门的文件夹')
        : window.prompt('输入新部门的工作区路径（如 /Users/xxx/my-project）')?.trim() || null;

      if (!selectedPath) {
        return;
      }

      const result = await api.importWorkspace(selectedPath);
      setExtraWorkspaces(prev => {
        const merged = new Map(prev.map((workspace) => [workspace.uri, workspace]));
        merged.set(result.workspace.uri, result.workspace);
        return [...merged.values()];
      });
      setSetupWorkspaceUri(result.workspace.uri);
      onRefresh?.();
    } catch (error) {
      setDepartmentImportError(error instanceof Error ? error.message : '导入失败，请检查路径');
    } finally {
      setImportingDepartment(false);
    }
  }, [onRefresh]);

  return (
    <div className="space-y-6">
      {(managementOverview || ceoRoutine) && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <WorkspaceMiniMetric label="Active Projects" value={managementOverview?.activeProjects ?? 0} tone="accent" />
          <WorkspaceMiniMetric label="Pending Approvals" value={managementOverview?.pendingApprovals ?? ceoRoutine?.pendingApprovals ?? 0} tone="warning" />
          <WorkspaceMiniMetric label="Active Schedulers" value={managementOverview?.activeSchedulers ?? ceoRoutine?.activeSchedulers ?? 0} tone="info" />
          <WorkspaceMiniMetric label="Recent Knowledge" value={managementOverview?.recentKnowledge ?? ceoRoutine?.recentKnowledge ?? 0} tone="success" />
        </div>
      )}

      {managementOverview && (
        <div className="grid gap-3 lg:grid-cols-2">
          <WorkspaceSurface className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--app-text-soft)]">OKR Progress</h3>
            <div className="text-3xl font-bold text-[var(--app-text)]">
              {managementOverview.okrProgress !== null
                ? `${Math.round(managementOverview.okrProgress * 100)}%`
                : '—'}
            </div>
            <p className="text-xs text-[var(--app-text-soft)]">组织级关键结果平均进度</p>
          </WorkspaceSurface>
          <WorkspaceSurface className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--app-text-soft)]">Risk Dashboard</h3>
            {managementOverview.risks.length > 0 ? (
              <div className="space-y-2">
                {managementOverview.risks.slice(0, 4).map((risk, index) => (
                  <WorkspaceListItem
                    key={`${risk.title}-${index}`}
                    title={risk.title}
                    description={risk.description}
                    tone={risk.level === 'critical' ? 'danger' : risk.level === 'warning' ? 'warning' : 'neutral'}
                    meta={risk.level}
                  />
                ))}
              </div>
            ) : (
              <div className="text-xs text-[var(--app-text-soft)]">暂无高优风险</div>
            )}
          </WorkspaceSurface>
        </div>
      )}

      {ceoRoutine && ceoRoutine.highlights.length > 0 && (
        <WorkspaceSurface className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--app-text-soft)]">CEO Routine Summary</h3>
          <p className="text-sm text-[var(--app-text-soft)]">{ceoRoutine.overview}</p>
          <div className="space-y-1">
            {ceoRoutine.highlights.slice(0, 4).map((highlight, index) => (
              <div key={index} className="text-xs text-[var(--app-text-soft)]">
                • {highlight}
              </div>
            ))}
          </div>
          {ceoRoutine.reminders.length > 0 && (
            <div className="pt-2 border-t border-[var(--app-border-soft)]">
              <div className="text-[11px] uppercase tracking-widest text-[var(--app-text-muted)] mb-1">Reminders</div>
              <div className="space-y-1">
                {ceoRoutine.reminders.slice(0, 3).map((item, index) => (
                  <div key={index} className="text-xs text-[var(--app-text-soft)]">• {item}</div>
                ))}
              </div>
            </div>
          )}
          {ceoRoutine.escalations.length > 0 && (
            <div className="pt-2 border-t border-[var(--app-border-soft)]">
              <div className="text-[11px] uppercase tracking-widest text-red-300/50 mb-1">Escalations</div>
              <div className="space-y-1">
                {ceoRoutine.escalations.slice(0, 3).map((item, index) => (
                  <div key={index} className="text-xs text-red-200/70">• {item}</div>
                ))}
              </div>
            </div>
          )}
        </WorkspaceSurface>
      )}

      <WorkspaceSurface className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--app-text-soft)]">Evolution Pipeline</h3>
            <p className="text-xs text-[var(--app-text-muted)]">Proposal → evaluate → approval → publish → observe</p>
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
          <div className="text-xs text-[var(--app-text-soft)]">Loading evolution proposals…</div>
        ) : evolutionProposals.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {evolutionProposals.slice(0, 6).map((proposal) => (
              <WorkspaceSurface key={proposal.id} padding="sm" className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--app-text)]">{proposal.title}</div>
                    <div className="mt-1 text-[11px] text-[var(--app-text-muted)]">{proposal.targetRef}</div>
                  </div>
                  <WorkspaceBadge tone={
                    proposal.status === 'published' ? 'success' :
                    proposal.status === 'pending-approval' ? 'warning' :
                    proposal.status === 'rejected' ? 'danger' :
                    proposal.status === 'evaluated' ? 'info' :
                    'neutral'
                  }>
                    {proposal.status}
                  </WorkspaceBadge>
                </div>

                <div className="text-xs leading-5 text-[var(--app-text-soft)]">{proposal.rationale}</div>

                {proposal.evaluation && (
                  <WorkspaceSurface padding="sm" className="text-[11px] text-[var(--app-text-soft)]">
                    Eval: {proposal.evaluation.summary}
                  </WorkspaceSurface>
                )}

                {proposal.rollout && (
                  <WorkspaceSurface padding="sm" className="text-[11px] text-[var(--app-text-soft)]">
                    Observe: {proposal.rollout.summary}
                  </WorkspaceSurface>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {proposal.status === 'draft' && (
                    <button
                      className={cn('rounded-lg px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40', workspaceOutlineActionClassName)}
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
                    <div className="text-[11px] text-[var(--app-text-muted)]">
                      Awaiting approval #{proposal.approvalRequestId.slice(0, 8)}
                    </div>
                  )}
                </div>
              </WorkspaceSurface>
            ))}
          </div>
        ) : (
          <div className="text-xs text-[var(--app-text-soft)]">暂无 evolution proposals，可从 knowledge proposal 或重复 prompt 执行自动生成。</div>
        )}
      </WorkspaceSurface>

      {/* ══════ OVERVIEW: Department Grid ══════ */}

      {/* Department Grid */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--app-text-soft)]">
            <Building2 className="h-4 w-4 text-[var(--app-accent)]" /> 部门
          </h3>
          <div className="flex items-center gap-2">
            <button
              className="text-xs text-sky-400/70 transition-colors hover:text-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handleAddDepartment()}
              disabled={importingDepartment}
            >
              {importingDepartment ? '导入中...' : '+ 新建部门'}
            </button>
            <span className="text-xs text-[var(--app-text-muted)]">{allWorkspaces.length} 部门</span>
          </div>
        </div>
        {departmentImportError && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {departmentImportError}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {allWorkspaces.map(ws => {
            const dept = departments.get(ws.uri);
            const deptType = dept?.type || 'build';
            const TypeIcon = deptType === 'ceo'
              ? UserRound
              : deptType === 'research'
                ? FlaskConical
                : deptType === 'operations'
                  ? Radio
                  : Hammer;
            const wsProjects = projects.filter(p => p.workspace === ws.uri);
            const activeCount = wsProjects.filter(p => p.status === 'active').length;
            const completedCount = wsProjects.filter(p => p.status === 'completed').length;
            const failedCount = wsProjects.filter(p => p.status === 'failed').length;

            return (
              <WorkspaceInteractiveSurface
                key={ws.uri}
                className="relative flex flex-col gap-2"
                onClick={() => setDrillDownUri(ws.uri)}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-accent)]">
                    <TypeIcon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[var(--app-text)] truncate">{dept?.name || ws.name}</div>
                    <div className="text-[10px] text-[var(--app-text-muted)] truncate">{ws.uri.split('/').pop()}</div>
                  </div>
                  <button
                    className="rounded-md p-1.5 text-[var(--app-text-muted)] opacity-0 transition-all hover:bg-[var(--app-raised-2)] hover:text-[var(--app-text)] group-hover:opacity-100"
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
                      <span className="text-sky-700">{activeCount} 进行中</span>
                    </span>
                  )}
                  {completedCount > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-emerald-700">
                      ✓ {completedCount}
                    </span>
                  )}
                  {failedCount > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-red-700">
                      ✕ {failedCount}
                    </span>
                  )}
                  {wsProjects.length === 0 && (
                    <span className="text-[var(--app-text-muted)]">暂无项目</span>
                  )}
                </div>
                {/* OKR preview */}
                {dept?.okr?.objectives?.[0]?.title && (
                  <div className="text-[11px] text-[var(--app-text-muted)] truncate border-t border-[var(--app-border-soft)] pt-1.5 mt-0.5">
                    {dept.okr.objectives[0].title}
                  </div>
                )}
              </WorkspaceInteractiveSurface>
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

      {/* Recent completions (G5) */}
      {(() => {
        const recentCompleted = projects
          .filter(p => p.status === 'completed')
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, 5);
        if (recentCompleted.length === 0) return null;
        return (
          <WorkspaceSurface className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--app-text-soft)] flex items-center gap-1.5">
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
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--app-raised)]"
                    onClick={() => onNavigateToProject?.(p.projectId)}
                  >
                    <span className="text-xs text-emerald-400/70">✓</span>
                    <span className="flex-1 truncate text-xs text-[var(--app-text-soft)]">{p.name}</span>
                    {dept && <span className="text-[10px] text-[var(--app-text-muted)]">{dept.name}</span>}
                    <span className="text-[10px] text-[var(--app-text-muted)] tabular-nums">{ago} ago</span>
                  </button>
                );
              })}
            </div>
          </WorkspaceSurface>
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

      {/* Audit Log (P1-D3) */}
      <AuditLogWidget />

      {/* Digests with period selector */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--app-text-soft)]">
            {digestPeriod === 'day' ? '日报' : digestPeriod === 'week' ? '周报' : '月报'}
          </h3>
          <div className="flex gap-1 rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-0.5">
            {(['day', 'week', 'month'] as const).map(p => (
              <button
                key={p}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs transition-colors',
                  digestPeriod === p ? 'bg-[var(--app-surface)] text-[var(--app-text)] shadow-sm' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text-soft)]',
                )}
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
