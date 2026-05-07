import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    route: await import('./route'),
    approvalStore: await import('../../../../../lib/approval/request-store'),
    selfImprovementStore: await import('../../../../../lib/company-kernel/self-improvement-store'),
  };
}

describe('GET /api/company/ceo/decisions', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ceo-decisions-route-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.HOME = tempHome;
    process.env.AG_GATEWAY_HOME = path.join(tempHome, 'gateway-home');
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
    vi.resetModules();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('returns unified decision item views', async () => {
    const { approvalStore, route, selfImprovementStore } = await loadModules();
    const request = approvalStore.createApprovalRequest({
      type: 'other',
      target: { kind: 'system-improvement-proposal', proposalId: 'proposal-route-1' },
      workspace: 'organization',
      title: '系统改进审批',
      description: 'Need approval',
      urgency: 'high',
    });
    selfImprovementStore.upsertSystemImprovementProposal({
      id: 'proposal-route-1',
      status: 'approval-required',
      humanGate: {
        state: 'entry-approval-required',
        title: '等待准入',
        summary: '等待 CEO',
        updatedAt: '2026-05-06T10:00:00.000Z',
      },
      title: '系统改进详情支持 URL 深链恢复',
      summary: 'Restore proposal detail from URL.',
      sourceSignalIds: ['signal-1'],
      evidenceRefs: [],
      affectedFiles: ['src/app/page.tsx'],
      protectedAreas: ['approval'],
      risk: 'high',
      implementationPlan: ['Implement'],
      testPlan: ['npx tsc --noEmit --pretty false'],
      rollbackPlan: ['revert patch'],
      approvalRequestId: request.id,
      linkedRunIds: [],
      testEvidence: [],
      createdAt: '2026-05-06T10:00:00.000Z',
      updatedAt: '2026-05-06T10:00:00.000Z',
    });

    const response = await route.GET(new Request('http://localhost/api/company/ceo/decisions?limit=5'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([
      expect.objectContaining({
        target: { kind: 'system-improvement-proposal', proposalId: 'proposal-route-1' },
        currentOwner: 'ceo',
        nextAction: 'approve-entry',
      }),
    ]);
  }, 20000);
});
