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

describe('/api/knowledge/[id]/artifacts/[...path]', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'api-knowledge-artifact-'));
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

  it('reads and updates mirrored artifact content', async () => {
    const { route, knowledge } = await loadModules();
    knowledge.upsertKnowledgeAsset({
      id: 'knowledge-artifact',
      scope: 'department',
      workspaceUri: 'file:///tmp/workspace',
      category: 'decision',
      title: 'Artifact title',
      content: 'Original artifact content',
      source: { type: 'run', runId: 'run-artifact' },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      status: 'active',
    });

    const getRes = await route.GET(new Request('http://localhost/api/knowledge/knowledge-artifact/artifacts/content.md'), {
      params: Promise.resolve({ id: 'knowledge-artifact', path: ['content.md'] }),
    });
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({
      path: 'content.md',
      content: 'Original artifact content',
    });

    const putRes = await route.PUT(new Request('http://localhost/api/knowledge/knowledge-artifact/artifacts/content.md', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Updated artifact content' }),
    }), {
      params: Promise.resolve({ id: 'knowledge-artifact', path: ['content.md'] }),
    });
    expect(putRes.status).toBe(200);

    const updated = knowledge.getKnowledgeAsset('knowledge-artifact');
    expect(updated?.content).toBe('Updated artifact content');
  });
});
