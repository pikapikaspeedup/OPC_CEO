import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/management', () => ({
  buildManagementOverview: vi.fn(() => ({
    generatedAt: '2026-04-19T00:00:00.000Z',
    activeProjects: 2,
    completedProjects: 1,
    failedProjects: 0,
    blockedProjects: 1,
    pendingApprovals: 1,
    activeSchedulers: 3,
    recentKnowledge: 4,
    metrics: [],
  })),
  buildDepartmentManagementOverview: vi.fn((workspaceUri: string) => ({
    workspaceUri,
    generatedAt: '2026-04-19T00:00:00.000Z',
    activeProjects: 1,
    completedProjects: 1,
    failedProjects: 0,
    blockedProjects: 0,
    pendingApprovals: 0,
    activeSchedulers: 1,
    recentKnowledge: 2,
    workflowHitRate: 0.5,
    throughput30d: 3,
    metrics: [],
  })),
}));

import { GET } from './route';

describe('/api/management/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns organization overview by default', async () => {
    const res = await GET(new Request('http://localhost/api/management/overview'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({
      activeProjects: 2,
      pendingApprovals: 1,
      recentKnowledge: 4,
    }));
  });

  it('returns department overview when workspace is provided', async () => {
    const res = await GET(new Request('http://localhost/api/management/overview?workspace=file%3A%2F%2F%2Ftmp%2Fworkspace'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({
      workspaceUri: 'file:///tmp/workspace',
      workflowHitRate: 0.5,
      throughput30d: 3,
    }));
  });
});
