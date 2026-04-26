import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import cronParser from 'cron-parser';
import { createLogger } from '../logger';
import { validateCron } from '../cron-utils';
import { GATEWAY_HOME } from './gateway-home';
import { AssetLoader } from './asset-loader';
import {
  deriveExecutionProfileFromScheduledAction,
  normalizeExecutionProfileForTarget,
  summarizeExecutionProfile,
} from '../execution';
import { executeDispatch } from './dispatch-service';
import { executePrompt } from './prompt-executor';
import { appendAuditEvent } from './ops-audit';
import { getProject } from './project-registry';
import { getRun } from './run-registry';
import type { ScheduledAction, ScheduledJob, SchedulerTriggerResult } from './scheduler-types';
import { deleteScheduledJobRecord, listScheduledJobRecords, upsertScheduledJobRecord } from '../storage/gateway-db';
import { appendCEOEvent } from '../organization/ceo-event-store';
import { shouldStartSchedulerCompanionServices, shouldStartSchedulerServices, getGatewayServerRole } from '../gateway-role';
import { buildAgendaItemFromSignals } from '../company-kernel/agenda';
import { upsertOperatingAgendaItem } from '../company-kernel/agenda-store';
import {
  attachRunToBudgetReservation,
  releaseBudgetForRun,
  reserveBudgetForAgendaItem,
} from '../company-kernel/budget-gate';
import { runCompanyLoop } from '../company-kernel/company-loop-executor';
import { getOrCreateCompanyLoopPolicy } from '../company-kernel/company-loop-policy';
import type { BudgetLedgerEntry, OperatingAgendaItem } from '../company-kernel/contracts';
import { buildSchedulerOperatingSignal } from '../company-kernel/operating-signal';
import { updateOperatingSignalStatus, upsertOperatingSignal } from '../company-kernel/operating-signal-store';
import type { PipelineStageProgress } from './project-types';

const log = createLogger('Scheduler');
const MIN_LOOP_INTERVAL_MS = 1_000;
const MAX_LOOP_INTERVAL_MS = 30_000;

type SchedulerState = {
  jobs: Map<string, ScheduledJob>;
  timer?: ReturnType<typeof setTimeout>;
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
  for (const job of jobs) {
    upsertScheduledJobRecord(job);
    observeScheduledJobForAgenda(job);
  }
}

function isDispatchingScheduledAction(job: ScheduledJob): boolean {
  return job.action.kind !== 'health-check';
}

function estimateScheduledActionCost(job: ScheduledJob): { tokens: number; minutes: number } {
  const prompt = 'prompt' in job.action ? job.action.prompt : job.opcAction?.goal || job.intentSummary || job.name;
  const promptTokens = Math.ceil((prompt || '').length / 3);
  if (job.action.kind === 'health-check') {
    return { tokens: 0, minutes: 1 };
  }
  if (job.action.kind === 'company-loop') {
    return { tokens: 2_500, minutes: 5 };
  }
  if (job.action.kind === 'create-project') {
    return { tokens: 2_000 + promptTokens, minutes: job.opcAction?.templateId ? 30 : 5 };
  }
  if (job.action.kind === 'dispatch-pipeline' || job.action.kind === 'dispatch-execution-profile') {
    return { tokens: 6_000 + promptTokens, minutes: 45 };
  }
  return { tokens: 3_000 + promptTokens, minutes: 20 };
}

function observeScheduledJobForAgenda(job: ScheduledJob, input?: {
  reason?: string;
  kind?: 'routine' | 'risk' | 'failure';
  now?: string;
}): OperatingAgendaItem | null {
  try {
    const signal = buildSchedulerOperatingSignal(job, {
      ...(input?.reason ? { reason: input.reason } : {}),
      ...(input?.kind ? { kind: input.kind } : {}),
      ...(input?.now ? { now: input.now } : {}),
      estimatedCost: estimateScheduledActionCost(job),
    });
    if (!signal) return null;
    const storedSignal = upsertOperatingSignal(signal);
    const triagedSignal = updateOperatingSignalStatus(storedSignal.id, 'triaged') || storedSignal;
    const item = buildAgendaItemFromSignals([triagedSignal]);
    return upsertOperatingAgendaItem({
      ...item,
      recommendedAction: isDispatchingScheduledAction(job) ? 'dispatch' : item.recommendedAction,
      status: isDispatchingScheduledAction(job) ? 'ready' : item.status,
      estimatedCost: estimateScheduledActionCost(job),
      metadata: {
        ...(item.metadata || {}),
        schedulerJobId: job.jobId,
        actionKind: job.action.kind,
      },
    });
  } catch (err: unknown) {
    log.debug({
      jobId: job.jobId,
      err: err instanceof Error ? err.message : String(err),
    }, 'Failed to observe scheduled job for agenda');
    return null;
  }
}

function loadJobs(force = false): void {
  if (!force && state.jobs.size > 0) {
    return;
  }
  try {
    const jobs = listScheduledJobRecords();
    state.jobs.clear();
    for (const job of jobs) {
      state.jobs.set(job.jobId, job);
    }
    if (force) {
      log.debug({ count: jobs.length }, 'Scheduled jobs refreshed from storage');
    } else {
      log.info({ count: jobs.length }, 'Scheduled jobs loaded');
    }
  } catch (err: unknown) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'Failed to load scheduled jobs');
  }
}

const BUILT_IN_COMPANY_DAILY_LOOP_ID = 'builtin-company-daily-loop';
const BUILT_IN_COMPANY_WEEKLY_REVIEW_ID = 'builtin-company-weekly-review';
const BUILT_IN_LOOP_WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function safeLoopTimeZone(timeZone: string): string {
  try {
    validateTimeZone(timeZone);
    return timeZone;
  } catch {
    return 'Asia/Shanghai';
  }
}

function buildBuiltInCompanyLoopJobs(now: string): ScheduledJob[] {
  const policy = getOrCreateCompanyLoopPolicy();
  const timeZone = safeLoopTimeZone(policy.timezone);
  const dailyHour = clampInteger(policy.dailyReviewHour, 0, 23);
  const weeklyDay = clampInteger(policy.weeklyReviewDay, 0, 6);
  const weeklyHour = clampInteger(policy.weeklyReviewHour, 0, 23);

  return [
    {
      jobId: BUILT_IN_COMPANY_DAILY_LOOP_ID,
      name: `Company Daily Loop · ${String(dailyHour).padStart(2, '0')}:05`,
      type: 'cron',
      cronExpression: `5 ${dailyHour} * * *`,
      timeZone,
      action: { kind: 'company-loop', loopKind: 'daily-review', policyId: policy.id },
      enabled: policy.enabled,
      createdAt: now,
      createdBy: 'api',
      intentSummary: 'Daily autonomous company operating loop',
    },
    {
      jobId: BUILT_IN_COMPANY_WEEKLY_REVIEW_ID,
      name: `Company Weekly Review · ${BUILT_IN_LOOP_WEEKDAY_LABELS[weeklyDay]} ${String(weeklyHour).padStart(2, '0')}:30`,
      type: 'cron',
      cronExpression: `30 ${weeklyHour} * * ${weeklyDay}`,
      timeZone,
      action: { kind: 'company-loop', loopKind: 'weekly-review', policyId: policy.id },
      enabled: policy.enabled,
      createdAt: now,
      createdBy: 'api',
      intentSummary: 'Weekly autonomous company growth and risk review',
    },
  ];
}

function shouldReplaceBuiltInCompanyLoopJob(existing: ScheduledJob | undefined, next: ScheduledJob): boolean {
  if (!existing) return true;
  return existing.name !== next.name
    || existing.type !== next.type
    || existing.cronExpression !== next.cronExpression
    || existing.timeZone !== next.timeZone
    || existing.enabled !== next.enabled
    || existing.intentSummary !== next.intentSummary
    || JSON.stringify(existing.action) !== JSON.stringify(next.action);
}

function ensureBuiltInCompanyLoopJobs(): void {
  const now = new Date().toISOString();
  const builtIns = buildBuiltInCompanyLoopJobs(now);

  let changed = false;
  for (const job of builtIns) {
    const existing = state.jobs.get(job.jobId);
    const normalized = normalizeScheduledJobDefinition({
      ...(existing || {}),
      ...job,
      createdAt: existing?.createdAt || job.createdAt,
      ...(existing?.lastRunAt ? { lastRunAt: existing.lastRunAt } : {}),
      ...(existing?.lastRunResult ? { lastRunResult: existing.lastRunResult } : {}),
      ...(existing?.lastRunError ? { lastRunError: existing.lastRunError } : {}),
    });
    if (shouldReplaceBuiltInCompanyLoopJob(existing, normalized)) {
      state.jobs.set(job.jobId, normalized);
      changed = true;
    }
  }
  if (changed) {
    saveJobs();
  }
}

function getActionSummary(action: ScheduledAction): string {
  if (action.kind === 'dispatch-pipeline') {
    return `dispatch template ${action.templateId}${action.stageId ? ` stage ${action.stageId}` : ''}`;
  }
  if (action.kind === 'dispatch-execution-profile') {
    return `dispatch ${summarizeExecutionProfile(action.executionProfile).label.toLowerCase()}`;
  }
  if (action.kind === 'create-project') {
    return 'create ad-hoc project';
  }
  if (action.kind === 'company-loop') {
    return `company ${action.loopKind}`;
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

function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new Error(`Invalid timeZone: ${timeZone}`);
  }
}

function getCronParserOptions(job: ScheduledJob, currentDate: Date) {
  return {
    currentDate,
    ...(job.timeZone ? { tz: job.timeZone } : {}),
  };
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
    ...(job.timeZone?.trim() ? { timeZone: job.timeZone.trim() } : {}),
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
    if (normalized.timeZone) {
      validateTimeZone(normalized.timeZone);
    }
    delete normalized.intervalMs;
    delete normalized.scheduledAt;
  }

  if (normalized.type === 'interval') {
    if (!normalized.intervalMs || normalized.intervalMs <= 0) {
      throw new Error('interval jobs require intervalMs > 0');
    }
    delete normalized.cronExpression;
    delete normalized.timeZone;
    delete normalized.scheduledAt;
  }

  if (normalized.type === 'once') {
    if (!normalized.scheduledAt) {
      throw new Error('once jobs require scheduledAt');
    }
    delete normalized.cronExpression;
    delete normalized.timeZone;
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

  if (normalized.action.kind === 'company-loop') {
    if (!normalized.action.loopKind) {
      throw new Error('company-loop jobs require loopKind');
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

  if (normalized.action.kind === 'dispatch-execution-profile') {
    if (!normalized.action.workspace || !normalized.action.prompt) {
      throw new Error('dispatch-execution-profile jobs require workspace and prompt');
    }
    if (normalized.action.executionProfile.kind !== 'workflow-run') {
      if (!normalized.action.executionProfile.templateId) {
        throw new Error('review-flow and dag-orchestration executionProfile jobs require templateId');
      }
      if (!AssetLoader.getTemplate(normalized.action.executionProfile.templateId)) {
        throw new Error(`Template not found: ${normalized.action.executionProfile.templateId}`);
      }
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
    const interval = cronParser.parse(job.cronExpression, getCronParserOptions(job, now));
    const previous = interval.prev().toDate();
    if (!lastRunAt) return previous.getTime() <= now.getTime();
    return previous.getTime() > lastRunAt.getTime();
  } catch (err: unknown) {
    log.warn({ jobId: job.jobId, err: err instanceof Error ? err.message : String(err) }, 'Skipping invalid cron job');
    return false;
  }
}

function getNextDueDate(job: ScheduledJob, now: Date): Date | null {
  if (!job.enabled) return null;
  if (isScheduledJobDue(job, now)) return now;

  if (job.type === 'once') {
    if (!job.scheduledAt || job.lastRunAt) return null;
    return new Date(job.scheduledAt);
  }

  if (job.type === 'interval') {
    if (!job.intervalMs || job.intervalMs <= 0) return null;
    const base = job.lastRunAt ? new Date(job.lastRunAt) : now;
    return new Date(base.getTime() + job.intervalMs);
  }

  if (!job.cronExpression) return null;
  try {
    const interval = cronParser.parse(job.cronExpression, getCronParserOptions(job, now));
    return interval.next().toDate();
  } catch (err: unknown) {
    log.warn({ jobId: job.jobId, err: err instanceof Error ? err.message : String(err) }, 'Skipping invalid cron job when computing next due time');
    return null;
  }
}

export function getSchedulerLoopDelay(
  now: Date = new Date(),
  jobs: ScheduledJob[] = Array.from(state.jobs.values()),
): number {
  let soonestDelay = MAX_LOOP_INTERVAL_MS;

  for (const job of jobs) {
    const dueDate = getNextDueDate(job, now);
    if (!dueDate) continue;

    const delay = dueDate.getTime() - now.getTime();
    if (delay <= MIN_LOOP_INTERVAL_MS) {
      return MIN_LOOP_INTERVAL_MS;
    }
    soonestDelay = Math.min(soonestDelay, delay);
  }

  return Math.max(MIN_LOOP_INTERVAL_MS, Math.min(MAX_LOOP_INTERVAL_MS, soonestDelay));
}

export type SchedulerRuntimeState = 'running' | 'idle' | 'disabled' | 'stalled';

export interface SchedulerRuntimeStatus {
  status: SchedulerRuntimeState;
  loopActive: boolean;
  configuredToStart: boolean;
  companionServicesEnabled: boolean;
  role: string;
  enabledJobCount: number;
  dueNowCount: number;
  nextRunAt: string | null;
  checkedAt: string;
  message: string;
}

export function getSchedulerRuntimeStatus(
  jobs: ScheduledJob[] = Array.from(state.jobs.values()),
  now: Date = new Date(),
): SchedulerRuntimeStatus {
  const enabledJobs = jobs.filter(job => job.enabled !== false);
  const dueNowCount = enabledJobs.filter(job => isScheduledJobDue(job, now)).length;
  const nextRunAt = enabledJobs
    .map(job => getNextDueDate(job, now)?.toISOString() || null)
    .filter((value): value is string => Boolean(value))
    .sort()[0] || null;
  const configuredToStart = shouldStartSchedulerServices(process.env);
  const loopActive = state.initialized && Boolean(state.timer || state.tickRunning || enabledJobs.length === 0);

  let status: SchedulerRuntimeState;
  if (!configuredToStart) {
    status = 'disabled';
  } else if (!state.initialized) {
    status = enabledJobs.length > 0 ? 'stalled' : 'idle';
  } else {
    status = enabledJobs.length > 0 ? 'running' : 'idle';
  }

  const message = (() => {
    if (status === 'disabled') return 'Scheduler is disabled by current process configuration.';
    if (status === 'stalled') return 'Scheduler is expected to run, but the loop is not initialized in this process.';
    if (status === 'idle') return 'Scheduler loop is available and no enabled jobs are pending.';
    if (dueNowCount > 0) return `${dueNowCount} enabled job(s) are due now.`;
    return 'Scheduler loop is running.';
  })();

  return {
    status,
    loopActive,
    configuredToStart,
    companionServicesEnabled: shouldStartSchedulerCompanionServices(process.env),
    role: getGatewayServerRole(process.env),
    enabledJobCount: enabledJobs.length,
    dueNowCount,
    nextRunAt,
    checkedAt: now.toISOString(),
    message,
  };
}

function scheduleNextTick(): void {
  if (!state.initialized) return;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = undefined;
  }

  const delay = getSchedulerLoopDelay(new Date());
  state.timer = setTimeout(() => {
    state.timer = undefined;
    void tick().finally(() => {
      if (state.initialized) {
        scheduleNextTick();
      }
    });
  }, delay);
}

export function getProjectHealth(projectId: string): 'running' | 'completed' | 'stale' | 'blocked' | 'waiting' | 'failed' {
  const project = getProject(projectId);
  if (!project?.pipelineState) return 'failed';

  const pipelineState = project.pipelineState;
  if (pipelineState.status === 'completed') return 'completed';
  if (pipelineState.status === 'failed' || pipelineState.status === 'cancelled') return 'failed';

  const activeStages = pipelineState.stages.filter((stage: PipelineStageProgress) => stage.status === 'running');
  if (activeStages.length === 0) {
    if (pipelineState.stages.some((stage: PipelineStageProgress) => stage.status === 'blocked')) return 'blocked';
    if (pipelineState.stages.some((stage: PipelineStageProgress) => stage.status === 'pending')) return 'waiting';
    return 'failed';
  }

  for (const stage of activeStages) {
    const branchRunIds = (stage.branches || [])
      .map((branch) => branch.runId)
      .filter(Boolean);
    const runIds = [stage.runId, ...branchRunIds].filter((runId): runId is string => Boolean(runId));
    for (const runId of runIds) {
      const run = getRun(runId);
      if (run?.liveState?.staleSince) {
        return 'stale';
      }
    }
  }

  return 'running';
}

interface TriggerActionOutcome {
  message?: string;
  runId?: string;
}

async function triggerAction(action: ScheduledAction, schedulerJobId?: string): Promise<TriggerActionOutcome> {
  if (action.kind === 'health-check') {
    const health = getProjectHealth(action.projectId);
    log.info({ projectId: action.projectId, health }, 'Scheduler health-check completed');
    return { message: `health=${health}` };
  }

  if (action.kind === 'create-project') {
    throw new Error('Create-project jobs must include opcAction and departmentWorkspaceUri');
  }

  if (action.kind === 'company-loop') {
    const result = runCompanyLoop({
      kind: action.loopKind,
      ...(action.policyId ? { policyId: action.policyId } : {}),
      source: 'scheduler',
    });
    return { message: `loopRunId=${result.run.id}, status=${result.run.status}` };
  }

  if (action.kind === 'dispatch-prompt') {
    const result = await executePrompt({
      workspace: action.workspace,
      prompt: action.prompt,
      model: action.model,
      projectId: action.projectId,
      triggerContext: {
        source: 'scheduler',
        schedulerJobId,
      },
      executionTarget: {
        kind: 'prompt',
        ...(action.promptAssetRefs?.length ? { promptAssetRefs: action.promptAssetRefs } : {}),
        ...(action.skillHints?.length ? { skillHints: action.skillHints } : {}),
      },
    });
    return { message: `runId=${result.runId}`, runId: result.runId };
  }

  if (action.kind === 'dispatch-execution-profile') {
    const target = normalizeExecutionProfileForTarget(action.executionProfile);
    if (target.kind === 'prompt') {
      const result = await executePrompt({
        workspace: action.workspace,
        prompt: action.prompt,
        model: action.model,
        projectId: action.projectId,
        triggerContext: {
          source: 'scheduler',
          schedulerJobId,
        },
        executionTarget: {
          kind: 'prompt',
          ...(target.promptAssetRefs?.length ? { promptAssetRefs: target.promptAssetRefs } : {}),
          ...(target.skillHints?.length ? { skillHints: target.skillHints } : {}),
        },
      });
      return { message: `runId=${result.runId}`, runId: result.runId };
    }

    if (!target.templateId) {
      throw new Error('review-flow executionProfile requires a template-backed target');
    }

    const result = await executeDispatch({
      workspace: action.workspace,
      prompt: action.prompt,
      model: action.model,
      projectId: action.projectId,
      templateId: target.templateId,
      stageId: target.stageId,
      triggerContext: {
        source: 'scheduler',
        schedulerJobId,
      },
    });
    return { message: `runId=${result.runId}`, runId: result.runId };
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
      triggerContext: {
        source: 'scheduler',
        schedulerJobId,
      },
    });
    return { message: `runId=${result.runId}`, runId: result.runId };
  }

  return { message: 'noop' };
}

function releaseSchedulerBudgetReservation(input: {
  ledger?: BudgetLedgerEntry;
  agendaItem?: OperatingAgendaItem | null;
  jobId: string;
  reason: string;
}): void {
  if (!input.ledger || input.ledger.decision !== 'reserved') return;
  releaseBudgetForRun({
    agendaItemId: input.agendaItem?.id || input.ledger.agendaItemId,
    policyId: input.ledger.policyId,
    scope: input.ledger.scope,
    scopeId: input.ledger.scopeId,
    schedulerJobId: input.jobId,
    reason: input.reason,
  });
}

export async function triggerScheduledJob(jobId: string): Promise<SchedulerTriggerResult> {
  loadJobs(true);
  const job = state.jobs.get(jobId);
  if (!job) {
    throw new Error(`Scheduled job not found: ${jobId}`);
  }

  const triggeredAt = new Date().toISOString();
  let agendaItem: OperatingAgendaItem | null = null;
  let budgetLedger: BudgetLedgerEntry | undefined;
  try {
    agendaItem = observeScheduledJobForAgenda(job, {
      kind: 'routine',
      now: triggeredAt,
      reason: `Scheduled job is due: ${getActionSummary(job.action)}.`,
    });
    if (agendaItem) {
      const reserved = reserveBudgetForAgendaItem(agendaItem, {
        schedulerJobId: jobId,
        reason: `Scheduler budget gate for '${job.name || jobId}'`,
        blockedDecision: 'skipped',
      });
      budgetLedger = reserved.ledger;
      if (!reserved.decision.allowed) {
        job.lastRunAt = triggeredAt;
        job.lastRunResult = 'skipped';
        job.lastRunError = reserved.decision.reasons.join('; ') || 'Budget gate skipped scheduled job';
        saveJobs();
        if (state.initialized) {
          scheduleNextTick();
        }
        return {
          jobId,
          status: 'skipped',
          triggeredAt,
          message: job.lastRunError,
        };
      }
    }

    let outcome: TriggerActionOutcome = {};
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
          triggerContext: {
            source: 'scheduler',
            schedulerJobId: jobId,
          },
        });
        outcome = {
          message: `projectId=${project.projectId}, runId=${dispatchResult.runId}`,
          runId: dispatchResult.runId,
        };
      } else {
        outcome = { message: `projectId=${project.projectId}` };
      }
    } else {
      outcome = await triggerAction(job.action, jobId);
    }
    if (budgetLedger?.decision === 'reserved' && outcome.runId) {
      budgetLedger = attachRunToBudgetReservation(budgetLedger, outcome.runId);
    } else if (budgetLedger?.decision === 'reserved') {
      releaseSchedulerBudgetReservation({
        ledger: budgetLedger,
        agendaItem,
        jobId,
        reason: 'scheduler action completed without creating a run',
      });
    }
    job.lastRunAt = triggeredAt;
    job.lastRunResult = 'success';
    job.lastRunError = undefined;
    if (job.type === 'once') {
      job.enabled = false;
    }
    saveJobs();
    if (state.initialized) {
      scheduleNextTick();
    }

	    try {
	      const { appendAuditEvent } = await import('./ops-audit');
	      appendAuditEvent({
        kind: 'scheduler:triggered',
        jobId,
        projectId: getScheduledJobProjectId(job, linkedProjectId),
	        message: `Job '${job.name}' triggered: ${outcome.message || 'ok'}`,
	        meta: { action: job.action.kind },
	      });
	    } catch { /* audit non-critical */ }

	    return { jobId, status: 'success', triggeredAt, message: outcome.message };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    releaseSchedulerBudgetReservation({
      ledger: budgetLedger,
      agendaItem,
      jobId,
      reason: message,
    });
    job.lastRunAt = triggeredAt;
    job.lastRunResult = 'failed';
    job.lastRunError = message;
    saveJobs();
    if (state.initialized) {
      scheduleNextTick();
    }

    try {
      appendAuditEvent({
        kind: 'scheduler:failed',
        jobId,
        projectId: getScheduledJobProjectId(job),
        message: `Job '${job.name}' failed: ${message}`,
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
    loadJobs(true);
    ensureBuiltInCompanyLoopJobs();
    const now = new Date();
    const dueJobs = Array.from(state.jobs.values()).filter(job => isScheduledJobDue(job, now));
    for (const job of dueJobs) {
      try {
        const result = await triggerScheduledJob(job.jobId);
        log.info({ jobId: job.jobId, action: getActionSummary(job.action), result }, 'Scheduled job executed');
      } catch (err: unknown) {
        log.error({ jobId: job.jobId, action: getActionSummary(job.action), err: err instanceof Error ? err.message : String(err) }, 'Scheduled job failed');
      }
    }

    if (shouldStartSchedulerCompanionServices(process.env)) {
      try {
        const { scanFanOutBranchHealth } = await import('./fan-out-controller');
        await scanFanOutBranchHealth();
      } catch {
        // Fan-out controller is optional in early phases.
      }
    }
  } finally {
    state.tickRunning = false;
  }
}

export function initializeScheduler(): void {
  if (state.initialized) return;
  loadJobs();
  ensureBuiltInCompanyLoopJobs();
  state.initialized = true;
  scheduleNextTick();
  log.info({ minIntervalMs: MIN_LOOP_INTERVAL_MS, maxIntervalMs: MAX_LOOP_INTERVAL_MS }, 'Scheduler initialized');
}

export function stopScheduler(): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = undefined;
  }
  state.initialized = false;
}

export function listScheduledJobs(): ScheduledJob[] {
  loadJobs(true);
  if (state.initialized) {
    ensureBuiltInCompanyLoopJobs();
  }
  return Array.from(state.jobs.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getScheduledJob(jobId: string): ScheduledJob | null {
  loadJobs(true);
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
  if (state.initialized) {
    scheduleNextTick();
  }
  try {
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
  appendCEOEvent({
    kind: 'scheduler',
    level: 'info',
    title: `定时任务已创建：${job.name}`,
    description: `Action=${job.action.kind}`,
    ...(job.departmentWorkspaceUri ? { workspaceUri: job.departmentWorkspaceUri } : {}),
    meta: {
      jobId: job.jobId,
      action: job.action.kind,
      type: job.type,
    },
  });
  return job;
}

export function updateScheduledJob(jobId: string, updates: Partial<Omit<ScheduledJob, 'jobId' | 'createdAt'>>): ScheduledJob | null {
  loadJobs(true);
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
  if (state.initialized) {
    scheduleNextTick();
  }
  try {
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
  loadJobs(true);
  const existing = state.jobs.get(jobId);
  const deleted = state.jobs.delete(jobId);
  if (deleted) {
    deleteScheduledJobRecord(jobId);
    if (state.initialized) {
      scheduleNextTick();
    }
    try {
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
    appendCEOEvent({
      kind: 'scheduler',
      level: 'warning',
      title: `定时任务已删除：${existing?.name || jobId}`,
      description: existing ? `Action=${existing.action.kind}` : undefined,
      ...(existing?.departmentWorkspaceUri ? { workspaceUri: existing.departmentWorkspaceUri } : {}),
      meta: { jobId },
    });
  }
  return deleted;
}

/**
 * Compute the next run time for a scheduled job.
 */
export function getNextRunAt(job: ScheduledJob): string | null {
  if (!job.enabled) return null;

  const now = new Date();
  if (isScheduledJobDue(job, now)) {
    return now.toISOString();
  }

  if (job.type === 'once') {
    if (!job.scheduledAt || job.lastRunAt) return null;
    return job.scheduledAt;
  }

  if (job.type === 'interval') {
    if (!job.intervalMs || job.intervalMs <= 0) return null;
    const base = job.lastRunAt ? new Date(job.lastRunAt) : now;
    return new Date(base.getTime() + job.intervalMs).toISOString();
  }

  if (job.type === 'cron' && job.cronExpression) {
    try {
      const interval = cronParser.parse(job.cronExpression, getCronParserOptions(job, now));
      return interval.next().toDate().toISOString();
    } catch {
      return null;
    }
  }

  return null;
}

export interface EnrichedScheduledJob extends ScheduledJob {
  nextRunAt: string | null;
  executionProfile?: ReturnType<typeof deriveExecutionProfileFromScheduledAction>;
  executionProfileSummary?: ReturnType<typeof summarizeExecutionProfile>;
}

/**
 * List all scheduled jobs with enriched fields (nextRunAt).
 */
export function listScheduledJobsEnriched(): EnrichedScheduledJob[] {
  return listScheduledJobs().map(job => ({
    ...job,
    nextRunAt: getNextRunAt(job),
    executionProfile: deriveExecutionProfileFromScheduledAction(job.action),
    executionProfileSummary: (() => {
      const profile = deriveExecutionProfileFromScheduledAction(job.action);
      return profile ? summarizeExecutionProfile(profile) : undefined;
    })(),
  }));
}
