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
    contracts: await import('../contracts'),
    store: await import('../store'),
  };
}

describe('knowledge store', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-store-'));
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

  it('upserts assets into sqlite and filesystem mirror', async () => {
    const { store } = await loadModules();
    const asset = {
      id: 'asset-1',
      scope: 'department' as const,
      workspaceUri: 'file:///tmp/workspace',
      category: 'decision' as const,
      title: 'Use SQLite for assets',
      content: 'We decided to persist structured knowledge in SQLite.',
      source: { type: 'run' as const, runId: 'run-1' },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      status: 'active' as const,
    };

    store.upsertKnowledgeAsset(asset);

    const stored = store.getKnowledgeAsset('asset-1');
    expect(stored?.title).toBe('Use SQLite for assets');

    const metadataPath = path.join(tempHome, '.gemini', 'antigravity', 'knowledge', 'asset-1', 'metadata.json');
    expect(fs.existsSync(metadataPath)).toBe(true);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(metadata.title).toBe('Use SQLite for assets');
  });

  it('filters assets by workspace and limit', async () => {
    const { store } = await loadModules();
    store.upsertKnowledgeAsset({
      id: 'asset-a',
      scope: 'department',
      workspaceUri: 'file:///tmp/a',
      category: 'decision',
      title: 'A',
      content: 'Content A',
      source: { type: 'run', runId: 'run-a' },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      status: 'active',
    });
    store.upsertKnowledgeAsset({
      id: 'asset-b',
      scope: 'department',
      workspaceUri: 'file:///tmp/b',
      category: 'pattern',
      title: 'B',
      content: 'Content B',
      source: { type: 'run', runId: 'run-b' },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T01:00:00.000Z',
      status: 'active',
    });

    expect(store.listKnowledgeAssets({ workspaceUri: 'file:///tmp/a' })).toHaveLength(1);
    expect(store.listKnowledgeAssets({ limit: 1 })).toHaveLength(1);
  });

  it('updates metadata and artifacts', async () => {
    const { store } = await loadModules();
    store.upsertKnowledgeAsset({
      id: 'asset-edit',
      scope: 'department',
      workspaceUri: 'file:///tmp/a',
      category: 'pattern',
      title: 'Old title',
      content: 'Old content',
      source: { type: 'run', runId: 'run-edit' },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      status: 'active',
    });

    store.updateKnowledgeAssetMetadata('asset-edit', { title: 'New title' });
    store.updateKnowledgeAssetArtifact('asset-edit', 'content.md', 'New content');

    const updated = store.getKnowledgeAsset('asset-edit');
    expect(updated?.title).toBe('New title');
    expect(updated?.content).toBe('New content');
  });

  it('applies stale filtering after hydration so active queries do not leak stale assets', async () => {
    const { store } = await loadModules();
    store.upsertKnowledgeAsset({
      id: 'asset-stale',
      scope: 'department',
      workspaceUri: 'file:///tmp/a',
      category: 'pattern',
      title: 'Old pattern',
      content: 'Old content',
      source: { type: 'run', runId: 'run-stale' },
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      status: 'active',
    });

    expect(store.listKnowledgeAssets({ status: 'stale' })).toEqual([
      expect.objectContaining({ id: 'asset-stale', status: 'stale' }),
    ]);
    expect(store.listKnowledgeAssets({ status: 'active' })).toHaveLength(0);
  });

  it('builds knowledge items with lastAccessedAt as accessed timestamp', async () => {
    const { store } = await loadModules();
    const item = store.buildKnowledgeItemFromAsset({
      id: 'asset-accessed',
      scope: 'department',
      workspaceUri: 'file:///tmp/a',
      category: 'decision',
      title: 'Accessed item',
      content: 'content',
      source: { type: 'run', runId: 'run-accessed' },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T01:00:00.000Z',
      lastAccessedAt: '2026-04-19T02:00:00.000Z',
      status: 'active',
    });

    expect(item.timestamps.accessed).toBe('2026-04-19T02:00:00.000Z');
  });
});
