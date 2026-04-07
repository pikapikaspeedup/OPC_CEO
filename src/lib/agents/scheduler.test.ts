import { describe, expect, it } from 'vitest';
import { createScheduledJob, deleteScheduledJob, isScheduledJobDue, normalizeScheduledJobDefinition, updateScheduledJob } from './scheduler';
import type { ScheduledJob } from './scheduler-types';

function makeJob(overrides: Partial<ScheduledJob>): ScheduledJob {
  return {
    jobId: 'job-1',
    name: 'test',
    type: 'interval',
    intervalMs: 60_000,
    action: { kind: 'health-check', projectId: 'project-1' },
    enabled: true,
    createdAt: '2026-03-27T08:00:00.000Z',
    ...overrides,
  };
}

describe('isScheduledJobDue', () => {
  it('fires interval jobs when no lastRunAt exists', () => {
    const job = makeJob({});
    expect(isScheduledJobDue(job, new Date('2026-03-27T09:00:00.000Z'))).toBe(true);
  });

  it('does not fire disabled jobs', () => {
    const job = makeJob({ enabled: false });
    expect(isScheduledJobDue(job, new Date('2026-03-27T09:00:00.000Z'))).toBe(false);
  });

  it('fires once jobs only once', () => {
    const job = makeJob({
      type: 'once',
      intervalMs: undefined,
      scheduledAt: '2026-03-27T08:00:00.000Z',
    });

    expect(isScheduledJobDue(job, new Date('2026-03-27T08:01:00.000Z'))).toBe(true);
    expect(isScheduledJobDue({ ...job, lastRunAt: '2026-03-27T08:02:00.000Z' }, new Date('2026-03-27T08:03:00.000Z'))).toBe(false);
  });

  it('normalizes create-project jobs to file URIs', () => {
    const normalized = normalizeScheduledJobDefinition(makeJob({
      type: 'cron',
      cronExpression: '0 9 * * 1-5',
      action: { kind: 'create-project' },
      departmentWorkspaceUri: '/Users/darrel/Documents/backend',
      opcAction: {
        type: 'create_project',
        projectType: 'adhoc',
        goal: '生成日报',
      },
    }));

    expect(normalized.departmentWorkspaceUri).toBe('file:///Users/darrel/Documents/backend');
    expect(normalized.action.kind).toBe('create-project');
  });

  it('clears create-project metadata when updated to health-check', () => {
    const created = createScheduledJob({
      ...makeJob({
        type: 'cron',
        cronExpression: '0 9 * * 1-5',
        action: { kind: 'create-project' },
        departmentWorkspaceUri: 'file:///Users/darrel/Documents/backend',
        opcAction: {
          type: 'create_project',
          projectType: 'adhoc',
          goal: '生成日报',
        },
      }),
    });

    const updated = updateScheduledJob(created.jobId, {
      action: { kind: 'health-check', projectId: 'project-2' },
    });

    expect(updated?.action.kind).toBe('health-check');
    expect(updated?.departmentWorkspaceUri).toBeUndefined();
    expect(updated?.opcAction).toBeUndefined();

    deleteScheduledJob(created.jobId);
  });

  it('resets once execution state when rescheduled and re-enabled', () => {
    const created = createScheduledJob({
      ...makeJob({
        type: 'once',
        intervalMs: undefined,
        scheduledAt: '2026-03-27T08:00:00.000Z',
        lastRunAt: '2026-03-27T08:01:00.000Z',
        lastRunResult: 'success',
        enabled: false,
      }),
    });

    const updated = updateScheduledJob(created.jobId, {
      scheduledAt: '2026-03-28T08:00:00.000Z',
      enabled: true,
    });

    expect(updated?.lastRunAt).toBeUndefined();
    expect(updated?.lastRunResult).toBeUndefined();
    expect(updated?.enabled).toBe(true);

    deleteScheduledJob(created.jobId);
  });
});
