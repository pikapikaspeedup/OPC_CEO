import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/evolution', () => ({
  getEvolutionProposal: vi.fn(() => ({
    id: 'proposal-1',
    kind: 'workflow',
    status: 'evaluated',
    workspaceUri: 'file:///tmp/research',
    title: 'Ops Digest',
    targetName: 'ops-digest',
    targetRef: '/ops-digest',
    rationale: 'Stabilize ops digests.',
    content: '# Ops Digest',
    sourceKnowledgeIds: [],
    evidence: [],
    evaluation: {
      evaluatedAt: '2026-04-19T00:00:00.000Z',
      sampleSize: 3,
      matchedRunIds: ['run-a', 'run-b', 'run-c'],
      successRate: 1,
      blockedRate: 0,
      recommendation: 'publish',
      summary: 'Strong candidate.',
    },
    createdAt: '2026-04-19T00:00:00.000Z',
    updatedAt: '2026-04-19T00:00:00.000Z',
  })),
  patchEvolutionProposal: vi.fn(() => ({
    id: 'proposal-1',
    status: 'pending-approval',
    approvalRequestId: 'approval-1',
  })),
}));

vi.mock('@/lib/approval/handler', () => ({
  submitApprovalRequest: vi.fn(async () => ({ id: 'approval-1' })),
}));

import { POST } from './route';

describe('/api/evolution/proposals/[id]/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an approval request before publish', async () => {
    const res = await POST(
      new Request('http://localhost/api/evolution/proposals/proposal-1/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'ready for governance' }),
      }),
      { params: Promise.resolve({ id: 'proposal-1' }) },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      proposal: expect.objectContaining({
        id: 'proposal-1',
        status: 'pending-approval',
      }),
      approvalRequestId: 'approval-1',
    });
  });
});
