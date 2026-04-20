import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  return {
    requestStore: await import('../request-store'),
    ceoProfileStore: await import('../../organization/ceo-profile-store'),
  };
}

describe('approval request-store', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-request-store-'));
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

  it('reloads persisted requests and clears approval pending issues once resolved', async () => {
    const { requestStore, ceoProfileStore } = await loadModules();
    const request = requestStore.createApprovalRequest({
      type: 'proposal_publish',
      workspace: 'file:///tmp/research',
      title: '发布提案',
      description: '测试审批持久化',
    });

    expect(requestStore.listApprovalRequests()).toHaveLength(1);
    expect(ceoProfileStore.getCEOProfile().pendingIssues).toEqual([
      expect.objectContaining({ id: `approval:${request.id}` }),
    ]);

    const { requestStore: reloadedStore } = await loadModules();
    expect(reloadedStore.listApprovalRequests()).toEqual([
      expect.objectContaining({ id: request.id }),
    ]);

    reloadedStore.respondToRequest(request.id, {
      action: 'approved',
      message: 'ok',
      respondedAt: '2026-04-19T00:00:00.000Z',
      channel: 'web',
    });

    const { ceoProfileStore: finalProfileStore } = await loadModules();
    expect(finalProfileStore.getCEOProfile().pendingIssues).toEqual([]);
  });
});
