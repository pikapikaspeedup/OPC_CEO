import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import cronParser from 'cron-parser';
import { createLogger } from '../logger';
import { validateCron } from '../cron-utils';
import { GATEWAY_HOME, SCHEDULED_JOBS_FILE } from './gateway-home';
import { AssetLoader } from './asset-loader';
import { executeDispatch } from './dispatch-service';
import { executePrompt } from './prompt-executor';
import type { ScheduledAction, ScheduledJob, SchedulerTriggerResult } from './scheduler-types';

const log = createLogger('Scheduler');
const LOOP_INTERVAL_MS = 30_000;

type SchedulerState = {
  jobs: Map<string, ScheduledJob>;
  timer?: ReturnType<typeof setInterval>;
  initialized: boolean;
  tickRunning: boolean;
};

const globalForScheduler = globalThis as unknown as {
  __AG_SCHEDULER_STATE__?: SchedulerState;
};

const state: SchedulerState = globalForScheduler.__AG_SCHEDULER_STATE__ || {
  jobs: new Map<string, ScheduledJob>(),
  initialized: false,
  tickRunning: false,
};

if (process.env.NODE_ENV !== 'production') {
  globalForScheduler.__AG_SCHEDULER_STATE__ = state;
}

function ensureHome(): void {
  if (!existsSync(GATEWAY_HOME)) {
    mkdirSync(GATEWAY_HOME, { recursive: true });
  }
}

function saveJobs(): void {
  ensureHome();
  const jobs = Array.from(state.jobs.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  writeFileSync(SCHEDULED_JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf-8');
}

function loadJobs(): void {
  if (state.jobs.size > 0 && process.env.NODE_ENV !== 'production') {
    return;
  }

  if (!existsSync(SCHEDULED_JOBS_FILE)) {
    return;
  }

  try {
    const raw = readFileSync(SCHEDULED_JOBS_FILE, 'utf-8');
    const jobs = JSON.parse(raw) as ScheduledJob[];
    state.jobs.clear();
    for (const job of jobs) {
      state.jobs.set(job.jobId, job);
    }
    log.info({ count: jobs.length }, 'Scheduled jobs loaded');
  } catch (err: any) {
    log.error({ err: err.message }, 'Failed to load scheduled jobs');
  }
}

function getActionSummary(action: ScheduledAction): string {
  if (action.kind === 'dispatch-pipeline') {
    return `dispatch template ${action.templateId}${action.stageId ? ` stage ${action.stageId}` : ''}`;
  }
  if (action.kind === 'create-project') {
    return 'create ad-hoc project';
  }
  return `health-check project ${action.projectId}`;
}

function getScheduledJobProjectId(job: ScheduledJob, linkedProjectId?: string): string | undefined {
  if (linkedProjectId) {
    return linkedProjectId;
  }
  if (job.action.kind === 'health-check') {
    return job.action.projectId;
  }
  if (job.action.kind === 'dispatch-pipeline') {
    return job.action.projectId;
  }
  return undefined;
}

function normalizeWorkspaceUri(uri?: string): string | undefined {
  if (!uri) return undefined;
  if (uri.startsWith('file://')) return uri;
  if (uri.startsWith('/')) return `file://${uri}`;
  return uri;
}

function normalizeScheduledAction(action: ScheduledAction): ScheduledAction {
  if (action.kind === 'dispatch-pipeline') {
    return {
      ...action,
      workspace: normalizeWorkspaceUri(action.workspace) || action.workspace,
      prompt: action.prompt.trim(),
      ...(action.stageId ? { stageId: action.stageId } : {}),
      ...(action.projectId ? { projectId: action.projectId } : {}),
      ...(action.model ? { model: action.model } : {}),
      ...(action.sourceRunIds?.length ? { sourceRunIds: action.sourceRunIds } : {}),
    };
  }

  return action;
}

export function normalizeScheduledJobDefinition(job: ScheduledJob): ScheduledJob {
  const normalized: ScheduledJob = {
    ...job,
    name: job.name.trim(),
    action: normalizeScheduledAction(job.action),
    ...(job.intentSummary ? { intentSummary: job.intentSummary.trim() } : {}),
  };

  if (!normalized.name) {
    throw new Error('Scheduled job name is required');
  }

  if (normalized.type === 'cron') {
    const cronError = validateCron(normalized.cronExpression || '');
    if (cronError) {
      throw new Error(cronError);
    }
    delete normalized.intervalMs;
    delete normalized.scheduledAt;
  }

  if (normalized.type === 'interval') {
    if (!normalized.intervalMs || normalized.intervalMs <= 0) {
      throw new Error('interval jobs require intervalMs > 0');
    }
    delete normalized.cronExpression;
    delete normalized.scheduledAt;
  }

  if (normalized.type === 'once') {
    if (!normalized.scheduledAt) {
      throw new Error('once jobs require scheduledAt');
    }
    delete normalized.cronExpression;
    delete normalized.intervalMs;
  }

  if (normalized.action.kind === 'dispatch-pipeline') {
    if (!normalized.action.workspace || !normalized.action.prompt || !normalized.action.templateId) {
      throw new Error('dispatch-pipeline jobs require workspace, prompt and templateId');
    }
    delete normalized.departmentWorkspaceUri;
    delete normalized.opcAction;
  }

  if (normalized.action.kind === 'health-check') {
    if (!normalized.action.projectId) {
      throw new Error('health-check jobs require projectId');
    }
    delete normalized.departmentWorkspaceUri;
    delete normalized.opcAction;
  }

  if (normalized.action.kind === 'dispatch-prompt') {
    if (!normalized.action.workspace || !normalized.action.prompt) {
      throw new Error('dispatch-prompt jobs require workspace and prompt');
    }
    delete normalized.departmentWorkspaceUri;
    delete normalized.opcAction;
  }

  if (normalized.action.kind === 'create-project') {
    normalized.departmentWorkspaceUri = normalizeWorkspaceUri(normalized.departmentWorkspaceUri);
    if (!normalized.departmentWorkspaceUri || !normalized.opcAction?.goal) {
      throw new Error('create-project jobs require departmentWorkspaceUri and opcAction.goal');
    }
    const templateId = normalized.opcAction.templateId?.trim();
    if (templateId && !AssetLoader.getTemplate(templateId)) {
      throw new Error(`Template not found: ${templateId}`);
    }
    normalized.opcAction = {
      type: 'create_project',
      projectType: 'adhoc',
      goal: normalized.opcAction.goal.trim(),
      ...(normalized.opcAction.skillHint ? { skillHint: normalized.opcAction.skillHint } : {}),
      ...(templateId ? { templateId } : {}),
    };
  }

  return normalized;
}

export function isScheduledJobDue(job: ScheduledJob, now: Date): boolean {
  if (!job.enabled) return false;
  const lastRunAt = job.lastRunAt ? new Date(job.lastRunAt) : undefined;

  if (job.type === 'once') {
    if (!job.scheduledAt || lastRunAt) return false;
    return new Date(job.scheduledAt).getTime() <= now.getTime();
  }

  if (job.type === 'interval') {
    if (!job.intervalMs || job.intervalMs <= 0) return false;
    if (!lastRunAt) return true;
    return now.getTime() - lastRunAt.getTime() >= job.intervalMs;
  }

  if (!job.cronExpression) return false;
  try {
    const interval = cronParser.parse(job.cronExpression, {
      currentDate: now,
    });
    const previous = interval.prev().toDate();
    if (!lastRunAt) return previous.getTime() <= now.getTime();
    return previous.getTime() > lastRunAt.getTime();
  } catch (err: any) {
    log.warn({ jobId: job.jobId, err: err.message }, 'Skipping invalid cron job');
    return false;
  }
}

export function getProjectHealth(projectId: string): 'running' | 'completed' | 'stale' | 'blocked' | 'waiting' | 'failed' {
  const { getProject } = require('./project-registry');
  const { getRun } = require('./run-registry');
  const project = getProject(projectId);
  if (!project?.pipelineState) return 'failed';

  const pipelineState = project.pipelineState;
  if (pipelineState.status === 'completed') return 'completed';
  if (pipelineState.status === 'failed' || pipelineState.status === 'cancelled') return 'failed';

  const activeStages = pipelineState.stages.filter((stage: any) => stage.status === 'running');
  if (activeStages.length === 0) {
    if (pipelineState.stages.some((stage: any) => stage.status === 'blocked')) return 'blocked';
    if (pipelineState.stages.some((stage: any) => stage.status === 'pending')) return 'waiting';
    return 'failed';
  }

  for (const stage of activeStages) {
    const branchRunIds = (stage.branches || [])
      .map((branch: any) => branch.runId)
      .filter(Boolean);
    const runIds = [stage.runId, ...branchRunIds].filter(Boolean);
    for (const runId of runIds) {
      const run = getRun(runId);
      if (run?.liveState?.staleSince) {
        return 'stale';
      }
    }
  }

  return 'running';
}

async function triggerAction(action: ScheduledAction): Promise<string | undefined> {
  if (action.kind === 'health-check') {
    const health = getProjectHealth(action.projectId);
    log.info({ projectId: action.projectId, health }, 'Scheduler health-check completed');
    return `health=${health}`;
  }

  if (action.kind === 'create-project') {
    throw new Error('Create-project jobs must include opcAction and departmentWorkspaceUri');
  }

  if (action.kind === 'dispatch-prompt') {
    const result = await executePrompt({
      workspace: action.workspace,
      prompt: action.prompt,
      model: action.model,
      projectId: action.projectId,
      executionTarget: {
        kind: 'prompt',
        ...(action.promptAssetRefs?.length ? { promptAssetRefs: action.promptAssetRefs } : {}),
        ...(action.skillHints?.length ? { skillHints: action.skillHints } : {}),
      },
    });
    return `runId=${result.runId}`;
  }

  if (action.kind === 'dispatch-pipeline') {
    const result = await executeDispatch({
      workspace: action.workspace,
      prompt: action.prompt,
      model: action.model,
      projectId: action.projectId,
      templateId: action.templateId,
      stageId: action.stageId,
      sourceRunIds: action.sourceRunIds,
    });
    return `runId=${result.runId}`;
  }
}

export async function triggerScheduledJob(jobId: string): Promise<SchedulerTriggerResult> {
  const job = state.jobs.get(jobId);
  if (!job) {
    throw new Error(`Scheduled job not found: ${jobId}`);
  }

  const triggeredAt = new Date().toISOString();
  try {
    let message: string | undefined;
    let linkedProjectId: string | undefined;
    if (job.action.kind === 'create-project' || job.opcAction?.type === 'create_project') {
      if (!job.departmentWorkspaceUri || !job.opcAction?.goal) {
        throw new Error('Create-project scheduled job is missing departmentWorkspaceUri or opcAction.goal');
      }
      const { createProject } = await import('./project-registry');
      const project = createProject({
        name: job.name,
        goal: job.opcAction.goal,
        workspace: job.departmentWorkspaceUri,
        ...(job.opcAction.templateId ? { templateId: job.opcAction.templateId } : {}),
        projectType: 'adhoc',
        skillHint: job.opcAction.skillHint,
      });
      linkedProjectId = project.projectId;
      if (job.opcAction.templateId) {
        const dispatchResult = await executeDispatch({
          workspace: project.workspace || job.departmentWorkspaceUri,
          projectId: project.projectId,
          templateId: job.opcAction.templateId,
          prompt: job.opcAction.goal,
        });
        message = `projectId=${project.projectId}, runId=${dispatchResult.runId}`;
      } else {
        message = `projectId=${project.projectId}`;
      }
    } else {
      message = await triggerAction(job.action);
    }
    job.lastRunAt = triggeredAt;
    job.lastRunResult = 'success';
    job.lastRunError = undefined;
    if (job.type === 'once') {
      job.enabled = false;
    }
    saveJobs();

    try {
      const { appendAuditEvent } = await import('./ops-audit');
      appendAuditEvent({
        kind: 'scheduler:triggered',
        jobId,
        projectId: getScheduledJobProjectId(job, linkedProjectId),
        message: `Job '${job.name}' triggered: ${message || 'ok'}`,
        meta: { action: job.action.kind },
      });
    } catch { /* audit non-critical */ }

    return { jobId, status: 'success', triggeredAt, message };
  } catch (err: any) {
    job.lastRunAt = triggeredAt;
    job.lastRunResult = 'failed';
    job.lastRunError = err.message;
    saveJobs();

    try {
      const { appendAuditEvent } = await import('./ops-audit');
      appendAuditEvent({
        kind: 'scheduler:failed',
        jobId,
        projectId: getScheduledJobProjectId(job),
        message: `Job '${job.name}' failed: ${err.message}`,
        meta: { action: job.action.kind },
      });
    } catch { /* audit non-critical */ }

    throw err;
  }
}

async function tick(): Promise<void> {
  if (state.tickRunning) return;
  state.tickRunning = true;

  try {
    const now = new Date();
    const dueJobs = Array.from(state.jobs.values()).filter(job => isScheduledJobDue(job, now));
    for (const job of dueJobs) {
      try {
        const result = await triggerScheduledJob(job.jobId);
        log.info({ jobId: job.jobId, action: getActionSummary(job.action), result }, 'Scheduled job executed');
      } catch (err: any) {
        log.error({ jobId: job.jobId, action: getActionSummary(job.action), err: err.message }, 'Scheduled job failed');
      }
    }

    try {
      const { scanFanOutBranchHealth } = await import('./fan-out-controller');
      await scanFanOutBranchHealth();
    } catch {
      // Fan-out controller is optional in early phases.
    }
  } finally {
    state.tickRunning = false;
  }
}

export function initializeScheduler(): void {
  if (state.initialized) return;
  loadJobs();
  state.timer = setInterval(() => {
    void tick();
  }, LOOP_INTERVAL_MS);
  state.initialized = true;
  log.info({ intervalMs: LOOP_INTERVAL_MS }, 'Scheduler initialized');
}

export function stopScheduler(): void {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = undefined;
  }
  state.initialized = false;
}

export function listScheduledJobs(): ScheduledJob[] {
  return Array.from(state.jobs.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getScheduledJob(jobId: string): ScheduledJob | null {
  return state.jobs.get(jobId) ?? null;
}

export function createScheduledJob(input: Omit<ScheduledJob, 'jobId' | 'createdAt'>): ScheduledJob {
  const job = normalizeScheduledJobDefinition({
    ...input,
    jobId: randomUUID(),
    createdAt: new Date().toISOString(),
  });
  state.jobs.set(job.jobId, job);
  saveJobs();
  try {
    const { appendAuditEvent } = require('./ops-audit') as typeof import('./ops-audit');
    appendAuditEvent({
      kind: 'scheduler:created',
      jobId: job.jobId,
      projectId: getScheduledJobProjectId(job),
      message: `Job '${job.name}' created`,
      meta: {
        action: job.action.kind,
        createdBy: job.createdBy,
        type: job.type,
      },
    });
  } catch {
    // non-critical
  }
  return job;
}

export function updateScheduledJob(jobId: string, updates: Partial<Omit<ScheduledJob, 'jobId' | 'createdAt'>>): ScheduledJob | null {
  const existing = state.jobs.get(jobId);
  if (!existing) return null;
  const previousEnabled = existing.enabled;
  const normalized = normalizeScheduledJobDefinition({
    ...existing,
    ...updates,
    action: (updates.action as ScheduledAction | undefined) || existing.action,
  });

  const shouldResetOnceExecution = normalized.type === 'once' && (
    (typeof updates.scheduledAt === 'string' && updates.scheduledAt !== existing.scheduledAt)
    || (updates.enabled === true && !existing.enabled)
  );

  if (shouldResetOnceExecution) {
    normalized.lastRunAt = undefined;
    normalized.lastRunResult = undefined;
    normalized.lastRunError = undefined;
  }

  state.jobs.set(jobId, normalized);
  saveJobs();
  try {
    const { appendAuditEvent } = require('./ops-audit') as typeof import('./ops-audit');
    const enabledChanged = typeof updates.enabled === 'boolean' && updates.enabled !== previousEnabled;
    appendAuditEvent({
      kind: 'scheduler:updated',
      jobId,
      projectId: getScheduledJobProjectId(normalized),
      message: enabledChanged
        ? `Job '${normalized.name}' ${normalized.enabled ? 'enabled' : 'disabled'}`
        : `Job '${normalized.name}' updated`,
      meta: {
        action: normalized.action.kind,
        enabled: normalized.enabled,
      },
    });
  } catch {
    // non-critical
  }
  return normalized;
}

export function deleteScheduledJob(jobId: string): boolean {
  const existing = state.jobs.get(jobId);
  const deleted = state.jobs.delete(jobId);
  if (deleted) {
    saveJobs();
    try {
      const { appendAuditEvent } = require('./ops-audit') as typeof import('./ops-audit');
      appendAuditEvent({
        kind: 'scheduler:deleted',
        jobId,
        projectId: existing ? getScheduledJobProjectId(existing) : undefined,
        message: `Job '${existing?.name || jobId}' deleted`,
        meta: {
          action: existing?.action.kind,
        },
      });
    } catch {
      // non-critical
    }
  }
  return deleted;
}

/**
 * Compute the next run time for a scheduled job.
 */
export function getNextRunAt(job: ScheduledJob): string | null {
  if (!job.enabled) return null;

  if (job.type === 'once') {
    if (!job.scheduledAt || job.lastRunAt) return null;
    return job.scheduledAt;
  }

  if (job.type === 'interval') {
    if (!job.intervalMs || job.intervalMs <= 0) return null;
    const base = job.lastRunAt ? new Date(job.lastRunAt) : new Date();
    return new Date(base.getTime() + job.intervalMs).toISOString();
  }

  if (job.type === 'cron' && job.cronExpression) {
    try {
      const interval = cronParser.parse(job.cronExpression, {
        currentDate: new Date(),
      });
      return interval.next().toDate().toISOString();
    } catch {
      return null;
    }
  }

  return null;
}

export interface EnrichedScheduledJob extends ScheduledJob {
  nextRunAt: string | null;
}

/**
 * List all scheduled jobs with enriched fields (nextRunAt).
 */
export function listScheduledJobsEnriched(): EnrichedScheduledJob[] {
  return listScheduledJobs().map(job => ({
    ...job,
    nextRunAt: getNextRunAt(job),
  }));
}
