import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/evolution', () => ({
  listEvolutionProposals: vi.fn(() => ([
    {
      id: 'proposal-1',
      kind: 'workflow',
      status: 'published',
      title: 'Ops Digest',
      targetName: 'ops-digest',
      targetRef: '/ops-digest',
      rationale: 'Stabilize ops digests.',
      content: '# Ops Digest',
      sourceKnowledgeIds: [],
      evidence: [],
      publishedAt: '2026-04-19T00:00:00.000Z',
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
    },
  ])),
  buildEvolutionProposalRollout: vi.fn(() => ({
    observedAt: '2026-04-19T01:00:00.000Z',
    hitCount: 2,
    matchedRunIds: ['run-a', 'run-b'],
    successRate: 1,
    summary: '2 runs adopted this proposal after publish.',
  })),
}));

import { GET } from './route';

describe('/api/evolution/proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns proposal list with rollout observation by default', async () => {
    const res = await GET(new Request('http://localhost/api/evolution/proposals'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      proposals: [
        expect.objectContaining({
          id: 'proposal-1',
          rollout: expect.objectContaining({ hitCount: 2 }),
        }),
      ],
    });
  });
});
