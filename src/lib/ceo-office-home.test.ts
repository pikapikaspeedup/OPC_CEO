import { describe, expect, it } from 'vitest';
import { dedupeAuditEvents, pickLatestDailyDigest } from './ceo-office-home';
import type { AuditEvent } from './api';
import type { DailyDigestFE } from './types';

function digest(overrides: Partial<DailyDigestFE>): DailyDigestFE {
  return {
    workspaceUri: 'file:///workspace',
    departmentName: 'Engineering',
    date: '2026-04-25',
    period: 'day',
    summary: '完成 1 项任务',
    tasksCompleted: [],
    tasksInProgress: [],
    blockers: [],
    ...overrides,
  };
}

describe('ceo-office-home', () => {
  it('selects the newest daily digest rather than the first fetched result', () => {
    const picked = pickLatestDailyDigest([
      digest({ workspaceUri: 'file:///old', departmentName: 'Old', date: '2026-04-24' }),
      digest({ workspaceUri: 'file:///new', departmentName: 'New', date: '2026-04-25' }),
    ]);

    expect(picked?.workspaceUri).toBe('file:///new');
  });

  it('uses activity count as a stable tie breaker for same-day digests', () => {
    const picked = pickLatestDailyDigest([
      digest({ workspaceUri: 'file:///quiet', departmentName: 'Quiet' }),
      digest({
        workspaceUri: 'file:///busy',
        departmentName: 'Busy',
        tasksCompleted: [{ projectId: 'p1', projectName: 'Ship', description: 'Released' }],
      }),
    ]);

    expect(picked?.workspaceUri).toBe('file:///busy');
  });

  it('deduplicates repeated audit events and caps repeated signal kinds before rendering', () => {
    const events: AuditEvent[] = [
      { timestamp: '2026-04-25T10:00:00.000Z', kind: 'stage:completed', message: 'Stage completed' },
      { timestamp: '2026-04-25T10:00:01.000Z', kind: 'stage:completed', message: 'Stage completed' },
      { timestamp: '2026-04-25T10:00:02.000Z', kind: 'stage:completed', message: 'Project completed' },
      { timestamp: '2026-04-25T10:00:02.000Z', kind: 'job:failed', message: 'Digest failed' },
    ];

    expect(dedupeAuditEvents(events, 4).map(event => event.message)).toEqual([
      'Stage completed',
      'Digest failed',
    ]);
  });
});
