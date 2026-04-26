import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./dispatch-service', () => ({
  executeDispatch: vi.fn(async () => ({ runId: 'dispatch-run' })),
}));
vi.mock('./prompt-executor', () => ({
  executePrompt: vi.fn(async () => ({ runId: 'prompt-run' })),
}));

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;
let previousRole: string | undefined;
let previousScheduler: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  delete (globalThis as Record<string, unknown>).__AG_SCHEDULER_STATE__;
  return {
    scheduler: await import('./scheduler'),
    dispatch: await import('./dispatch-service'),
    prompt: await import('./prompt-executor'),
    loopPolicy: await import('../company-kernel/company-loop-policy'),
    loopRunStore: await import('../company-kernel/company-loop-run-store'),
  };
}

describe('scheduler company loop integration', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-company-loop-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    previousRole = process.env.AG_ROLE;
    previousScheduler = process.env.AG_ENABLE_SCHEDULER;
    process.env.HOME = tempHome;
    process.env.AG_GATEWAY_HOME = path.join(tempHome, 'gateway-home');
    process.env.AG_ROLE = 'api';
    process.env.AG_ENABLE_SCHEDULER = '1';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
    delete (globalThis as Record<string, unknown>).__AG_SCHEDULER_STATE__;
    vi.restoreAllMocks();
    vi.resetModules();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    if (previousRole === undefined) delete process.env.AG_ROLE;
    else process.env.AG_ROLE = previousRole;
    if (previousScheduler === undefined) delete process.env.AG_ENABLE_SCHEDULER;
    else process.env.AG_ENABLE_SCHEDULER = previousScheduler;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('normalizes and triggers company-loop jobs without dispatch worker calls', async () => {
    const modules = await loadModules();
    const job = modules.scheduler.createScheduledJob({
      name: 'Daily loop',
      type: 'cron',
      cronExpression: '5 20 * * *',
      timeZone: 'Asia/Shanghai',
      action: { kind: 'company-loop', loopKind: 'daily-review' },
      enabled: true,
      createdBy: 'api',
    });

    const result = await modules.scheduler.triggerScheduledJob(job.jobId);

    expect(result.status).toBe('success');
    expect(result.message).toContain('loopRunId=');
    expect(modules.loopRunStore.countCompanyLoopRuns()).toBe(1);
    expect(modules.dispatch.executeDispatch).not.toHaveBeenCalled();
    expect(modules.prompt.executePrompt).not.toHaveBeenCalled();
    modules.scheduler.stopScheduler();
  });

  it('installs built-in daily and weekly loop jobs only when scheduler initializes', async () => {
    const modules = await loadModules();

    expect(modules.scheduler.listScheduledJobs().filter((job) => job.action.kind === 'company-loop')).toHaveLength(0);
    modules.scheduler.initializeScheduler();

    const loopJobs = modules.scheduler.listScheduledJobs().filter((job) => job.action.kind === 'company-loop');
    expect(loopJobs.map((job) => job.jobId).sort()).toEqual([
      'builtin-company-daily-loop',
      'builtin-company-weekly-review',
    ]);
    expect(loopJobs.every((job) => job.type === 'cron')).toBe(true);
    modules.scheduler.stopScheduler();
  });

  it('derives built-in loop cadence from the organization loop policy', async () => {
    const modules = await loadModules();
    const policy = modules.loopPolicy.upsertCompanyLoopPolicy({
      ...modules.loopPolicy.buildDefaultCompanyLoopPolicy(),
      enabled: false,
      timezone: 'Europe/Rome',
      dailyReviewHour: 21,
      weeklyReviewDay: 2,
      weeklyReviewHour: 9,
    });

    modules.scheduler.initializeScheduler();

    const loopJobs = modules.scheduler.listScheduledJobs().filter((job) => job.action.kind === 'company-loop');
    const daily = loopJobs.find((job) => job.jobId === 'builtin-company-daily-loop');
    const weekly = loopJobs.find((job) => job.jobId === 'builtin-company-weekly-review');
    expect(daily?.cronExpression).toBe('5 21 * * *');
    expect(daily?.timeZone).toBe('Europe/Rome');
    expect(daily?.enabled).toBe(false);
    expect(daily?.action).toEqual({ kind: 'company-loop', loopKind: 'daily-review', policyId: policy.id });
    expect(weekly?.cronExpression).toBe('30 9 * * 2');
    expect(weekly?.timeZone).toBe('Europe/Rome');
    expect(weekly?.enabled).toBe(false);
    expect(weekly?.action).toEqual({ kind: 'company-loop', loopKind: 'weekly-review', policyId: policy.id });
    modules.scheduler.stopScheduler();
  });
});
