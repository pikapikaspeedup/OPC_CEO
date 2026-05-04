'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { CheckCircle2, Settings, Building2, UserRound, FlaskConical, Radio, Hammer, Bot, GitBranch, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import DepartmentSetupDialog from '@/components/department-setup-dialog';
import LocalFolderImportDialog from '@/components/local-folder-import-dialog';
import DailyDigestCard from '@/components/daily-digest-card';
import DepartmentDetailDrawer from '@/components/department-detail-drawer';
import AuditLogWidget from '@/components/audit-log-widget';
import DepartmentComparisonWidget from '@/components/department-comparison-widget';
import { Button } from '@/components/ui/button';
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
import {
  getDepartmentBoundWorkspaceUris,
  getDepartmentGroupKey,
  workspaceNameFromUri,
} from '@/lib/department-config';
import type {
  Workspace,
  Project,
  DepartmentConfig,
  DailyDigestFE,
  CEORoutineSummaryFE,
  ManagementOverviewFE,
  EvolutionProposalFE,
  SystemImprovementProposalFE,
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

function getSelfIterationTone(proposal: SystemImprovementProposalFE): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (proposal.exitEvidence?.mergeGate.status === 'ready-to-merge') return 'success';
  if (proposal.exitEvidence?.mergeGate.status === 'blocked') return 'danger';
  if (proposal.status === 'approval-required') return 'warning';
  if (proposal.status === 'in-progress' || proposal.status === 'testing') return 'info';
  if (proposal.status === 'rejected' || proposal.status === 'rolled-back') return 'danger';
  return 'neutral';
}

function formatSelfIterationStatus(proposal: SystemImprovementProposalFE): string {
  switch (proposal.exitEvidence?.releaseGate?.status) {
    case 'preflight-failed':
      return '预检失败';
    case 'ready-for-approval':
      return '待批准发布';
    case 'approved':
      return '已批准发布';
    case 'merged':
      return '已合并待重启';
    case 'restarted':
      return '已重启';
    case 'observing':
      return '观察中';
    case 'rolled-back':
      return '已回滚';
    default:
      break;
  }
  if (proposal.exitEvidence?.mergeGate.status === 'ready-to-merge') return '待发布检查';
  if (proposal.exitEvidence?.mergeGate.status === 'blocked') return '证据阻塞';
  switch (proposal.status) {
    case 'approval-required':
      return '待准入审批';
    case 'approved':
      return '已批准待执行';
    case 'in-progress':
      return 'Codex 执行中';
    case 'testing':
      return '待验证';
    case 'ready-to-merge':
      return '待发布检查';
    case 'published':
      return '已合并';
    case 'observing':
      return '观察中';
    case 'rejected':
      return '已拒绝';
    case 'needs-evidence':
      return '待补证据';
    default:
      return '草稿';
  }
}

function buildSelfIterationEvidenceLine(proposal: SystemImprovementProposalFE): string {
  if (proposal.exitEvidence?.releaseGate) {
    const releaseGate = proposal.exitEvidence.releaseGate;
    return [
      `release ${releaseGate.status}`,
      `${releaseGate.checks.filter((item) => item.status === 'passed').length}/${releaseGate.checks.length} checks`,
      releaseGate.patchPath ? releaseGate.patchPath.split('/').pop() : 'no patch',
    ].join(' · ');
  }
  const codex = proposal.exitEvidence?.codex;
  if (codex) {
    return [
      `${codex.changedFiles.length} files`,
      `${codex.passedValidationCount}/${codex.validationCount} checks`,
      codex.disallowedFiles.length ? `${codex.disallowedFiles.length} out-of-scope` : 'scope ok',
      codex.branch,
    ].join(' · ');
  }
  if (proposal.exitEvidence?.latestRun) {
    return `Run ${proposal.exitEvidence.latestRun.status} · ${proposal.exitEvidence.latestRun.changedFilesCount} files`;
  }
  return proposal.affectedFiles.length ? proposal.affectedFiles.slice(0, 3).join(', ') : proposal.summary;
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
  const [selfIterationProposals, setSelfIterationProposals] = useState<SystemImprovementProposalFE[]>([]);
  const [selfIterationLoading, setSelfIterationLoading] = useState(true);

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

  const refreshSelfIterationData = useCallback(async () => {
    setSelfIterationLoading(true);
    try {
      const result = await api.systemImprovementProposals({ pageSize: 8 });
      setSelfIterationProposals(result.items || []);
    } catch {
      setSelfIterationProposals([]);
    } finally {
      setSelfIterationLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSelfIterationData();
  }, [refreshSelfIterationData]);

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
  const [departmentImportDialogOpen, setDepartmentImportDialogOpen] = useState(false);
  const [departmentImportPath, setDepartmentImportPath] = useState('');
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
  const departmentCards = useMemo(() => {
    const seen = new Set<string>();
    return allWorkspaces.flatMap((workspace) => {
      const config = departments.get(workspace.uri) ?? null;
      const groupKey = config
        ? getDepartmentGroupKey(config, workspace.uri, workspace.name)
        : workspace.uri;
      if (seen.has(groupKey)) {
        return [];
      }
      seen.add(groupKey);

      const primaryWorkspace = allWorkspaces.find((entry) => entry.uri === groupKey) ?? workspace;
      const boundWorkspaceUris = config
        ? getDepartmentBoundWorkspaceUris(config, primaryWorkspace.uri, primaryWorkspace.name)
        : [primaryWorkspace.uri];
      const boundWorkspaces = boundWorkspaceUris.map((uri) => (
        allWorkspaces.find((entry) => entry.uri === uri) ?? { uri, name: workspaceNameFromUri(uri) }
      ));
      const scopedProjects = projects.filter((project) => project.workspace && boundWorkspaceUris.includes(project.workspace));

      return [{
        key: groupKey,
        workspace: primaryWorkspace,
        config,
        boundWorkspaces,
        projects: scopedProjects,
      }];
    }).sort((left, right) => {
      const leftConfigured = left.config ? 1 : 0;
      const rightConfigured = right.config ? 1 : 0;
      if (leftConfigured !== rightConfigured) return rightConfigured - leftConfigured;
      return (left.config?.name || left.workspace.name).localeCompare(right.config?.name || right.workspace.name);
    });
  }, [allWorkspaces, departments, projects]);
  const setupWs = setupWorkspaceUri ? allWorkspaces.find(w => w.uri === setupWorkspaceUri) : null;
  const setupDept = setupWorkspaceUri ? (departments.get(setupWorkspaceUri) ?? { name: setupWs?.name ?? '', type: 'build' as const, skills: [], okr: null }) : null;
  const drillDownCard = drillDownUri
    ? departmentCards.find((card) => card.key === drillDownUri) || null
    : null;

  const handleAddDepartment = useCallback(() => {
    setDepartmentImportError(null);
    setDepartmentImportPath('');
    setDepartmentImportDialogOpen(true);
  }, []);

  const handleBrowseDepartment = useCallback(async () => {
    const selectedPath = await selectLocalFolder('选择要作为部门的文件夹');
    if (!selectedPath) return;
    setDepartmentImportPath(selectedPath);
  }, []);

  const handleConfirmDepartmentImport = useCallback(async () => {
    const normalizedPath = departmentImportPath.trim();
    if (!normalizedPath) {
      setDepartmentImportError('请输入部门主目录路径');
      return;
    }

    setDepartmentImportError(null);
    setImportingDepartment(true);
    try {
      const result = await api.importWorkspace(normalizedPath);
      setExtraWorkspaces(prev => {
        const merged = new Map(prev.map((workspace) => [workspace.uri, workspace]));
        merged.set(result.workspace.uri, result.workspace);
        return [...merged.values()];
      });
      setDepartmentImportDialogOpen(false);
      setDepartmentImportPath('');
      setSetupWorkspaceUri(result.workspace.uri);
      onRefresh?.();
    } catch (error) {
      setDepartmentImportError(error instanceof Error ? error.message : '导入失败，请检查路径');
    } finally {
      setImportingDepartment(false);
    }
  }, [departmentImportPath, onRefresh]);

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--app-text-soft)]">
              <Bot className="h-4 w-4 text-[var(--app-accent)]" />
              软件自迭代证据
            </h3>
            <p className="text-xs text-[var(--app-text-muted)]">这里展示 Codex worktree 执行、测试证据和发布状态；需要 CEO 动作的项目进入上方决策队列。</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <WorkspaceBadge tone="warning">
              {selfIterationProposals.filter(item => item.status === 'approval-required').length} 准入
            </WorkspaceBadge>
            <WorkspaceBadge tone="info">
              {selfIterationProposals.filter(item => item.status === 'approved' || item.status === 'in-progress' || item.status === 'testing').length} 执行
            </WorkspaceBadge>
            <WorkspaceBadge tone="success">
              {selfIterationProposals.filter(item => item.exitEvidence?.mergeGate.status === 'ready-to-merge').length} 待发布
            </WorkspaceBadge>
          </div>
        </div>

        {selfIterationLoading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--app-text-soft)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading self-iteration proposals…
          </div>
        ) : selfIterationProposals.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {selfIterationProposals.slice(0, 6).map((proposal) => {
              const projectId = proposal.exitEvidence?.project?.projectId;
              return (
                <WorkspaceSurface key={proposal.id} padding="sm" tone={getSelfIterationTone(proposal)} className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--app-text)]">{proposal.title}</div>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--app-text-soft)]">{proposal.summary}</div>
                    </div>
                    <WorkspaceBadge tone={getSelfIterationTone(proposal)}>
                      {formatSelfIterationStatus(proposal)}
                    </WorkspaceBadge>
                  </div>

                  <div className="grid gap-2 text-[11px] text-[var(--app-text-soft)] sm:grid-cols-3">
                    <div className="rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-2.5 py-2">
                      <div className="text-[var(--app-text-muted)]">Risk</div>
                      <div className="mt-1 font-semibold text-[var(--app-text)]">{proposal.risk}</div>
                    </div>
                    <div className="rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-2.5 py-2">
                      <div className="text-[var(--app-text-muted)]">Scope</div>
                      <div className="mt-1 truncate font-semibold text-[var(--app-text)]">{proposal.affectedFiles.length || 0} files</div>
                    </div>
                    <div className="rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-2.5 py-2">
                      <div className="text-[var(--app-text-muted)]">Gate</div>
                      <div className="mt-1 font-semibold text-[var(--app-text)]">{proposal.exitEvidence?.mergeGate.status || 'pending'}</div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-2 text-[11px] leading-5 text-[var(--app-text-soft)]">
                    <div className="flex items-center gap-1.5 font-medium text-[var(--app-text)]">
                      <GitBranch className="h-3.5 w-3.5" />
                      {buildSelfIterationEvidenceLine(proposal)}
                    </div>
                    {proposal.exitEvidence?.mergeGate.reasons?.[0] ? (
                      <div className="mt-1 text-[var(--app-text-muted)]">{proposal.exitEvidence.mergeGate.reasons[0]}</div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {projectId ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={cn('h-8 rounded-[8px] px-2.5 text-xs', workspaceOutlineActionClassName)}
                        onClick={() => onNavigateToProject?.(projectId)}
                      >
                        查看项目
                      </Button>
                    ) : null}
                  </div>
                </WorkspaceSurface>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-[var(--app-text-soft)]">暂无软件自迭代 proposal。</div>
        )}
      </WorkspaceSurface>

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
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn('h-8 gap-1.5 rounded-[8px]', workspaceOutlineActionClassName)}
              onClick={() => void handleAddDepartment()}
              disabled={importingDepartment}
            >
              <Building2 className="h-3.5 w-3.5" />
              {importingDepartment ? '导入中…' : '新建部门'}
            </Button>
            <span className="text-xs text-[var(--app-text-muted)]">{departmentCards.length} 部门</span>
          </div>
        </div>
        {departmentImportError && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {departmentImportError}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {departmentCards.map(({ key, workspace, config: dept, boundWorkspaces, projects: wsProjects }) => {
            const deptType = dept?.type || 'build';
            const TypeIcon = deptType === 'ceo'
              ? UserRound
              : deptType === 'research'
                ? FlaskConical
                : deptType === 'operations'
                  ? Radio
                  : Hammer;
            const activeCount = wsProjects.filter(p => p.status === 'active').length;
            const completedCount = wsProjects.filter(p => p.status === 'completed').length;
            const failedCount = wsProjects.filter(p => p.status === 'failed').length;
            const workspaceSummary = boundWorkspaces.map((entry) => entry.name).join(' · ');

            return (
              <WorkspaceInteractiveSurface
                key={key}
                className="relative flex flex-col gap-2"
                onClick={() => setDrillDownUri(key)}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-accent)]">
                    <TypeIcon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[var(--app-text)] truncate">{dept?.name || workspace.name}</div>
                    <div className="text-[10px] text-[var(--app-text-muted)] truncate">{workspaceSummary || workspace.uri.split('/').pop()}</div>
                  </div>
                  <button
                    className="rounded-md p-1.5 text-[var(--app-text-muted)] opacity-0 transition-all hover:bg-[var(--app-raised-2)] hover:text-[var(--app-text)] group-hover:opacity-100"
                    onClick={(e) => { e.stopPropagation(); setSetupWorkspaceUri(workspace.uri); }}
                    title="部门设置"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                </div>
                {/* Status indicators */}
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  <span className="rounded-full border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-2 py-0.5 text-[var(--app-text-muted)]">
                    {boundWorkspaces.length} 个工作区
                  </span>
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

      <LocalFolderImportDialog
        open={departmentImportDialogOpen}
        title="新建部门"
        description="先指定一个部门主目录。导入成功后会立刻打开部门配置，你可以继续补齐职责、模板、技能、多目录绑定和上下文文档。"
        inputLabel="部门主目录"
        placeholder="/Users/xxx/my-project"
        helperText={isTauriDesktop()
          ? '桌面模式下可直接浏览本机文件夹；也可以手动输入绝对路径。'
          : '当前是 Web 模式，请输入本机绝对路径。若要使用系统文件夹选择器，请从 Tauri 桌面壳进入。'}
        confirmLabel="导入并继续配置"
        value={departmentImportPath}
        error={departmentImportError}
        submitting={importingDepartment}
        supportsNativeBrowse={isTauriDesktop()}
        onValueChange={setDepartmentImportPath}
        onOpenChange={(open) => {
          setDepartmentImportDialogOpen(open);
          if (!open) {
            setDepartmentImportPath('');
            setDepartmentImportError(null);
            setImportingDepartment(false);
          }
        }}
        onBrowse={handleBrowseDepartment}
        onConfirm={handleConfirmDepartmentImport}
      />

      {/* Department Setup Dialog */}
      {setupWs && setupDept && (
        <DepartmentSetupDialog
          workspaceUri={setupWs.uri}
          workspaceName={setupWs.name}
          initialConfig={setupDept}
          availableWorkspaces={allWorkspaces}
          open={!!setupWorkspaceUri}
          onOpenChange={open => { if (!open) setSetupWorkspaceUri(null); }}
          onWorkspaceImported={(workspace) => {
            setExtraWorkspaces(prev => {
              const merged = new Map(prev.map((entry) => [entry.uri, entry]));
              merged.set(workspace.uri, workspace);
              return [...merged.values()];
            });
            onRefresh?.();
          }}
          onSaved={(config) => {
            onDepartmentSaved?.(setupWs.uri, config);
            setSetupWorkspaceUri(null);
          }}
        />
      )}

      {/* Department Detail Drawer (SimCity drill-down) */}
      {drillDownCard && (() => {
        const ddWs = drillDownCard.workspace;
        const ddConfig = drillDownCard.config ?? { name: ddWs.name, type: 'build' as const, skills: [], okr: null };
        const ddProjects = drillDownCard.projects;
        return ddWs ? (
          <DepartmentDetailDrawer
            open={!!drillDownUri}
            onOpenChange={open => { if (!open) setDrillDownUri(null); }}
            workspace={ddWs}
            config={ddConfig}
            projects={ddProjects}
            allWorkspaces={allWorkspaces}
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
