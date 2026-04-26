import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../approval/request-store', () => ({
  listApprovalRequests: vi.fn(),
}));
vi.mock('../agents/project-registry', () => ({
  listProjects: vi.fn(),
}));
vi.mock('../agents/scheduler', () => ({
  listScheduledJobsEnriched: vi.fn(),
  getSchedulerRuntimeStatus: vi.fn(),
}));
vi.mock('../knowledge', () => ({
  listRecentKnowledgeAssets: vi.fn(),
}));
vi.mock('./ceo-event-store', () => ({
  listCEOEvents: vi.fn(),
}));
vi.mock('./ceo-profile-store', () => ({
  reconcileCEOPendingIssues: vi.fn(),
}));

import { listApprovalRequests } from '../approval/request-store';
import { listProjects } from '../agents/project-registry';
import { getSchedulerRuntimeStatus, listScheduledJobsEnriched } from '../agents/scheduler';
import { listRecentKnowledgeAssets } from '../knowledge';
import { listCEOEvents } from './ceo-event-store';
import { reconcileCEOPendingIssues } from './ceo-profile-store';
import { buildCEORoutineSummary } from './ceo-routine';

describe('buildCEORoutineSummary', () => {
  beforeEach(() => {
    vi.mocked(listApprovalRequests).mockReturnValue([]);
    vi.mocked(listProjects).mockReturnValue([]);
    vi.mocked(listScheduledJobsEnriched).mockReturnValue([]);
    vi.mocked(getSchedulerRuntimeStatus).mockReturnValue({
      status: 'idle',
      loopActive: true,
      configuredToStart: true,
      companionServicesEnabled: false,
      role: 'api',
      enabledJobCount: 0,
      dueNowCount: 0,
      nextRunAt: null,
      checkedAt: '2026-04-25T00:00:00.000Z',
      message: 'Scheduler loop is available and no enabled jobs are pending.',
    });
    vi.mocked(listRecentKnowledgeAssets).mockReturnValue([]);
    vi.mocked(listCEOEvents).mockReturnValue([]);
    vi.mocked(reconcileCEOPendingIssues).mockReturnValue({
      id: 'default-ceo',
      identity: { name: 'CEO', role: 'ceo' },
      priorities: [],
      activeFocus: [],
      pendingIssues: [],
      updatedAt: '2026-04-25T00:00:00.000Z',
    });
  });

  it('returns structured routine actions with executable targets', () => {
    vi.mocked(listApprovalRequests).mockReturnValue([
      {
        id: 'approval-1',
        type: 'pipeline_approval',
        workspace: 'file:///workspace/a',
        title: '上线审批',
        description: 'approve release',
        urgency: 'critical',
        status: 'pending',
        createdAt: '2026-04-25T00:00:00.000Z',
        updatedAt: '2026-04-25T00:00:00.000Z',
      },
    ]);
    vi.mocked(listProjects).mockReturnValue([
      {
        projectId: 'project-1',
        name: '支付链路修复',
        goal: 'fix payment',
        status: 'failed',
        createdAt: '2026-04-25T00:00:00.000Z',
        updatedAt: '2026-04-25T01:00:00.000Z',
        workspace: 'file:///workspace/a',
        runIds: [],
      },
    ]);
    vi.mocked(listScheduledJobsEnriched).mockReturnValue([
      {
        jobId: 'job-1',
        name: 'AI 日报',
        type: 'cron',
        cronExpression: '0 20 * * *',
        timeZone: 'Asia/Shanghai',
        action: {
          kind: 'dispatch-prompt',
          workspace: 'file:///workspace/a',
          prompt: '生成日报',
        },
        enabled: true,
        createdAt: '2026-04-25T00:00:00.000Z',
        nextRunAt: '2026-04-25T12:00:00.000Z',
      },
    ]);
    vi.mocked(getSchedulerRuntimeStatus).mockReturnValue({
      status: 'disabled',
      loopActive: false,
      configuredToStart: false,
      companionServicesEnabled: false,
      role: 'api',
      enabledJobCount: 1,
      dueNowCount: 0,
      nextRunAt: '2026-04-25T12:00:00.000Z',
      checkedAt: '2026-04-25T00:00:00.000Z',
      message: 'Scheduler is disabled by current process configuration.',
    });
    vi.mocked(listRecentKnowledgeAssets).mockReturnValue([
      {
        id: 'knowledge-1',
        scope: 'department',
        workspaceUri: 'file:///workspace/a',
        category: 'lesson',
        title: '上线复盘',
        content: 'lesson',
        source: { type: 'run', runId: 'run-1' },
        createdAt: '2026-04-25T00:00:00.000Z',
        updatedAt: '2026-04-25T00:00:00.000Z',
      },
    ]);

    const summary = buildCEORoutineSummary();

    expect(summary.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'approval-inbox',
        status: 'attention',
        target: expect.objectContaining({ kind: 'approvals', requestId: 'approval-1' }),
      }),
      expect.objectContaining({
        id: 'project-project-1',
        status: 'attention',
        target: expect.objectContaining({ kind: 'project', projectId: 'project-1' }),
      }),
      expect.objectContaining({
        id: 'scheduler-job-1',
        status: 'attention',
        target: expect.objectContaining({ kind: 'scheduler', jobId: 'job-1' }),
      }),
      expect.objectContaining({
        id: 'knowledge-knowledge-1',
        target: expect.objectContaining({ kind: 'knowledge', knowledgeId: 'knowledge-1' }),
      }),
    ]));
  });
});
