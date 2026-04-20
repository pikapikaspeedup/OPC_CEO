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
import { validateCron } from '@/lib/cron-utils';
import type { AgentRun } from '@/lib/types';

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
      return cronExpression || 'cron';
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
      queued: 'bg-white/8 text-white/55',
      blocked: 'bg-amber-500/10 text-amber-300',
      failed: 'bg-red-500/10 text-red-300',
      cancelled: 'bg-white/8 text-white/55',
      timeout: 'bg-amber-500/10 text-amber-300',
    };
    return tones[status || ''] || 'bg-white/8 text-white/55';
  };

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.schedulerJobs();
      setJobs(data);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  }, []);

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
      <div className={cn('flex items-center justify-center py-12 text-white/40', className)}>
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-white/60" />
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
            Scheduler
          </span>
          <span className="text-[10px] text-white/30">{jobs.length} jobs</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300/80">
            <Repeat className="h-2.5 w-2.5" />
            {jobs.filter((job) => job.type === 'interval').length} loops
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

      {/* Job list */}
      {jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/40">
          No scheduled jobs yet.
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <div
              key={job.jobId}
              className={cn(
                'rounded-xl border border-white/8 bg-white/[0.02] p-3 transition-colors',
                !job.enabled && 'opacity-50',
              )}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border',
                    job.type === 'interval'
                      ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-300'
                      : 'border-white/10 bg-white/[0.04] text-white/55',
                  )}>
                    {job.type === 'interval' ? <Repeat className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                  </div>
                  <span className="text-sm font-medium text-white/80 truncate">
                    {job.name || job.jobId}
                  </span>
                </div>
                <ResultBadge result={job.lastRunResult} />
              </div>

              <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-white/45">
                <span className={cn(
                  'rounded-full px-2 py-0.5',
                  job.type === 'interval'
                    ? 'bg-cyan-400/10 text-cyan-300/80'
                    : 'bg-white/[0.06] text-white/55',
                )}>
                  {formatCadence(job)}
                </span>
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5">
                  {job.opcAction ? 'create-project' : job.action?.kind}
                </span>
                {job.executionProfileSummary ? (
                  <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-indigo-300/80">
                    {job.executionProfileSummary.label}
                  </span>
                ) : null}
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-sky-300/75">
                  {getJobTarget(job)}
                </span>
              </div>

              <div className="mb-3 grid gap-2 md:grid-cols-2">
                <div className="rounded-lg bg-white/[0.03] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-white/28">Next</div>
                  <div className="mt-1 text-[11px] text-white/70">
                    {job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : '—'}
                  </div>
                </div>
                <div className="rounded-lg bg-white/[0.03] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-white/28">Last</div>
                  <div className="mt-1 text-[11px] text-white/70">
                    {job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : '—'}
                  </div>
                </div>
              </div>

              {job.lastRunError && (
                <div className="text-[11px] text-red-400/70 mb-2 truncate">
                  {job.lastRunError}
                </div>
              )}

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
                <div className="mt-3 rounded-xl border border-white/8 bg-black/15 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35">
                      Recent Runs
                    </div>
                    <div className="text-[10px] text-white/28">
                      {job.action?.kind === 'health-check'
                        ? 'health-check 不会创建 run'
                        : `${jobRuns[job.jobId]?.length || 0} linked`}
                    </div>
                  </div>

                  {jobRunsLoading[job.jobId] ? (
                    <div className="flex items-center gap-2 py-3 text-xs text-white/45">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      正在加载最近运行结果...
                    </div>
                  ) : (jobRuns[job.jobId] || []).length > 0 ? (
                    <div className="space-y-2">
                      {(jobRuns[job.jobId] || []).slice(0, 5).map((run) => (
                        <div key={run.runId} className="rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', runStatusTone(run.status))}>
                              {run.status}
                            </span>
                            <span className="font-mono text-[11px] text-white/55">{run.runId.slice(0, 8)}</span>
                            <span className="text-[11px] text-white/35">{new Date(run.createdAt).toLocaleString()}</span>
                            {run.provider ? (
                              <span className="ml-auto text-[10px] text-white/35">{run.provider}</span>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/45">
                            {run.resolvedWorkflowRef ? (
                              <span className="rounded-full bg-white/[0.06] px-2 py-0.5">{run.resolvedWorkflowRef}</span>
                            ) : null}
                            {run.triggerContext?.schedulerJobId ? (
                              <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-cyan-300/80">linked</span>
                            ) : null}
                            {typeof run.reportedEventCount === 'number' ? (
                              <span className="rounded-full bg-white/[0.06] px-2 py-0.5">{run.reportedEventCount} items</span>
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
                          <div className="mt-2 text-[12px] leading-5 text-white/70">
                            {run.result?.summary || run.resultEnvelope?.summary || run.lastError || '暂无结构化结果摘要'}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-white/8 px-3 py-3 text-xs text-white/40">
                      {job.action?.kind === 'health-check'
                        ? '这类任务只写 scheduler 执行结果，不会创建 run。'
                        : '还没有与这条 scheduler job 关联的 run。新触发后的 run 会出现在这里。'}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
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
              <label className="text-xs text-white/60 mb-1 block">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Daily health check"
              />
            </div>

            <div>
              <label className="text-xs text-white/60 mb-1 block">Type</label>
              <NativeSelect value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value as JobFormState['type'] }))}>
                <option value="cron">Cron</option>
                <option value="interval">Interval</option>
                <option value="once">Once</option>
              </NativeSelect>
            </div>

            {form.type === 'cron' && (
              <div>
                <label className="text-xs text-white/60 mb-1 block">Cron Expression</label>
                <Input
                  value={form.cronExpression}
                  onChange={(e) => { setForm(f => ({ ...f, cronExpression: e.target.value })); setCronError(null); }}
                  placeholder="0 9 * * *"
                  className={cn('font-mono', cronError && 'border-red-400/50')}
                />
                {cronError && (
                  <p className="mt-1 text-[11px] text-red-400">{cronError}</p>
                )}
                <p className="mt-1 text-[10px] text-white/30">minute hour day month weekday</p>
              </div>
            )}

            {form.type === 'interval' && (
              <div>
                <label className="text-xs text-white/60 mb-1 block">Interval (ms)</label>
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
                <label className="text-xs text-white/60 mb-1 block">Scheduled At (ISO)</label>
                <Input
                  value={form.scheduledAt}
                  onChange={(e) => setForm(f => ({ ...f, scheduledAt: e.target.value }))}
                  placeholder="2026-01-15T09:00:00Z"
                />
              </div>
            )}

            <div>
              <label className="text-xs text-white/60 mb-1 block">Action Kind</label>
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
                  <label className="text-xs text-white/60 mb-1 block">Workspace</label>
                  <Input
                    value={form.actionWorkspace}
                    onChange={(e) => setForm(f => ({ ...f, actionWorkspace: e.target.value }))}
                    placeholder="/path/to/workspace"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/60 mb-1 block">Prompt</label>
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
                  <label className="text-xs text-white/60 mb-1 block">Execution Profile</label>
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
                      <label className="text-xs text-white/60 mb-1 block">Workflow Ref (optional)</label>
                      <Input
                        value={form.executionProfileWorkflowRef}
                        onChange={(e) => setForm(f => ({ ...f, executionProfileWorkflowRef: e.target.value }))}
                        placeholder="/ai_digest"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-white/60 mb-1 block">Skill Hints (comma-separated)</label>
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
                      <label className="text-xs text-white/60 mb-1 block">Template ID</label>
                      <Input
                        value={form.actionTemplateId}
                        onChange={(e) => setForm(f => ({ ...f, actionTemplateId: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-white/60 mb-1 block">Stage ID (optional)</label>
                      <Input
                        value={form.actionStageId}
                        onChange={(e) => setForm(f => ({ ...f, actionStageId: e.target.value }))}
                        placeholder="Leave empty to dispatch entry stage"
                      />
                    </div>
                    {form.executionProfileKind === 'review-flow' && (
                      <div>
                        <label className="text-xs text-white/60 mb-1 block">Review Policy ID (optional)</label>
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
                  <label className="text-xs text-white/60 mb-1 block">Template ID</label>
                  <Input
                    value={form.actionTemplateId}
                    onChange={(e) => setForm(f => ({ ...f, actionTemplateId: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/60 mb-1 block">Stage ID (optional)</label>
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
                  <label className="text-xs text-white/60 mb-1 block">Prompt Asset Refs (comma-separated)</label>
                  <Input
                    value={form.actionPromptAssetRefs}
                    onChange={(e) => setForm(f => ({ ...f, actionPromptAssetRefs: e.target.value }))}
                    placeholder="/ai_bigevent, /ai_digest"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/60 mb-1 block">Skill Hints (comma-separated)</label>
                  <Input
                    value={form.actionSkillHints}
                    onChange={(e) => setForm(f => ({ ...f, actionSkillHints: e.target.value }))}
                    placeholder="ai-big-event, reporting"
                  />
                </div>
              </>
            )}

            <div>
              <label className="text-xs text-white/60 mb-1 block">Project ID (optional)</label>
              <Input
                value={form.actionProjectId}
                onChange={(e) => setForm(f => ({ ...f, actionProjectId: e.target.value }))}
              />
            </div>

            {/* OPC: Create Ad-hoc Project fields */}
            {form.actionKind === 'create-project' && (
              <>
                <div>
                  <label className="text-xs text-white/60 mb-1 block">Department Workspace URI</label>
                  <Input
                    value={form.departmentWorkspaceUri}
                    onChange={(e) => setForm(f => ({ ...f, departmentWorkspaceUri: e.target.value }))}
                    placeholder="file:///path/to/workspace"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/60 mb-1 block">Task Goal</label>
                  <Input
                    value={form.opcGoal}
                    onChange={(e) => setForm(f => ({ ...f, opcGoal: e.target.value }))}
                    placeholder="Generate daily SEO report"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/60 mb-1 block">Skill Hint (optional)</label>
                  <Input
                    value={form.opcSkillHint}
                    onChange={(e) => setForm(f => ({ ...f, opcSkillHint: e.target.value }))}
                    placeholder="seo-analysis"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/60 mb-1 block">Auto-dispatch Template ID (optional)</label>
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
