import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemoryCandidate } from '@/lib/company-kernel/contracts';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;
let previousRole: string | undefined;
let previousControlPlaneUrl: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    listRoute: await import('./route'),
    detailRoute: await import('./[id]/route'),
    promoteRoute: await import('./[id]/promote/route'),
    rejectRoute: await import('./[id]/reject/route'),
    candidateStore: await import('@/lib/company-kernel/memory-candidate-store'),
    knowledgeStore: await import('@/lib/knowledge/store'),
  };
}

function makeCandidate(id: string, overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    id,
    workspaceUri: 'file:///tmp/workspace',
    sourceRunId: 'run-1',
    sourceCapsuleId: 'capsule-run-1',
    kind: 'decision',
    title: 'Decision candidate',
    content: 'Use deterministic promotion.',
    evidenceRefs: [{
      id: 'ev-1',
      type: 'result-envelope',
      label: 'Result Envelope',
      runId: 'run-1',
      artifactPath: 'result-envelope.json',
      createdAt: '2026-04-25T10:00:00.000Z',
    }],
    volatility: 'stable',
    score: {
      total: 80,
      evidence: 80,
      reuse: 50,
      specificity: 80,
      stability: 90,
      novelty: 85,
      risk: 20,
    },
    reasons: ['test'],
    conflicts: [],
    status: 'pending-review',
    createdAt: '2026-04-25T10:00:00.000Z',
    updatedAt: '2026-04-25T10:00:00.000Z',
    ...overrides,
  };
}

describe('/api/company/memory-candidates', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'api-memory-candidates-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    previousRole = process.env.AG_ROLE;
    previousControlPlaneUrl = process.env.AG_CONTROL_PLANE_URL;
    process.env.HOME = tempHome;
    process.env.AG_GATEWAY_HOME = path.join(tempHome, 'gateway-home');
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
    vi.restoreAllMocks();
    vi.resetModules();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    if (previousRole === undefined) delete process.env.AG_ROLE;
    else process.env.AG_ROLE = previousRole;
    if (previousControlPlaneUrl === undefined) delete process.env.AG_CONTROL_PLANE_URL;
    else process.env.AG_CONTROL_PLANE_URL = previousControlPlaneUrl;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('lists and reads memory candidates with pagination', async () => {
    const { listRoute, detailRoute, candidateStore } = await loadModules();
    candidateStore.upsertMemoryCandidate(makeCandidate('candidate-1'));

    const listRes = await listRoute.GET(new Request('http://localhost/api/company/memory-candidates?workspaceUri=file%3A%2F%2F%2Ftmp%2Fworkspace&pageSize=1'));
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual({
      items: [expect.objectContaining({ id: 'candidate-1' })],
      page: 1,
      pageSize: 1,
      total: 1,
      hasMore: false,
    });

    const detailRes = await detailRoute.GET(new Request('http://localhost/api/company/memory-candidates/candidate-1'), {
      params: Promise.resolve({ id: 'candidate-1' }),
    });
    expect(detailRes.status).toBe(200);
    expect(await detailRes.json()).toEqual(expect.objectContaining({ id: 'candidate-1' }));
  });

  it('promotes and rejects candidates through API routes', async () => {
    const { promoteRoute, rejectRoute, candidateStore, knowledgeStore } = await loadModules();
    candidateStore.upsertMemoryCandidate(makeCandidate('candidate-promote'));
    candidateStore.upsertMemoryCandidate(makeCandidate('candidate-reject'));

    const promoteRes = await promoteRoute.POST(new Request('http://localhost/api/company/memory-candidates/candidate-promote/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Promoted decision' }),
    }), {
      params: Promise.resolve({ id: 'candidate-promote' }),
    });
    expect(promoteRes.status).toBe(201);
    const promotePayload = await promoteRes.json();
    expect(promotePayload.knowledge).toEqual(expect.objectContaining({ title: 'Promoted decision' }));
    expect(knowledgeStore.listKnowledgeAssets()).toHaveLength(1);

    const rejectRes = await rejectRoute.POST(new Request('http://localhost/api/company/memory-candidates/candidate-reject/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Duplicate' }),
    }), {
      params: Promise.resolve({ id: 'candidate-reject' }),
    });
    expect(rejectRes.status).toBe(200);
    expect(candidateStore.getMemoryCandidate('candidate-reject')?.status).toBe('rejected');
  });

  it('rejects invalid candidate state transitions through API routes', async () => {
    const { promoteRoute, rejectRoute, candidateStore } = await loadModules();
    candidateStore.upsertMemoryCandidate(makeCandidate('candidate-rejected', { status: 'rejected' }));
    candidateStore.upsertMemoryCandidate(makeCandidate('candidate-promoted', {
      status: 'promoted',
      promotedKnowledgeId: 'knowledge-existing',
    }));

    const promoteRes = await promoteRoute.POST(new Request('http://localhost/api/company/memory-candidates/candidate-rejected/promote', {
      method: 'POST',
    }), {
      params: Promise.resolve({ id: 'candidate-rejected' }),
    });
    expect(promoteRes.status).toBe(409);

    const rejectRes = await rejectRoute.POST(new Request('http://localhost/api/company/memory-candidates/candidate-promoted/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Rollback' }),
    }), {
      params: Promise.resolve({ id: 'candidate-promoted' }),
    });
    expect(rejectRes.status).toBe(409);
    expect(candidateStore.getMemoryCandidate('candidate-promoted')?.status).toBe('promoted');
  });

  it('proxies list requests from the web role to the control-plane service', async () => {
    const { listRoute } = await loadModules();
    process.env.AG_ROLE = 'web';
    process.env.AG_CONTROL_PLANE_URL = 'http://127.0.0.1:3101';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const res = await listRoute.GET(new Request('http://localhost/api/company/memory-candidates?pageSize=1'));

    expect(res.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('http://127.0.0.1:3101/api/company/memory-candidates?pageSize=1');
  });
});
