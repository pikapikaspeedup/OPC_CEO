import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/workspace-catalog', () => ({
  registerWorkspace: vi.fn(),
}));

import { registerWorkspace } from '@/lib/workspace-catalog';
import { POST } from './route';

describe('/api/workspaces/import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a workspace without launching Antigravity', async () => {
    vi.mocked(registerWorkspace).mockReturnValue({
      uri: 'file:///tmp/my-workspace',
      path: '/tmp/my-workspace',
      name: 'my-workspace',
      kind: 'folder',
      sourceKind: 'manual-import',
      status: 'active',
      createdAt: '2026-04-20T10:00:00.000Z',
      updatedAt: '2026-04-20T10:00:00.000Z',
    });

    const res = await POST(new Request('http://localhost/api/workspaces/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: '/tmp/my-workspace' }),
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      workspace: {
        name: 'my-workspace',
        uri: 'file:///tmp/my-workspace',
      },
    });
    expect(vi.mocked(registerWorkspace)).toHaveBeenCalledWith({
      workspace: '/tmp/my-workspace',
      sourceKind: 'manual-import',
    });
  });
});
