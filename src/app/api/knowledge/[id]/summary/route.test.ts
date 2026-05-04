import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  vi.doMock('@/lib/agents/llm-oneshot', () => ({
    callLLMOneshot: vi.fn(async () => JSON.stringify({ summary: '这条知识总结了路由层应保持轻量，并把核心逻辑下沉到共享模块。' })),
  }));
  vi.doMock('@/lib/providers/ai-config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/providers/ai-config')>();
    return {
      ...actual,
      resolveProvider: vi.fn(() => ({
        provider: 'native-codex',
        model: 'gpt-5.4',
        source: 'layer',
      })),
    };
  });
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  const route = await import('./route');
  const knowledge = await import('@/lib/knowledge');
  return { route, knowledge };
}

describe('/api/knowledge/[id]/summary', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'api-knowledge-summary-'));
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

  it('generates and persists a provider-backed knowledge summary', async () => {
    const { route, knowledge } = await loadModules();
    knowledge.upsertKnowledgeAsset({
      id: 'knowledge-summary',
      scope: 'department',
      workspaceUri: 'file:///tmp/workspace',
      category: 'pattern',
      title: 'Keep route handlers thin',
      content: 'Move heavy logic into src/lib modules and keep HTTP routes declarative.',
      source: { type: 'run', runId: 'run-summary' },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      status: 'active',
    });

    const res = await route.POST(new Request('http://localhost/api/knowledge/knowledge-summary/summary', {
      method: 'POST',
    }), {
      params: Promise.resolve({ id: 'knowledge-summary' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual(expect.objectContaining({
      ok: true,
      provider: 'native-codex',
      model: 'gpt-5.4',
      scene: 'knowledge-summary',
    }));

    const detailRoute = await import('../route');
    const detailRes = await detailRoute.GET(new Request('http://localhost/api/knowledge/knowledge-summary'), {
      params: Promise.resolve({ id: 'knowledge-summary' }),
    });
    const detail = await detailRes.json();
    expect(detail.summary).toContain('路由层应保持轻量');
  }, 15000);
});
