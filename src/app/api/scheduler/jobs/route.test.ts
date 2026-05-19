import { afterEach, describe, expect, it } from 'vitest';

import { deleteScheduledJob, listScheduledJobs } from '@/lib/agents/scheduler';
import { POST } from './route';

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/scheduler/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/scheduler/jobs', () => {
  afterEach(() => {
    for (const job of listScheduledJobs()) {
      deleteScheduledJob(job.jobId, { allowBuiltIn: true });
    }
  });

  it('preserves CEO workflow provenance for scheduler jobs', async () => {
    const res = await POST(makeRequest({
      name: 'CEO workflow daily report',
      type: 'cron',
      cronExpression: '0 9 * * 1-5',
      createdBy: 'ceo-workflow',
      intentSummary: '每天工作日上午 9 点让市场部创建日报任务项目',
      action: { kind: 'create-project' },
      departmentWorkspaceUri: 'file:///tmp/marketing',
      opcAction: {
        type: 'create_project',
        projectType: 'adhoc',
        goal: '汇总当前进行中的项目与风险',
      },
    }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(expect.objectContaining({
      name: 'CEO workflow daily report',
      createdBy: 'ceo-workflow',
      intentSummary: '每天工作日上午 9 点让市场部创建日报任务项目',
      departmentWorkspaceUri: 'file:///tmp/marketing',
      opcAction: expect.objectContaining({
        projectType: 'adhoc',
        goal: '汇总当前进行中的项目与风险',
      }),
    }));
  });
});
