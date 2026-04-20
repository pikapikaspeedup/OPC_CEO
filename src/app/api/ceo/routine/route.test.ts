import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/organization', () => ({
  buildCEORoutineSummary: vi.fn(() => ({
    generatedAt: '2026-04-19T00:00:00.000Z',
    overview: '当前有 2 个进行中的项目。',
    activeProjects: 2,
    pendingApprovals: 1,
    activeSchedulers: 3,
    recentKnowledge: 4,
    highlights: ['当前有 2 个进行中的项目。'],
    actions: [{ label: '处理待审批事项', type: 'approval' }],
  })),
}));

import { GET } from './route';

describe('/api/ceo/routine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the CEO routine summary', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({
      activeProjects: 2,
      pendingApprovals: 1,
      recentKnowledge: 4,
    }));
  });
});
