import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./dispatch-service', () => ({
  executeDispatch: vi.fn(async () => ({ runId: 'run-1' })),
}));
vi.mock('./prompt-executor', () => ({
  executePrompt: vi.fn(async () => ({ runId: 'prompt-run-1' })),
}));
import { executeDispatch } from './dispatch-service';
import { executePrompt } from './prompt-executor';
import { deleteProject } from './project-registry';
import { createScheduledJob, deleteScheduledJob, getSchedulerLoopDelay, isScheduledJobDue, normalizeScheduledJobDefinition, triggerScheduledJob, updateScheduledJob } from './scheduler';
import type { ScheduledJob } from './scheduler-types';

beforeEach(() => {
  vi.mocked(executeDispatch).mockClear();
  vi.mocked(executeDispatch).mockResolvedValue({ runId: 'run-1' });
  vi.mocked(executePrompt).mockClear();
  vi.mocked(executePrompt).mockResolvedValue({ runId: 'prompt-run-1' });
});

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

  it('computes second-level wake delay for short interval jobs', () => {
    const job = makeJob({
      intervalMs: 5_000,
      lastRunAt: '2026-03-27T08:00:00.000Z',
    });

    expect(getSchedulerLoopDelay(new Date('2026-03-27T08:00:02.000Z'), [job])).toBe(3_000);
  });

  it('clamps overdue jobs to the minimum one-second wake delay', () => {
    const job = makeJob({
      intervalMs: 5_000,
      lastRunAt: '2026-03-27T08:00:00.000Z',
    });

    expect(getSchedulerLoopDelay(new Date('2026-03-27T08:00:05.100Z'), [job])).toBe(1_000);
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

  it('auto-dispatches create-project jobs when opcAction.templateId exists', async () => {
    const created = createScheduledJob({
      ...makeJob({
        type: 'cron',
        cronExpression: '0 9 * * 1-5',
        action: { kind: 'create-project' },
        departmentWorkspaceUri: 'file:///Users/darrel/Documents/backend',
        opcAction: {
          type: 'create_project',
          projectType: 'adhoc',
          goal: '修复登录接口',
          templateId: 'coding-basic-template',
        },
      }),
    });

    const result = await triggerScheduledJob(created.jobId);
    const projectId = result.message?.match(/projectId=([^,]+)/)?.[1];

    expect(result.status).toBe('success');
    expect(result.message).toContain('runId=run-1');
    expect(vi.mocked(executeDispatch)).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'coding-basic-template',
      prompt: '修复登录接口',
      triggerContext: {
        source: 'scheduler',
        schedulerJobId: created.jobId,
      },
    }));

    if (projectId) deleteProject(projectId);
    deleteScheduledJob(created.jobId);
  });

  it('keeps create-project jobs as project-only when no templateId exists', async () => {
    const created = createScheduledJob({
      ...makeJob({
        type: 'cron',
        cronExpression: '0 9 * * 1-5',
        action: { kind: 'create-project' },
        departmentWorkspaceUri: 'file:///Users/darrel/Documents/backend',
        opcAction: {
          type: 'create_project',
          projectType: 'adhoc',
          goal: '整理 backlog',
        },
      }),
    });

    const result = await triggerScheduledJob(created.jobId);
    const projectId = result.message?.match(/projectId=([^,]+)/)?.[1];

    expect(result.status).toBe('success');
    expect(result.message).toContain('projectId=');
    expect(result.message).not.toContain('runId=');
    expect(vi.mocked(executeDispatch)).not.toHaveBeenCalled();

    if (projectId) deleteProject(projectId);
    deleteScheduledJob(created.jobId);
  });

  it('triggers dispatch-prompt jobs via PromptExecutor', async () => {
    const created = createScheduledJob({
      ...makeJob({
        type: 'cron',
        cronExpression: '0 9 * * 1-5',
        action: {
          kind: 'dispatch-prompt',
          workspace: 'file:///Users/darrel/Documents/ai-news',
          prompt: '整理今天 AI 资讯重点信号',
          promptAssetRefs: ['daily-digest-playbook'],
          skillHints: ['research'],
        },
      }),
    });

    const result = await triggerScheduledJob(created.jobId);

    expect(result.status).toBe('success');
    expect(result.message).toContain('runId=prompt-run-1');
    expect(vi.mocked(executePrompt)).toHaveBeenCalledWith(expect.objectContaining({
      workspace: 'file:///Users/darrel/Documents/ai-news',
      prompt: '整理今天 AI 资讯重点信号',
      triggerContext: {
        source: 'scheduler',
        schedulerJobId: created.jobId,
      },
      executionTarget: expect.objectContaining({
        kind: 'prompt',
        promptAssetRefs: ['daily-digest-playbook'],
        skillHints: ['research'],
      }),
    }));
    expect(vi.mocked(executeDispatch)).not.toHaveBeenCalled();

    deleteScheduledJob(created.jobId);
  });

  it('triggers workflow-run execution profiles via PromptExecutor', async () => {
    const created = createScheduledJob({
      ...makeJob({
        type: 'cron',
        cronExpression: '0 9 * * 1-5',
        action: {
          kind: 'dispatch-execution-profile',
          workspace: 'file:///Users/darrel/Documents/ai-news',
          prompt: '整理今天 AI 资讯重点信号',
          executionProfile: {
            kind: 'workflow-run',
            workflowRef: '/ai_digest',
            skillHints: ['research'],
          },
        },
      }),
    });

    const result = await triggerScheduledJob(created.jobId);

    expect(result.status).toBe('success');
    expect(result.message).toContain('runId=prompt-run-1');
    expect(vi.mocked(executePrompt)).toHaveBeenCalledWith(expect.objectContaining({
      workspace: 'file:///Users/darrel/Documents/ai-news',
      prompt: '整理今天 AI 资讯重点信号',
      executionTarget: {
        kind: 'prompt',
        promptAssetRefs: ['/ai_digest'],
        skillHints: ['research'],
      },
    }));

    deleteScheduledJob(created.jobId);
  });

  it('triggers dag-orchestration execution profiles via DispatchService', async () => {
    const created = createScheduledJob({
      ...makeJob({
        type: 'cron',
        cronExpression: '0 9 * * 1-5',
        action: {
          kind: 'dispatch-execution-profile',
          workspace: 'file:///Users/darrel/Documents/backend',
          prompt: '修复登录接口',
          executionProfile: {
            kind: 'dag-orchestration',
            templateId: 'coding-basic-template',
            stageId: 'implement',
          },
        },
      }),
    });

    const result = await triggerScheduledJob(created.jobId);

    expect(result.status).toBe('success');
    expect(result.message).toContain('runId=run-1');
    expect(vi.mocked(executeDispatch)).toHaveBeenCalledWith(expect.objectContaining({
      workspace: 'file:///Users/darrel/Documents/backend',
      templateId: 'coding-basic-template',
      stageId: 'implement',
      prompt: '修复登录接口',
    }));

    deleteScheduledJob(created.jobId);
  });
});
