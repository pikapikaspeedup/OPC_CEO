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
  return {
    retrieval: await import('../retrieval'),
    store: await import('../store'),
  };
}

describe('knowledge retrieval', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-retrieval-'));
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

  it('returns the most relevant assets for a prompt', async () => {
    const { retrieval, store } = await loadModules();
    store.upsertKnowledgeAsset({
      id: 'asset-vitest',
      scope: 'department',
      workspaceUri: 'file:///tmp/workspace',
      category: 'decision',
      title: 'Use Vitest for route tests',
      content: 'We decided to use Vitest for route-level tests and API smoke coverage.',
      source: { type: 'run', runId: 'run-1' },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T01:00:00.000Z',
      status: 'active',
      tags: ['workflow:/api_review', 'skill:testing'],
    });
    store.upsertKnowledgeAsset({
      id: 'asset-css',
      scope: 'department',
      workspaceUri: 'file:///tmp/workspace',
      category: 'pattern',
      title: 'Use CSS variables in dashboard',
      content: 'Keep CSS variables centralized.',
      source: { type: 'run', runId: 'run-2' },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-18T01:00:00.000Z',
      status: 'active',
    });

    const assets = retrieval.retrieveKnowledgeAssets({
      workspaceUri: 'file:///tmp/workspace',
      promptText: '补 route tests，继续做 API smoke',
      workflowRef: '/api_review',
      skillHints: ['testing'],
      limit: 3,
    });

    expect(assets[0]?.id).toBe('asset-vitest');
    expect(assets).toHaveLength(1);
  });

  it('formats retrieved assets into a prompt section', async () => {
    const { retrieval } = await loadModules();
    const section = retrieval.formatKnowledgeAssetsForPrompt([
      {
        id: 'asset-1',
        scope: 'department',
        workspaceUri: 'file:///tmp/workspace',
        category: 'decision',
        title: 'Keep API routes thin',
        content: 'Prefer moving logic into src/lib rather than bloating route.ts files.',
        source: { type: 'run', runId: 'run-1' },
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T00:00:00.000Z',
        status: 'active',
      },
    ]);

    expect(section).toContain('## Retrieved Knowledge');
    expect(section).toContain('Keep API routes thin');
  });

  it('skips stale assets when retrieving active knowledge', async () => {
    const { retrieval, store } = await loadModules();
    store.upsertKnowledgeAsset({
      id: 'asset-stale',
      scope: 'department',
      workspaceUri: 'file:///tmp/workspace',
      category: 'decision',
      title: 'Old route testing guidance',
      content: 'This was relevant before.',
      source: { type: 'run', runId: 'run-old' },
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      status: 'active',
      tags: ['workflow:/api_review'],
    });

    const assets = retrieval.retrieveKnowledgeAssets({
      workspaceUri: 'file:///tmp/workspace',
      promptText: '继续补 route tests',
      workflowRef: '/api_review',
      limit: 5,
    });

    expect(assets).toHaveLength(0);
  });
});
