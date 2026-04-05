import { describe, expect, it } from 'vitest';
import { isScheduledJobDue } from './scheduler';
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
});
