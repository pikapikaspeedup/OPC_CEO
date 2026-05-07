import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { mockApproveSystemImprovementProposal, mockRejectSystemImprovementProposal } = vi.hoisted(() => ({
  mockApproveSystemImprovementProposal: vi.fn(),
  mockRejectSystemImprovementProposal: vi.fn(),
}));

vi.mock('../../company-kernel/self-improvement-approval', () => ({
  approveSystemImprovementProposal: (...args: unknown[]) => mockApproveSystemImprovementProposal(...args),
  rejectSystemImprovementProposal: (...args: unknown[]) => mockRejectSystemImprovementProposal(...args),
}));

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
    mockApproveSystemImprovementProposal.mockReset();
    mockRejectSystemImprovementProposal.mockReset();
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
      target: { kind: 'knowledge', knowledgeId: 'proposal-approval-1' },
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
  }, 20000);

  it('dispatches system improvement execution asynchronously after approval', async () => {
    const { handler } = await loadModules();
    mockApproveSystemImprovementProposal.mockResolvedValue({
      proposal: { id: 'proposal-approval-2' },
      launch: {
        status: 'dispatched',
        createdProject: false,
        templateId: 'development-template-1',
        workspaceUri: 'file:///tmp/platform-engineering',
      },
    });

    const request = await handler.submitApprovalRequest({
      type: 'other',
      target: { kind: 'system-improvement-proposal', proposalId: 'proposal-approval-2' },
      workspace: 'organization',
      title: '系统改进审批',
      description: 'approve execution',
      onApproved: {
        type: 'custom',
        payload: {
          action: 'approve-system-improvement-proposal',
          proposalId: 'proposal-approval-2',
        },
      },
    });

    const updated = await handler.handleApprovalResponse(request.id, 'approved', 'ship it');
    expect(updated?.status).toBe('approved');
    expect(mockApproveSystemImprovementProposal).toHaveBeenCalledWith('proposal-approval-2', {
      launchExecution: true,
      waitForExecution: false,
    });
  }, 20_000);

  it('persists rejected responses even if the system improvement callback target is already gone', async () => {
    const { handler } = await loadModules();
    mockRejectSystemImprovementProposal.mockImplementation(() => {
      throw new Error('System improvement proposal not found: missing-proposal');
    });

    const request = await handler.submitApprovalRequest({
      type: 'other',
      target: { kind: 'system-improvement-proposal', proposalId: 'missing-proposal' },
      workspace: 'organization',
      title: '系统改进审批',
      description: 'reject execution',
      onRejected: {
        type: 'custom',
        payload: {
          action: 'reject-system-improvement-proposal',
          proposalId: 'missing-proposal',
        },
      },
    });

    const updated = await handler.handleApprovalResponse(request.id, 'rejected', 'cleanup');
    expect(updated?.status).toBe('rejected');
    expect(updated?.response?.message).toBe('cleanup');
  }, 20_000);
});
