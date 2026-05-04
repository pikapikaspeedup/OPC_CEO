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
  const route = await import('./route');
  const knowledge = await import('@/lib/knowledge');
  return { route, knowledge };
}

describe('/api/knowledge/[id]', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'api-knowledge-id-'));
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

  it('returns details for a structured knowledge asset', async () => {
    const { route, knowledge } = await loadModules();
    knowledge.upsertKnowledgeAsset({
      id: 'knowledge-detail',
      scope: 'department',
      workspaceUri: 'file:///tmp/workspace',
      category: 'decision',
      title: 'Keep route handlers thin',
      content: 'Move heavy logic into src/lib modules.',
      source: { type: 'run', runId: 'run-detail' },
      tags: ['thin', 'route'],
      confidence: 0.88,
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      lastAccessedAt: '2026-04-19T03:00:00.000Z',
      usageCount: 2,
      status: 'active',
    });

    const res = await route.GET(new Request('http://localhost/api/knowledge/knowledge-detail'), {
      params: Promise.resolve({ id: 'knowledge-detail' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual(expect.objectContaining({
      id: 'knowledge-detail',
      title: 'Keep route handlers thin',
      usageCount: 2,
      lastAccessedAt: '2026-04-19T03:00:00.000Z',
      tags: ['thin', 'route'],
      sourceType: 'run',
      sourceRunId: 'run-detail',
      confidence: 0.88,
      artifacts: {
        'content.md': 'Move heavy logic into src/lib modules.',
      },
    }));
  });

  it('updates metadata and deletes a structured knowledge asset', async () => {
    const { route, knowledge } = await loadModules();
    knowledge.upsertKnowledgeAsset({
      id: 'knowledge-edit',
      scope: 'department',
      workspaceUri: 'file:///tmp/workspace',
      category: 'pattern',
      title: 'Old title',
      content: 'Original content',
      source: { type: 'run', runId: 'run-edit' },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      status: 'active',
    });

    const updateRes = await route.PUT(new Request('http://localhost/api/knowledge/knowledge-edit', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New title', summary: 'Updated summary' }),
    }), {
      params: Promise.resolve({ id: 'knowledge-edit' }),
    });
    expect(updateRes.status).toBe(200);

    const updated = knowledge.getKnowledgeAsset('knowledge-edit');
    expect(updated?.title).toBe('New title');

    const deleteRes = await route.DELETE(new Request('http://localhost/api/knowledge/knowledge-edit', {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ id: 'knowledge-edit' }),
    });
    expect(deleteRes.status).toBe(200);
    expect(knowledge.getKnowledgeAsset('knowledge-edit')).toBeNull();
  });
});
