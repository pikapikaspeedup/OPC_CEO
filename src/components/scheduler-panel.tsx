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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { validateCron } from '@/lib/cron-utils';

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
  actionWorkspace: string;
  actionPrompt: string;
  actionTemplateId: string;
  actionStageId: string;
  actionProjectId: string;
  enabled: boolean;
  departmentWorkspaceUri: string;
  opcGoal: string;
  opcSkillHint: string;
}

const emptyForm: JobFormState = {
  name: '',
  type: 'cron',
  cronExpression: '',
  intervalMs: '',
  scheduledAt: '',
  actionKind: 'dispatch-pipeline',
  actionWorkspace: '',
  actionPrompt: '',
  actionTemplateId: '',
  actionStageId: '',
  actionProjectId: '',
  enabled: true,
  departmentWorkspaceUri: '',
  opcGoal: '',
  opcSkillHint: '',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SchedulerPanel({ className }: SchedulerPanelProps) {
  const [jobs, setJobs] = useState<SchedulerJobResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [form, setForm] = useState<JobFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [cronError, setCronError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

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
      actionWorkspace: (action.workspace as string) || '',
      actionPrompt: (action.prompt as string) || '',
      actionTemplateId: (action.templateId as string) || '',
      actionStageId: (action.stageId as string) || '',
      actionProjectId: (action.projectId as string) || '',
      enabled: job.enabled ?? true,
      departmentWorkspaceUri: job.departmentWorkspaceUri || '',
      opcGoal: job.opcAction?.goal || '',
      opcSkillHint: job.opcAction?.skillHint || '',
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
      if (effectiveActionKind === 'dispatch-pipeline' && form.actionWorkspace) action.workspace = form.actionWorkspace;
      if (effectiveActionKind === 'dispatch-pipeline' && form.actionPrompt) action.prompt = form.actionPrompt;
      if (effectiveActionKind === 'dispatch-pipeline' && form.actionTemplateId) action.templateId = form.actionTemplateId;
      if (effectiveActionKind === 'dispatch-pipeline' && form.actionStageId) action.stageId = form.actionStageId;
      if ((effectiveActionKind === 'dispatch-pipeline' || effectiveActionKind === 'health-check') && form.actionProjectId) action.projectId = form.actionProjectId;

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
                    'h-2 w-2 rounded-full shrink-0',
                    job.enabled ? 'bg-emerald-400' : 'bg-white/20',
                  )} />
                  <span className="text-sm font-medium text-white/80 truncate">
                    {job.name || job.jobId}
                  </span>
                </div>
                <ResultBadge result={job.lastRunResult} />
              </div>

              <div className="flex items-center gap-3 text-[11px] text-white/40 mb-2">
                <span className="font-mono">{job.type}</span>
                <span>{job.opcAction ? 'create-project' : job.action?.kind}</span>
                {job.departmentWorkspaceUri && (
                  <span className="text-sky-400/60">
                    {job.departmentWorkspaceUri.split('/').pop()}
                  </span>
                )}
                {job.nextRunAt && (
                  <span>
                    Next: {new Date(job.nextRunAt).toLocaleString()}
                  </span>
                )}
                {job.lastRunAt && (
                  <span>
                    Last: {new Date(job.lastRunAt).toLocaleString()}
                  </span>
                )}
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
                        }
                      : {}),
                  }));
                }}
              >
                <option value="dispatch-pipeline">Dispatch Pipeline</option>
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
