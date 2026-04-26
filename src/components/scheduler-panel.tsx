'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { SchedulerJobResponse } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Clock,
  Play,
  Pause,
  Trash2,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  SkipForward,
  Zap,
  Pencil,
  RefreshCw,
  Repeat,
  Activity,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { WorkspaceListItem, WorkspaceMiniMetric, WorkspaceSurface } from '@/components/ui/workspace-primitives';
import { validateCron } from '@/lib/cron-utils';
import type {
  AgentRun,
  BudgetLedgerEntryFE,
  CircuitBreakerFE,
  CompanyLoopRunFE,
  OperatingSignalFE,
  OperatingSignalKindFE,
  OperatingSignalSourceFE,
  OperatingSignalStatusFE,
  SystemImprovementProposalFE,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function ResultBadge({ result }: { result?: string }) {
  if (!result) return null;
  const cfg: Record<string, { color: string; icon: typeof CheckCircle2 }> = {
    success: { color: 'text-emerald-400 bg-emerald-400/10', icon: CheckCircle2 },
    failed: { color: 'text-red-400 bg-red-400/10', icon: XCircle },
    skipped: { color: 'text-amber-400 bg-amber-400/10', icon: SkipForward },
  };
  const c = cfg[result] || cfg.skipped;
  const Icon = c.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium', c.color)}>
      <Icon className="h-2.5 w-2.5" />
      {result}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SchedulerPanelProps {
  className?: string;
}

// ---------------------------------------------------------------------------
// New/Edit job form state
// ---------------------------------------------------------------------------

interface JobFormState {
  name: string;
  type: 'cron' | 'interval' | 'once';
  cronExpression: string;
  timeZone: string;
  intervalMs: string;
  scheduledAt: string;
  actionKind: string;
  executionProfileKind: 'workflow-run' | 'review-flow' | 'dag-orchestration';
  executionProfileWorkflowRef: string;
  executionProfileSkillHints: string;
  executionProfileReviewPolicyId: string;
  actionWorkspace: string;
  actionPrompt: string;
  actionPromptAssetRefs: string;
  actionSkillHints: string;
  actionTemplateId: string;
  actionStageId: string;
  actionProjectId: string;
  enabled: boolean;
  departmentWorkspaceUri: string;
  opcGoal: string;
  opcSkillHint: string;
  opcTemplateId: string;
}

const emptyForm: JobFormState = {
  name: '',
  type: 'cron',
  cronExpression: '',
  timeZone: '',
  intervalMs: '',
  scheduledAt: '',
  actionKind: 'dispatch-pipeline',
  executionProfileKind: 'workflow-run',
  executionProfileWorkflowRef: '',
  executionProfileSkillHints: '',
  executionProfileReviewPolicyId: '',
  actionWorkspace: '',
  actionPrompt: '',
  actionPromptAssetRefs: '',
  actionSkillHints: '',
  actionTemplateId: '',
  actionStageId: '',
  actionProjectId: '',
  enabled: true,
  departmentWorkspaceUri: '',
  opcGoal: '',
  opcSkillHint: '',
  opcTemplateId: '',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SchedulerPanel({ className }: SchedulerPanelProps) {
  const [jobs, setJobs] = useState<SchedulerJobResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [jobRuns, setJobRuns] = useState<Record<string, AgentRun[]>>({});
  const [jobRunsLoading, setJobRunsLoading] = useState<Record<string, boolean>>({});
  const [budgetLedger, setBudgetLedger] = useState<BudgetLedgerEntryFE[]>([]);
  const [openBreakers, setOpenBreakers] = useState<CircuitBreakerFE[]>([]);
  const [operatingSignals, setOperatingSignals] = useState<OperatingSignalFE[]>([]);
  const [companyLoopRuns, setCompanyLoopRuns] = useState<CompanyLoopRunFE[]>([]);
  const [improvementProposals, setImprovementProposals] = useState<SystemImprovementProposalFE[]>([]);
  const [signalSourceFilter, setSignalSourceFilter] = useState<'all' | OperatingSignalSourceFE>('all');
  const [signalKindFilter, setSignalKindFilter] = useState<'all' | OperatingSignalKindFE>('all');
  const [signalStatusFilter, setSignalStatusFilter] = useState<'all' | OperatingSignalStatusFE>('all');

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [form, setForm] = useState<JobFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [cronError, setCronError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const formatCadence = (job: SchedulerJobResponse) => {
    if (job.type === 'interval') {
      const intervalMs = (job as SchedulerJobResponse & { intervalMs?: number }).intervalMs;
      if (typeof intervalMs === 'number' && intervalMs > 0) {
        if (intervalMs % 3_600_000 === 0) return `每 ${intervalMs / 3_600_000} 小时`;
        if (intervalMs % 60_000 === 0) return `每 ${intervalMs / 60_000} 分钟`;
        if (intervalMs % 1_000 === 0) return `每 ${intervalMs / 1_000} 秒`;
        return `每 ${intervalMs} ms`;
      }
      return '循环';
    }
    if (job.type === 'cron') {
      const cronExpression = (job as SchedulerJobResponse & { cronExpression?: string }).cronExpression;
      const timeZone = (job as SchedulerJobResponse & { timeZone?: string }).timeZone;
      return timeZone ? `${cronExpression || 'cron'} · ${timeZone}` : (cronExpression || 'cron');
    }
    return '单次';
  };

  const getJobTarget = (job: SchedulerJobResponse) => {
    if (job.departmentWorkspaceUri) return job.departmentWorkspaceUri.split('/').pop() || job.departmentWorkspaceUri;
    const actionWorkspace = typeof job.action?.workspace === 'string' ? job.action.workspace : '';
    if (actionWorkspace) return actionWorkspace.split('/').pop() || actionWorkspace;
    if (typeof job.action?.projectId === 'string' && job.action.projectId) return `Project ${job.action.projectId.slice(0, 8)}`;
    return job.createdBy || 'scheduler';
  };

  const runStatusTone = (status?: string) => {
    const tones: Record<string, string> = {
      completed: 'bg-emerald-500/10 text-emerald-300',
      running: 'bg-sky-500/10 text-sky-300',
      starting: 'bg-sky-500/10 text-sky-300',
      queued: 'bg-[var(--app-raised-2)] text-[var(--app-text-soft)]',
      blocked: 'bg-amber-500/10 text-amber-300',
      failed: 'bg-red-500/10 text-red-300',
      cancelled: 'bg-[var(--app-raised-2)] text-[var(--app-text-soft)]',
      timeout: 'bg-amber-500/10 text-amber-300',
    };
    return tones[status || ''] || 'bg-[var(--app-raised-2)] text-[var(--app-text-soft)]';
  };

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const [data, ledger, breakers, signals, loopRuns, proposals] = await Promise.all([
        api.schedulerJobs(),
        api.companyBudgetLedger({ pageSize: 6 }).catch(() => ({ items: [] as BudgetLedgerEntryFE[] })),
        api.companyCircuitBreakers({ status: 'open', pageSize: 6 }).catch(() => ({ items: [] as CircuitBreakerFE[] })),
        api.companySignals({
          ...(signalSourceFilter !== 'all' ? { source: signalSourceFilter } : {}),
          ...(signalKindFilter !== 'all' ? { kind: signalKindFilter } : {}),
          ...(signalStatusFilter !== 'all' ? { status: signalStatusFilter } : {}),
          pageSize: 16,
        }).catch(() => ({ items: [] as OperatingSignalFE[] })),
        api.companyLoopRuns({ pageSize: 6 }).catch(() => ({ items: [] as CompanyLoopRunFE[] })),
        api.systemImprovementProposals({ pageSize: 6 }).catch(() => ({ items: [] as SystemImprovementProposalFE[] })),
      ]);
      setJobs(data);
      setBudgetLedger(ledger.items || []);
      setOpenBreakers(breakers.items || []);
      setOperatingSignals(signals.items || []);
      setCompanyLoopRuns(loopRuns.items || []);
      setImprovementProposals(proposals.items || []);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  }, [signalKindFilter, signalSourceFilter, signalStatusFilter]);

  const fetchRunsForJob = useCallback(async (jobId: string) => {
    setJobRunsLoading((prev) => ({ ...prev, [jobId]: true }));
    try {
      const data = await api.agentRunsByFilter({ schedulerJobId: jobId });
      setJobRuns((prev) => ({ ...prev, [jobId]: data }));
    } catch {
      setJobRuns((prev) => ({ ...prev, [jobId]: [] }));
    } finally {
      setJobRunsLoading((prev) => ({ ...prev, [jobId]: false }));
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    if (!expandedJobId) return;
    void fetchRunsForJob(expandedJobId);
    const interval = setInterval(() => {
      void fetchRunsForJob(expandedJobId);
    }, 10000);
    return () => clearInterval(interval);
  }, [expandedJobId, fetchRunsForJob]);

  const handleToggle = async (job: SchedulerJobResponse) => {
    try {
      await api.updateSchedulerJob(job.jobId, { enabled: !job.enabled });
      await fetchJobs();
    } catch {
      // handled
    }
  };

  const handleTrigger = async (jobId: string) => {
    setTriggeringId(jobId);
    try {
      await api.triggerSchedulerJob(jobId);
      await fetchJobs();
    } catch {
      // handled
    } finally {
      setTriggeringId(null);
    }
  };

  const handleDelete = async (jobId: string) => {
    setDeletingId(jobId);
    try {
      await api.deleteSchedulerJob(jobId);
      await fetchJobs();
    } catch {
      // handled
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleRuns = async (jobId: string) => {
    setExpandedJobId((current) => current === jobId ? null : jobId);
    if (!jobRuns[jobId]) {
      await fetchRunsForJob(jobId);
    }
  };

  const openCreateDialog = () => {
    setEditingJobId(null);
    setForm(emptyForm);
    setCronError(null);
    setSaveError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (job: SchedulerJobResponse) => {
    setEditingJobId(job.jobId);
    setCronError(null);
    setSaveError(null);
    const action = job.action || {} as Record<string, unknown>;
    setForm({
      name: job.name || '',
      type: (job.type as 'cron' | 'interval' | 'once') || 'cron',
      cronExpression: (job as SchedulerJobResponse & { cronExpression?: string }).cronExpression || '',
      timeZone: (job as SchedulerJobResponse & { timeZone?: string }).timeZone || '',
      intervalMs: (job as SchedulerJobResponse & { intervalMs?: number }).intervalMs ? String((job as SchedulerJobResponse & { intervalMs?: number }).intervalMs) : '',
      scheduledAt: (job as SchedulerJobResponse & { scheduledAt?: string }).scheduledAt || '',
      actionKind: job.opcAction ? 'create-project' : (action.kind as string) || 'dispatch-pipeline',
      executionProfileKind: job.executionProfile?.kind === 'dag-orchestration'
        ? 'dag-orchestration'
        : job.executionProfile?.kind === 'review-flow'
          ? 'review-flow'
          : 'workflow-run',
      executionProfileWorkflowRef: job.executionProfile?.kind === 'workflow-run' ? (job.executionProfile.workflowRef || '') : '',
      executionProfileSkillHints: job.executionProfile?.kind === 'workflow-run' ? (job.executionProfile.skillHints || []).join(', ') : '',
      executionProfileReviewPolicyId: job.executionProfile?.kind === 'review-flow' ? (job.executionProfile.reviewPolicyId || '') : '',
      actionWorkspace: (action.workspace as string) || '',
      actionPrompt: (action.prompt as string) || '',
      actionPromptAssetRefs: Array.isArray(action.promptAssetRefs) ? (action.promptAssetRefs as string[]).join(', ') : '',
      actionSkillHints: Array.isArray(action.skillHints) ? (action.skillHints as string[]).join(', ') : '',
      actionTemplateId: (action.templateId as string)
        || (job.executionProfile?.kind === 'review-flow' || job.executionProfile?.kind === 'dag-orchestration'
          ? job.executionProfile.templateId
          : '')
        || '',
      actionStageId: (action.stageId as string)
        || (job.executionProfile?.kind === 'review-flow' || job.executionProfile?.kind === 'dag-orchestration'
          ? (job.executionProfile.stageId || '')
          : '')
        || '',
      actionProjectId: (action.projectId as string) || '',
      enabled: job.enabled ?? true,
      departmentWorkspaceUri: job.departmentWorkspaceUri || '',
      opcGoal: job.opcAction?.goal || '',
      opcSkillHint: job.opcAction?.skillHint || '',
      opcTemplateId: job.opcAction?.templateId || '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    // Validate cron before saving
    if (form.type === 'cron') {
      const err = validateCron(form.cronExpression);
      if (err) { setCronError(err); return; }
    }
    setCronError(null);
    setSaveError(null);
    setSaving(true);
    try {
      const effectiveActionKind = form.actionKind;
      const action: Record<string, unknown> = { kind: effectiveActionKind };
      if ((effectiveActionKind === 'dispatch-pipeline' || effectiveActionKind === 'dispatch-prompt' || effectiveActionKind === 'dispatch-execution-profile') && form.actionWorkspace) action.workspace = form.actionWorkspace;
      if ((effectiveActionKind === 'dispatch-pipeline' || effectiveActionKind === 'dispatch-prompt' || effectiveActionKind === 'dispatch-execution-profile') && form.actionPrompt) action.prompt = form.actionPrompt;
      if (effectiveActionKind === 'dispatch-prompt' && form.actionPromptAssetRefs) {
        action.promptAssetRefs = form.actionPromptAssetRefs.split(',').map((item) => item.trim()).filter(Boolean);
      }
      if (effectiveActionKind === 'dispatch-prompt' && form.actionSkillHints) {
        action.skillHints = form.actionSkillHints.split(',').map((item) => item.trim()).filter(Boolean);
      }
      if (effectiveActionKind === 'dispatch-execution-profile') {
        action.executionProfile = form.executionProfileKind === 'workflow-run'
          ? {
              kind: 'workflow-run',
              ...(form.executionProfileWorkflowRef ? { workflowRef: form.executionProfileWorkflowRef } : {}),
              ...(form.executionProfileSkillHints
                ? { skillHints: form.executionProfileSkillHints.split(',').map((item) => item.trim()).filter(Boolean) }
                : {}),
            }
          : form.executionProfileKind === 'review-flow'
            ? {
                kind: 'review-flow',
                templateId: form.actionTemplateId,
                ...(form.actionStageId ? { stageId: form.actionStageId } : {}),
                ...(form.executionProfileReviewPolicyId ? { reviewPolicyId: form.executionProfileReviewPolicyId } : {}),
              }
            : {
                kind: 'dag-orchestration',
                templateId: form.actionTemplateId,
                ...(form.actionStageId ? { stageId: form.actionStageId } : {}),
              };
      }
      if (effectiveActionKind === 'dispatch-pipeline' && form.actionTemplateId) action.templateId = form.actionTemplateId;
      if (effectiveActionKind === 'dispatch-pipeline' && form.actionStageId) action.stageId = form.actionStageId;
      if ((effectiveActionKind === 'dispatch-pipeline' || effectiveActionKind === 'dispatch-execution-profile' || effectiveActionKind === 'health-check') && form.actionProjectId) action.projectId = form.actionProjectId;

      const payload: Record<string, unknown> = {
        name: form.name,
        type: form.type,
        action,
        enabled: form.enabled,
        createdBy: 'web',
      };

      if (form.type === 'cron' && form.cronExpression) payload.cronExpression = form.cronExpression;
      if (form.type === 'cron' && form.timeZone.trim()) payload.timeZone = form.timeZone.trim();
      if (form.type === 'interval' && form.intervalMs) payload.intervalMs = parseInt(form.intervalMs, 10);
      if (form.type === 'once' && form.scheduledAt) payload.scheduledAt = form.scheduledAt;

      // OPC fields
      if (effectiveActionKind === 'create-project' && form.departmentWorkspaceUri) payload.departmentWorkspaceUri = form.departmentWorkspaceUri;
      if (effectiveActionKind === 'create-project' && form.opcGoal) {
        payload.opcAction = {
          type: 'create_project',
          projectType: 'adhoc',
          goal: form.opcGoal,
          ...(form.opcSkillHint ? { skillHint: form.opcSkillHint } : {}),
          ...(form.opcTemplateId ? { templateId: form.opcTemplateId } : {}),
        };
      }

      if (editingJobId) {
        await api.updateSchedulerJob(editingJobId, payload);
      } else {
        await api.createSchedulerJob(payload as Parameters<typeof api.createSchedulerJob>[0]);
      }
      setDialogOpen(false);
      await fetchJobs();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center py-12 text-[var(--app-text-muted)]', className)}>
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-[var(--app-text-soft)]" />
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
            Scheduler
          </span>
          <span className="text-[10px] text-[var(--app-text-muted)]">{jobs.length} jobs</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] text-sky-700">
            <Repeat className="h-2.5 w-2.5" />
            {jobs.filter((job) => job.type === 'interval').length} loops
          </span>
          <span className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]',
            openBreakers.length ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/10 text-emerald-700',
          )}>
            <Activity className="h-2.5 w-2.5" />
            {openBreakers.length} open breakers
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--app-raised)] px-2 py-0.5 text-[10px] text-[var(--app-text-soft)]">
            {budgetLedger.length} ledger events
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-700">
            {operatingSignals.length} signals
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={fetchJobs} className="h-7 w-7 p-0">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" onClick={openCreateDialog} className="h-7 text-xs">
            <Plus className="h-3 w-3 mr-1" />
            New
          </Button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <WorkspaceSurface padding="sm" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Repeat className="h-4 w-4 text-[var(--app-text-soft)]" />
              <div>
                <div className="text-sm font-semibold text-[var(--app-text)]">Company Loops</div>
                <div className="text-[11px] text-[var(--app-text-muted)]">run timeline / skipped / dispatched</div>
              </div>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void api.runCompanyLoopNow({ kind: 'daily-review' }).then(fetchJobs).catch(() => undefined)}>
              Run daily
            </Button>
          </div>
          {companyLoopRuns.length ? (
            <div className="space-y-2">
              {companyLoopRuns.slice(0, 4).map((run) => (
                <div key={run.id} className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-raised)] px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-[var(--app-text)]">{run.kind} · {run.date}</div>
                      <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--app-text-soft)]">{run.summary || run.skipReason || run.error}</div>
                    </div>
                    <span className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      run.status === 'completed'
                        ? 'bg-emerald-400/10 text-emerald-700'
                        : run.status === 'failed'
                          ? 'bg-red-400/10 text-red-700'
                          : 'bg-amber-400/10 text-amber-700',
                    )}>
                      {run.status}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1.5 text-[10px] text-[var(--app-text-muted)]">
                    <span className="rounded-full bg-[var(--app-raised-2)] px-2 py-1">select {run.selectedAgendaIds.length}</span>
                    <span className="rounded-full bg-[var(--app-raised-2)] px-2 py-1">dispatch {run.dispatchedRunIds.length}</span>
                    <span className="rounded-full bg-[var(--app-raised-2)] px-2 py-1">proposal {run.generatedProposalIds.length}</span>
                    <span className="rounded-full bg-[var(--app-raised-2)] px-2 py-1">ledger {run.budgetLedgerIds.length}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[14px] border border-dashed border-[var(--app-border)] px-3 py-4 text-center text-xs text-[var(--app-text-muted)]">
              No company loop runs yet.
            </div>
          )}
        </WorkspaceSurface>

        <WorkspaceSurface padding="sm" className="space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[var(--app-text-soft)]" />
            <div>
              <div className="text-sm font-semibold text-[var(--app-text)]">Self Improvement</div>
              <div className="text-[11px] text-[var(--app-text-muted)]">risk / evidence / approval</div>
            </div>
          </div>
          {improvementProposals.length ? (
            <div className="space-y-2">
              {improvementProposals.slice(0, 4).map((proposal) => (
                <div key={proposal.id} className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-raised)] px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-[var(--app-text)]">{proposal.title}</div>
                      <div className="mt-1 text-[11px] text-[var(--app-text-soft)]">{proposal.status} · {proposal.affectedFiles.length} files</div>
                    </div>
                    <span className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      proposal.risk === 'critical' || proposal.risk === 'high'
                        ? 'bg-red-400/10 text-red-700'
                        : proposal.risk === 'medium'
                          ? 'bg-amber-400/10 text-amber-700'
                          : 'bg-emerald-400/10 text-emerald-700',
                    )}>
                      {proposal.risk}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[var(--app-text-muted)]">
                    <span className="rounded-full bg-[var(--app-raised-2)] px-2 py-0.5">evidence {proposal.evidenceRefs.length}</span>
                    <span className="rounded-full bg-[var(--app-raised-2)] px-2 py-0.5">tests {proposal.testEvidence.length}</span>
                    <span className="rounded-full bg-[var(--app-raised-2)] px-2 py-0.5">rollback {proposal.rollbackPlan.length}</span>
                    <span className="rounded-full bg-[var(--app-raised-2)] px-2 py-0.5">
                      approval {proposal.approvalRequestId ? proposal.status : 'none'}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-1.5 text-[10px] leading-4 text-[var(--app-text-soft)]">
                    <div className="truncate">
                      <span className="text-[var(--app-text-muted)]">Files:</span> {proposal.affectedFiles.slice(0, 3).join(', ') || 'none'}
                    </div>
                    <div className="truncate">
                      <span className="text-[var(--app-text-muted)]">Protected:</span> {proposal.protectedAreas.join(', ') || 'unprotected'}
                    </div>
                    <div className="truncate">
                      <span className="text-[var(--app-text-muted)]">Latest test:</span> {proposal.testEvidence[proposal.testEvidence.length - 1]
                        ? `${proposal.testEvidence[proposal.testEvidence.length - 1]?.status} · ${proposal.testEvidence[proposal.testEvidence.length - 1]?.command}`
                        : 'no evidence yet'}
                    </div>
                    <div className="truncate">
                      <span className="text-[var(--app-text-muted)]">Rollback:</span> {proposal.rollbackPlan[0] || 'not declared'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[14px] border border-dashed border-[var(--app-border)] px-3 py-4 text-center text-xs text-[var(--app-text-muted)]">
              No improvement proposals yet.
            </div>
          )}
        </WorkspaceSurface>
      </div>

      <WorkspaceSurface padding="sm" className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[var(--app-text-soft)]" />
            <div>
              <div className="text-sm font-semibold text-[var(--app-text)]">Operating Signals</div>
              <div className="text-[11px] text-[var(--app-text-muted)]">source / kind / status / dedupeKey</div>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:w-[520px]">
            <NativeSelect value={signalSourceFilter} onChange={(event) => setSignalSourceFilter(event.target.value as typeof signalSourceFilter)}>
              <option value="all">All sources</option>
              {(['scheduler', 'run', 'approval', 'knowledge', 'user', 'system', 'external'] as OperatingSignalSourceFE[]).map((source) => (
                <option key={source} value={source}>{source}</option>
              ))}
            </NativeSelect>
            <NativeSelect value={signalKindFilter} onChange={(event) => setSignalKindFilter(event.target.value as typeof signalKindFilter)}>
              <option value="all">All kinds</option>
              {(['opportunity', 'risk', 'routine', 'failure', 'learning', 'decision'] as OperatingSignalKindFE[]).map((kind) => (
                <option key={kind} value={kind}>{kind}</option>
              ))}
            </NativeSelect>
            <NativeSelect value={signalStatusFilter} onChange={(event) => setSignalStatusFilter(event.target.value as typeof signalStatusFilter)}>
              <option value="all">All statuses</option>
              {(['observed', 'triaged', 'dismissed', 'converted'] as OperatingSignalStatusFE[]).map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </NativeSelect>
          </div>
        </div>
        {operatingSignals.length ? (
          <div className="grid gap-2 lg:grid-cols-2">
            {operatingSignals.slice(0, 6).map((signal) => (
              <div key={signal.id} className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-raised)] px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-[var(--app-text)]">{signal.title}</div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--app-text-soft)]">{signal.summary}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--app-accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--app-accent)]">
                    {Math.round(signal.score)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[var(--app-text-muted)]">
                  <span className="rounded-full bg-[var(--app-raised-2)] px-2 py-0.5">{signal.source}</span>
                  <span className="rounded-full bg-[var(--app-raised-2)] px-2 py-0.5">{signal.kind}</span>
                  <span className="rounded-full bg-[var(--app-raised-2)] px-2 py-0.5">{signal.status}</span>
                  {signal.sourceJobId ? <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-cyan-700">{signal.sourceJobId.slice(0, 8)}</span> : null}
                  <span className="max-w-full truncate rounded-full bg-amber-400/10 px-2 py-0.5 text-amber-700">{signal.dedupeKey}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[14px] border border-dashed border-[var(--app-border)] px-3 py-4 text-center text-xs text-[var(--app-text-muted)]">
            No operating signals match the current filters.
          </div>
        )}
      </WorkspaceSurface>

      {/* Job list */}
      {jobs.length === 0 ? (
        <WorkspaceSurface className="border-dashed px-4 py-8 text-center text-sm text-[var(--app-text-muted)]">
          No scheduled jobs yet.
        </WorkspaceSurface>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <WorkspaceSurface
              key={job.jobId}
              className={cn(
                !job.enabled && 'opacity-50',
              )}
              padding="sm"
            >
              <WorkspaceListItem
                title={job.name || job.jobId}
                icon={job.type === 'interval' ? <Repeat className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                tone={job.type === 'interval' ? 'info' : 'neutral'}
                className="border-0 bg-transparent p-0 shadow-none"
                actions={<ResultBadge result={job.lastRunResult} />}
              />

              <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-[var(--app-text-muted)]">
                <span className={cn(
                  'rounded-full px-2 py-0.5',
                  job.type === 'interval'
                    ? 'bg-sky-400/10 text-sky-700'
                    : 'bg-[var(--app-raised)] text-[var(--app-text-soft)]',
                )}>
                  {formatCadence(job)}
                </span>
                <span className="rounded-full bg-[var(--app-raised)] px-2 py-0.5 text-[var(--app-text-soft)]">
                  {job.opcAction ? 'create-project' : job.action?.kind}
                </span>
                {job.executionProfileSummary ? (
                  <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-indigo-300/80">
                    {job.executionProfileSummary.label}
                  </span>
                ) : null}
                <span className="rounded-full bg-[var(--app-accent-soft)] px-2 py-0.5 text-[var(--app-accent)]">
                  {getJobTarget(job)}
                </span>
              </div>

              <div className="mb-3 grid gap-2 md:grid-cols-2">
                <WorkspaceMiniMetric label="Next" value={job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : '—'} valueClassName="text-[11px] leading-5 tracking-normal" />
                <WorkspaceMiniMetric label="Last" value={job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : '—'} valueClassName="text-[11px] leading-5 tracking-normal" />
              </div>

              {job.lastRunError && (
                <div className="text-[11px] text-red-400/70 mb-2 truncate">
                  {job.lastRunError}
                </div>
              )}

              {operatingSignals.filter((signal) => signal.sourceJobId === job.jobId).slice(0, 1).map((signal) => (
                <div key={signal.id} className="mb-2 rounded-[14px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{signal.kind} · {signal.status}</span>
                    <span className="shrink-0 font-mono">{Math.round(signal.score)}</span>
                  </div>
                  <div className="mt-1 truncate text-amber-700/80">{signal.dedupeKey}</div>
                </div>
              ))}

              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => handleToggle(job)}
                >
                  {job.enabled ? (
                    <><Pause className="h-3 w-3 mr-1" />Disable</>
                  ) : (
                    <><Play className="h-3 w-3 mr-1" />Enable</>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => handleTrigger(job.jobId)}
                  disabled={triggeringId === job.jobId}
                >
                  {triggeringId === job.jobId ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Zap className="h-3 w-3 mr-1" />
                  )}
                  Trigger
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => { void handleToggleRuns(job.jobId); }}
                >
                  <Activity className="h-3 w-3 mr-1" />
                  Runs
                  {expandedJobId === job.jobId ? (
                    <ChevronUp className="ml-1 h-3 w-3" />
                  ) : (
                    <ChevronDown className="ml-1 h-3 w-3" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => openEditDialog(job)}
                >
                  <Pencil className="h-3 w-3 mr-1" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-red-400/70 hover:text-red-400"
                  onClick={() => handleDelete(job.jobId)}
                  disabled={deletingId === job.jobId}
                >
                  {deletingId === job.jobId ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Trash2 className="h-3 w-3 mr-1" />
                  )}
                  Delete
                </Button>
              </div>

              {expandedJobId === job.jobId ? (
                <WorkspaceSurface className="mt-3 bg-[var(--app-raised)]" padding="sm">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
                      Recent Runs
                    </div>
                    <div className="text-[10px] text-[var(--app-text-muted)]">
                      {job.action?.kind === 'health-check'
                        ? 'health-check 不会创建 run'
                        : `${jobRuns[job.jobId]?.length || 0} linked`}
                    </div>
                  </div>

                  {jobRunsLoading[job.jobId] ? (
                    <div className="flex items-center gap-2 py-3 text-xs text-[var(--app-text-muted)]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      正在加载最近运行结果...
                    </div>
                  ) : (jobRuns[job.jobId] || []).length > 0 ? (
                    <div className="space-y-2">
                      {(jobRuns[job.jobId] || []).slice(0, 5).map((run) => (
                        <WorkspaceSurface key={run.runId} padding="sm">
                          <div className="flex items-center gap-2">
                            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', runStatusTone(run.status))}>
                              {run.status}
                            </span>
                            <span className="font-mono text-[11px] text-[var(--app-text-soft)]">{run.runId.slice(0, 8)}</span>
                            <span className="text-[11px] text-[var(--app-text-muted)]">{new Date(run.createdAt).toLocaleString()}</span>
                            {run.provider ? (
                              <span className="ml-auto text-[10px] text-[var(--app-text-muted)]">{run.provider}</span>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--app-text-muted)]">
                            {run.resolvedWorkflowRef ? (
                              <span className="rounded-full bg-[var(--app-raised-2)] px-2 py-0.5">{run.resolvedWorkflowRef}</span>
                            ) : null}
                            {run.triggerContext?.schedulerJobId ? (
                              <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-cyan-300/80">linked</span>
                            ) : null}
                            {typeof run.reportedEventCount === 'number' ? (
                              <span className="rounded-full bg-[var(--app-raised-2)] px-2 py-0.5">{run.reportedEventCount} items</span>
                            ) : null}
                            {typeof run.verificationPassed === 'boolean' ? (
                              <span className={cn(
                                'rounded-full px-2 py-0.5',
                                run.verificationPassed ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300',
                              )}>
                                {run.verificationPassed ? 'verified' : 'not verified'}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 text-[12px] leading-5 text-[var(--app-text-soft)]">
                            {run.result?.summary || run.resultEnvelope?.summary || run.lastError || '暂无结构化结果摘要'}
                          </div>
                        </WorkspaceSurface>
                      ))}
                    </div>
                  ) : (
                    <WorkspaceSurface className="border-dashed px-3 py-3 text-xs text-[var(--app-text-muted)]" padding="sm">
                      {job.action?.kind === 'health-check'
                        ? '这类任务只写 scheduler 执行结果，不会创建 run。'
                        : '还没有与这条 scheduler job 关联的 run。新触发后的 run 会出现在这里。'}
                    </WorkspaceSurface>
                  )}
                </WorkspaceSurface>
              ) : null}
            </WorkspaceSurface>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingJobId ? 'Edit Job' : 'New Scheduled Job'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Daily health check"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Type</label>
              <NativeSelect value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value as JobFormState['type'] }))}>
                <option value="cron">Cron</option>
                <option value="interval">Interval</option>
                <option value="once">Once</option>
              </NativeSelect>
            </div>

            {form.type === 'cron' && (
              <div>
                <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Cron Expression</label>
                <Input
                  value={form.cronExpression}
                  onChange={(e) => { setForm(f => ({ ...f, cronExpression: e.target.value })); setCronError(null); }}
                  placeholder="0 9 * * *"
                  className={cn('font-mono', cronError && 'border-red-400/50')}
                />
                {cronError && (
                  <p className="mt-1 text-[11px] text-red-400">{cronError}</p>
                )}
                <p className="mt-1 text-[10px] text-[var(--app-text-muted)]">minute hour day month weekday</p>
              </div>
            )}

            {form.type === 'cron' && (
              <div>
                <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Cron Time Zone (optional)</label>
                <Input
                  value={form.timeZone}
                  onChange={(e) => setForm(f => ({ ...f, timeZone: e.target.value }))}
                  placeholder="Asia/Shanghai"
                />
                <p className="mt-1 text-[10px] text-[var(--app-text-muted)]">留空则使用当前服务端本地时区。</p>
              </div>
            )}

            {form.type === 'interval' && (
              <div>
                <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Interval (ms)</label>
                <Input
                  type="number"
                  value={form.intervalMs}
                  onChange={(e) => setForm(f => ({ ...f, intervalMs: e.target.value }))}
                  placeholder="3600000"
                />
              </div>
            )}

            {form.type === 'once' && (
              <div>
                <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Scheduled At (ISO)</label>
                <Input
                  value={form.scheduledAt}
                  onChange={(e) => setForm(f => ({ ...f, scheduledAt: e.target.value }))}
                  placeholder="2026-01-15T09:00:00Z"
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Action Kind</label>
              <NativeSelect
                value={form.actionKind}
                onChange={(e) => {
                  const nextActionKind = e.target.value ?? 'dispatch-pipeline';
                  setForm((current) => ({
                    ...current,
                    actionKind: nextActionKind,
                    ...(nextActionKind !== 'create-project'
                      ? {
                          departmentWorkspaceUri: '',
                          opcGoal: '',
                          opcSkillHint: '',
                          opcTemplateId: '',
                        }
                      : {}),
                  }));
                }}
              >
                <option value="dispatch-pipeline">Dispatch Pipeline</option>
                <option value="dispatch-prompt">Dispatch Prompt</option>
                <option value="dispatch-execution-profile">Dispatch Execution Profile</option>
                <option value="health-check">Health Check</option>
                <option value="create-project">Create Ad-hoc Project</option>
              </NativeSelect>
            </div>

            {form.actionKind !== 'health-check' && form.actionKind !== 'create-project' && (
              <>
                <div>
                  <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Workspace</label>
                  <Input
                    value={form.actionWorkspace}
                    onChange={(e) => setForm(f => ({ ...f, actionWorkspace: e.target.value }))}
                    placeholder="/path/to/workspace"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Prompt</label>
                  <Input
                    value={form.actionPrompt}
                    onChange={(e) => setForm(f => ({ ...f, actionPrompt: e.target.value }))}
                    placeholder="Run analysis..."
                  />
                </div>
              </>
            )}

            {form.actionKind === 'dispatch-execution-profile' && (
              <>
                <div>
                  <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Execution Profile</label>
                  <NativeSelect
                    value={form.executionProfileKind}
                    onChange={(e) => setForm(f => ({
                      ...f,
                      executionProfileKind: (e.target.value as 'workflow-run' | 'review-flow' | 'dag-orchestration') || 'workflow-run',
                    }))}
                  >
                    <option value="workflow-run">Workflow Run</option>
                    <option value="review-flow">Review Flow</option>
                    <option value="dag-orchestration">DAG Orchestration</option>
                  </NativeSelect>
                </div>
                {form.executionProfileKind === 'workflow-run' ? (
                  <>
                    <div>
                      <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Workflow Ref (optional)</label>
                      <Input
                        value={form.executionProfileWorkflowRef}
                        onChange={(e) => setForm(f => ({ ...f, executionProfileWorkflowRef: e.target.value }))}
                        placeholder="/ai_digest"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Skill Hints (comma-separated)</label>
                      <Input
                        value={form.executionProfileSkillHints}
                        onChange={(e) => setForm(f => ({ ...f, executionProfileSkillHints: e.target.value }))}
                        placeholder="research, reporting"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Template ID</label>
                      <Input
                        value={form.actionTemplateId}
                        onChange={(e) => setForm(f => ({ ...f, actionTemplateId: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Stage ID (optional)</label>
                      <Input
                        value={form.actionStageId}
                        onChange={(e) => setForm(f => ({ ...f, actionStageId: e.target.value }))}
                        placeholder="Leave empty to dispatch entry stage"
                      />
                    </div>
                    {form.executionProfileKind === 'review-flow' && (
                      <div>
                        <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Review Policy ID (optional)</label>
                        <Input
                          value={form.executionProfileReviewPolicyId}
                          onChange={(e) => setForm(f => ({ ...f, executionProfileReviewPolicyId: e.target.value }))}
                          placeholder="default-strict"
                        />
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {form.actionKind === 'dispatch-pipeline' && (
              <>
                <div>
                  <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Template ID</label>
                  <Input
                    value={form.actionTemplateId}
                    onChange={(e) => setForm(f => ({ ...f, actionTemplateId: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Stage ID (optional)</label>
                  <Input
                    value={form.actionStageId}
                    onChange={(e) => setForm(f => ({ ...f, actionStageId: e.target.value }))}
                    placeholder="Leave empty to dispatch entry stage"
                  />
                </div>
              </>
            )}

            {form.actionKind === 'dispatch-prompt' && (
              <>
                <div>
                  <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Prompt Asset Refs (comma-separated)</label>
                  <Input
                    value={form.actionPromptAssetRefs}
                    onChange={(e) => setForm(f => ({ ...f, actionPromptAssetRefs: e.target.value }))}
                    placeholder="/ai_bigevent, /ai_digest"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Skill Hints (comma-separated)</label>
                  <Input
                    value={form.actionSkillHints}
                    onChange={(e) => setForm(f => ({ ...f, actionSkillHints: e.target.value }))}
                    placeholder="ai-big-event, reporting"
                  />
                </div>
              </>
            )}

            <div>
              <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Project ID (optional)</label>
              <Input
                value={form.actionProjectId}
                onChange={(e) => setForm(f => ({ ...f, actionProjectId: e.target.value }))}
              />
            </div>

            {/* OPC: Create Ad-hoc Project fields */}
            {form.actionKind === 'create-project' && (
              <>
                <div>
                  <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Department Workspace URI</label>
                  <Input
                    value={form.departmentWorkspaceUri}
                    onChange={(e) => setForm(f => ({ ...f, departmentWorkspaceUri: e.target.value }))}
                    placeholder="file:///path/to/workspace"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Task Goal</label>
                  <Input
                    value={form.opcGoal}
                    onChange={(e) => setForm(f => ({ ...f, opcGoal: e.target.value }))}
                    placeholder="Generate daily SEO report"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Skill Hint (optional)</label>
                  <Input
                    value={form.opcSkillHint}
                    onChange={(e) => setForm(f => ({ ...f, opcSkillHint: e.target.value }))}
                    placeholder="seo-analysis"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--app-text-muted)]">Auto-dispatch Template ID (optional)</label>
                  <Input
                    value={form.opcTemplateId}
                    onChange={(e) => setForm(f => ({ ...f, opcTemplateId: e.target.value }))}
                    placeholder="coding-basic-template"
                  />
                </div>
              </>
            )}

            {saveError ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
                {saveError}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {editingJobId ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
