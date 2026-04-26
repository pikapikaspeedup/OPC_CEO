import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunCapsule } from '@/lib/company-kernel/contracts';

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
    detailRoute: await import('./[runId]/route'),
    capsuleStore: await import('@/lib/company-kernel/run-capsule-store'),
  };
}

function makeCapsule(runId: string, workspaceUri: string): RunCapsule {
  return {
    capsuleId: `capsule-${runId}`,
    runId,
    workspaceUri,
    goal: 'Goal',
    prompt: 'Prompt',
    status: 'completed',
    checkpoints: [],
    verifiedFacts: [],
    decisions: [],
    reusableSteps: [],
    blockers: [],
    changedFiles: [],
    outputArtifacts: [],
    qualitySignals: {
      resultStatus: 'completed',
      hasResultEnvelope: false,
      hasArtifactManifest: false,
      hasDeliveryPacket: false,
    },
    sourceRunUpdatedAt: '2026-04-25T10:00:00.000Z',
    createdAt: '2026-04-25T10:00:00.000Z',
    updatedAt: '2026-04-25T10:00:00.000Z',
  };
}

describe('/api/company/run-capsules', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'api-run-capsules-'));
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

  it('lists run capsules with pagination and workspace filtering', async () => {
    const { listRoute, capsuleStore } = await loadModules();
    capsuleStore.upsertRunCapsule(makeCapsule('run-1', 'file:///tmp/a'));
    capsuleStore.upsertRunCapsule(makeCapsule('run-2', 'file:///tmp/b'));

    const res = await listRoute.GET(new Request('http://localhost/api/company/run-capsules?workspaceUri=file%3A%2F%2F%2Ftmp%2Fa&pageSize=1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [expect.objectContaining({ runId: 'run-1', workspaceUri: 'file:///tmp/a' })],
      page: 1,
      pageSize: 1,
      total: 1,
      hasMore: false,
    });
  });

  it('returns a run capsule by run id', async () => {
    const { detailRoute, capsuleStore } = await loadModules();
    capsuleStore.upsertRunCapsule(makeCapsule('run-detail', 'file:///tmp/a'));

    const res = await detailRoute.GET(new Request('http://localhost/api/company/run-capsules/run-detail'), {
      params: Promise.resolve({ runId: 'run-detail' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({ runId: 'run-detail' }));
  });

  it('proxies list requests from the web role to the control-plane service', async () => {
    const { listRoute } = await loadModules();
    process.env.AG_ROLE = 'web';
    process.env.AG_CONTROL_PLANE_URL = 'http://127.0.0.1:3101';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const res = await listRoute.GET(new Request('http://localhost/api/company/run-capsules?pageSize=1'));

    expect(res.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('http://127.0.0.1:3101/api/company/run-capsules?pageSize=1');
  });
});
