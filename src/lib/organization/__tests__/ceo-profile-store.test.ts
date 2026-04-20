import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadStore() {
  vi.resetModules();
  return import('../ceo-profile-store');
}

describe('ceo-profile-store', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ceo-profile-store-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.HOME = tempHome;
    process.env.AG_GATEWAY_HOME = path.join(tempHome, 'gateway-home');
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('creates a default CEO profile and persists updates', async () => {
    const store = await loadStore();
    const profile = store.getCEOProfile();
    expect(profile.id).toBe('default-ceo');

    store.updateCEOProfile({ priorities: ['knowledge loop'] });
    const updated = store.getCEOProfile();
    expect(updated.priorities).toEqual(['knowledge loop']);
  });

  it('appends decisions and feedback signals', async () => {
    const store = await loadStore();
    store.appendCEODecision({
      timestamp: '2026-04-19T00:00:00.000Z',
      summary: 'Created an ad-hoc project',
      source: 'ceo',
      command: '创建项目',
      action: 'create_project',
    });
    store.appendCEOFeedback({
      timestamp: '2026-04-19T01:00:00.000Z',
      type: 'preference',
      content: '以后结果优先简短汇报',
      source: 'user',
    });

    const profile = store.getCEOProfile();
    expect(profile.recentDecisions?.[0]?.action).toBe('create_project');
    expect(profile.feedbackSignals?.[0]?.content).toContain('简短汇报');
  });

  it('reconciles and removes pending issues', async () => {
    const store = await loadStore();
    store.appendCEOPendingIssue({
      id: 'approval:approval-1',
      title: '审批待处理：发布提案',
      level: 'warning',
      source: 'approval',
      createdAt: '2026-04-19T00:00:00.000Z',
    });
    store.appendCEOPendingIssue({
      id: 'project:project-1:stage-1:blocked',
      title: '项目 stage blocked',
      level: 'critical',
      source: 'project',
      projectId: 'project-1',
      createdAt: '2026-04-19T00:00:00.000Z',
    });

    store.removeCEOPendingIssue('approval:approval-1');
    store.reconcileCEOPendingIssues({
      pendingApprovalIds: new Set(),
      terminalProjectIds: new Set(['project-1']),
    });

    expect(store.getCEOProfile().pendingIssues).toEqual([]);
  });
});
