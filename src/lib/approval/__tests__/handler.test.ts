import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    store: await import('../../evolution/store'),
    handler: await import('../handler'),
    canonicalAssets: await import('../../agents/canonical-assets'),
  };
}

describe('approval handler callbacks', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-handler-'));
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

  it('publishes an evolution proposal after approval', async () => {
    const { store, handler, canonicalAssets } = await loadModules();

    store.upsertEvolutionProposal({
      id: 'proposal-approval-1',
      kind: 'workflow',
      status: 'pending-approval',
      workspaceUri: 'file:///tmp/research',
      title: 'Ops Digest',
      targetName: 'ops-digest',
      targetRef: '/ops-digest',
      rationale: 'Ops digest should be canonical.',
      content: '# Ops Digest',
      sourceKnowledgeIds: [],
      evidence: [],
      evaluation: {
        evaluatedAt: '2026-04-19T00:00:00.000Z',
        sampleSize: 3,
        matchedRunIds: ['a', 'b', 'c'],
        successRate: 1,
        blockedRate: 0,
        recommendation: 'publish',
        summary: 'Good candidate',
      },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
    });

    const request = await handler.submitApprovalRequest({
      type: 'proposal_publish',
      workspace: 'file:///tmp/research',
      title: '发布提案：Ops Digest',
      description: 'approve publish',
      onApproved: {
        type: 'custom',
        payload: {
          action: 'publish-evolution-proposal',
          proposalId: 'proposal-approval-1',
        },
      },
    });

    await handler.handleApprovalResponse(request.id, 'approved', 'ship it');
    expect(canonicalAssets.getCanonicalWorkflow('ops-digest')?.content).toContain('# Ops Digest');
    expect(store.getEvolutionProposal('proposal-approval-1')?.status).toBe('published');
  });
});
