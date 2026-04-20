import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadRouteAndStore() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  const route = await import('./route');
  const store = await import('@/lib/knowledge');
  return { GET: route.GET, store };
}

describe('GET /api/knowledge', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'api-knowledge-route-'));
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

  it('lists mirrored knowledge items from structured assets', async () => {
    const { GET, store } = await loadRouteAndStore();
    store.upsertKnowledgeAsset({
      id: 'knowledge-1',
      scope: 'department',
      workspaceUri: 'file:///tmp/workspace-a',
      category: 'decision',
      title: 'Use SQLite knowledge store',
      content: 'Structured knowledge is persisted in SQLite and mirrored to filesystem.',
      source: { type: 'run', runId: 'run-1' },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      lastAccessedAt: '2026-04-19T02:00:00.000Z',
      usageCount: 3,
      status: 'active',
    });

    const res = await GET(new Request('http://localhost/api/knowledge'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([
      expect.objectContaining({
        id: 'knowledge-1',
        title: 'Use SQLite knowledge store',
        category: 'decision',
        workspaceUri: 'file:///tmp/workspace-a',
        usageCount: 3,
        lastAccessedAt: '2026-04-19T02:00:00.000Z',
      }),
    ]);
  });

  it('supports workspace/category/limit filtering', async () => {
    const { GET, store } = await loadRouteAndStore();
    store.upsertKnowledgeAsset({
      id: 'knowledge-a',
      scope: 'department',
      workspaceUri: 'file:///tmp/workspace-a',
      category: 'decision',
      title: 'A',
      content: 'Content A',
      source: { type: 'run', runId: 'run-a' },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      status: 'active',
    });
    store.upsertKnowledgeAsset({
      id: 'knowledge-b',
      scope: 'department',
      workspaceUri: 'file:///tmp/workspace-b',
      category: 'pattern',
      title: 'B',
      content: 'Content B',
      source: { type: 'run', runId: 'run-b' },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T01:00:00.000Z',
      status: 'active',
    });

    const res = await GET(new Request('http://localhost/api/knowledge?workspace=file%3A%2F%2F%2Ftmp%2Fworkspace-b&category=pattern&limit=1'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([
      expect.objectContaining({
        id: 'knowledge-b',
        workspaceUri: 'file:///tmp/workspace-b',
        category: 'pattern',
      }),
    ]);
  });
});
