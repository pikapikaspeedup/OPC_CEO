import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;
let previousRole: string | undefined;
let previousControlPlaneUrl: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    agendaStore: await import('@/lib/company-kernel/agenda-store'),
    loopRunNowRoute: await import('./loops/run-now/route'),
    loopRunsRoute: await import('./loops/runs/route'),
    selfSignalsRoute: await import('./self-improvement/signals/route'),
    selfGenerateRoute: await import('./self-improvement/proposals/generate/route'),
    selfProposalsRoute: await import('./self-improvement/proposals/route'),
    selfAttachEvidenceRoute: await import('./self-improvement/proposals/[id]/attach-test-evidence/route'),
  };
}

describe('/api/company loops and self-improvement routes', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'company-loop-routes-'));
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

  it('runs a company loop and lists loop runs through API routes', async () => {
    const modules = await loadModules();
    modules.agendaStore.upsertOperatingAgendaItem({
      id: 'route-loop-agenda',
      signalIds: ['route-loop-signal'],
      title: 'Route loop agenda',
      recommendedAction: 'observe',
      priority: 'p2',
      score: 70,
      status: 'ready',
      reason: 'route test',
      evidenceRefs: [],
      estimatedCost: { tokens: 10, minutes: 1 },
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    });

    const runRes = await modules.loopRunNowRoute.POST(new Request('http://localhost/api/company/loops/run-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'daily-review' }),
    }));
    expect(runRes.status).toBe(201);
    expect((await runRes.json()).run.status).toBe('completed');

    const listRes = await modules.loopRunsRoute.GET(new Request('http://localhost/api/company/loops/runs?pageSize=5'));
    const listBody = await listRes.json();
    expect(listRes.status).toBe(200);
    expect(listBody.total).toBe(1);
  }, 15_000);

  it('creates self-improvement signal, proposal, and test evidence through API routes', async () => {
    const modules = await loadModules();
    const signalRes = await modules.selfSignalsRoute.POST(new Request('http://localhost/api/company/self-improvement/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'manual-feedback',
        title: 'Improve docs',
        summary: 'Clarify the loop journey.',
        affectedAreas: ['docs'],
        evidenceRefs: [{
          id: 'route-feedback',
          type: 'user-feedback',
          label: 'Route feedback',
          createdAt: '2026-04-26T00:00:00.000Z',
        }],
      }),
    }));
    const signalBody = await signalRes.json();
    expect(signalRes.status).toBe(201);

    const proposalRes = await modules.selfGenerateRoute.POST(new Request('http://localhost/api/company/self-improvement/proposals/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signalIds: [signalBody.signal.id],
        affectedFiles: ['docs/design/self-improvement.md'],
      }),
    }));
    const proposalBody = await proposalRes.json();
    expect(proposalRes.status).toBe(201);
    expect(proposalBody.proposal.risk).toBe('low');

    const evidenceRes = await modules.selfAttachEvidenceRoute.POST(new Request(`http://localhost/api/company/self-improvement/proposals/${proposalBody.proposal.id}/attach-test-evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'npx tsc --noEmit --pretty false',
        status: 'passed',
        outputSummary: 'passed',
      }),
    }), {
      params: Promise.resolve({ id: proposalBody.proposal.id }),
    });
    expect(evidenceRes.status).toBe(200);
    expect((await evidenceRes.json()).proposal.status).toBe('ready-to-merge');

    const listRes = await modules.selfProposalsRoute.GET(new Request('http://localhost/api/company/self-improvement/proposals?pageSize=5'));
    expect((await listRes.json()).total).toBe(1);
  });

  it('proxies loop API from web role to control-plane', async () => {
    const { loopRunsRoute } = await loadModules();
    process.env.AG_ROLE = 'web';
    process.env.AG_CONTROL_PLANE_URL = 'http://127.0.0.1:3101';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const res = await loopRunsRoute.GET(new Request('http://localhost/api/company/loops/runs?pageSize=1'));

    expect(res.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('http://127.0.0.1:3101/api/company/loops/runs?pageSize=1');
  });
});
