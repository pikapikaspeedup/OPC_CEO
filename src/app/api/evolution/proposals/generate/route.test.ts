import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/evolution', () => ({
  generateEvolutionProposals: vi.fn(() => ([
    {
      id: 'proposal-generated-1',
      kind: 'workflow',
      status: 'draft',
      title: 'Generated Proposal',
      targetName: 'generated-proposal',
      targetRef: '/generated-proposal',
      rationale: 'Repeated work detected.',
      content: '# Generated Proposal',
      sourceKnowledgeIds: [],
      evidence: [],
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
    },
  ])),
}));

import { POST } from './route';

describe('/api/evolution/proposals/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates proposals from request body filters', async () => {
    const res = await POST(new Request('http://localhost/api/evolution/proposals/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceUri: 'file:///tmp/research', limit: 3 }),
    }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      proposals: [expect.objectContaining({ id: 'proposal-generated-1' })],
    });
  });
});
