import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunCapsule } from '@/lib/company-kernel/contracts';

const {
  proxyToControlPlaneMock,
  shouldProxyControlPlaneRequestMock,
} = vi.hoisted(() => ({
  proxyToControlPlaneMock: vi.fn(async (req: Request) => {
    const baseUrl = process.env.AG_CONTROL_PLANE_URL;
    if (!baseUrl) {
      throw new Error('AG_CONTROL_PLANE_URL is not configured');
    }

    const currentUrl = new URL(req.url);
    const targetUrl = new URL(currentUrl.pathname, baseUrl);
    targetUrl.search = currentUrl.search;
    const body = req.method === 'GET' || req.method === 'HEAD'
      ? undefined
      : await req.blob();
    const response = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: req.headers,
      body,
      redirect: 'manual',
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }),
  shouldProxyControlPlaneRequestMock: vi.fn(() => false),
}));

vi.mock('@/server/shared/proxy', () => ({
  proxyToControlPlane: (...args: unknown[]) => proxyToControlPlaneMock(...args),
  shouldProxyControlPlaneRequest: (...args: unknown[]) => shouldProxyControlPlaneRequestMock(...args),
}));

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;
let previousRole: string | undefined;
let previousControlPlaneUrl: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    agendaRoute: await import('./agenda/route'),
    agendaDispatchRoute: await import('./agenda/[id]/dispatch/route'),
    agendaDispatchCheckRoute: await import('./agenda/[id]/dispatch-check/route'),
    gatewayDb: await import('@/lib/storage/gateway-db'),
    operatingDayRoute: await import('./operating-day/route'),
    signalsRoute: await import('./signals/route'),
    agendaStore: await import('@/lib/company-kernel/agenda-store'),
    budgetLedgerStore: await import('@/lib/company-kernel/budget-ledger-store'),
    budgetPolicy: await import('@/lib/company-kernel/budget-policy'),
    integration: await import('@/lib/company-kernel/operating-integration'),
  };
}

function makeCapsule(): RunCapsule {
  return {
    capsuleId: 'capsule-api-run',
    runId: 'api-run',
    workspaceUri: 'file:///tmp/workspace',
    goal: 'Build reusable operating report',
    prompt: 'Build reusable operating report',
    status: 'completed',
    finishedAt: '2026-04-25T10:01:00.000Z',
    checkpoints: [],
    verifiedFacts: ['Result status: completed'],
    decisions: [],
    reusableSteps: ['Use stable report workflow.'],
    blockers: [],
    changedFiles: [],
    outputArtifacts: [],
    qualitySignals: {
      resultStatus: 'completed',
      verificationPassed: true,
      hasResultEnvelope: true,
      hasArtifactManifest: false,
      hasDeliveryPacket: false,
    },
    sourceRunUpdatedAt: '2026-04-25T10:01:00.000Z',
    createdAt: '2026-04-25T10:00:00.000Z',
    updatedAt: '2026-04-25T10:01:00.000Z',
  };
}

describe('/api/company operating kernel routes', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'api-operating-kernel-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    previousRole = process.env.AG_ROLE;
    previousControlPlaneUrl = process.env.AG_CONTROL_PLANE_URL;
    process.env.HOME = tempHome;
    process.env.AG_GATEWAY_HOME = path.join(tempHome, 'gateway-home');
    process.env.AG_ROLE = 'api';
    proxyToControlPlaneMock.mockClear();
    shouldProxyControlPlaneRequestMock.mockReset();
    shouldProxyControlPlaneRequestMock.mockReturnValue(false);
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

  it('lists signals, agenda, and operating day through API routes', async () => {
    const modules = await loadModules();
    const agenda = modules.integration.observeRunCapsuleForAgenda(makeCapsule());

    const signalRes = await modules.signalsRoute.GET(new Request('http://localhost/api/company/signals?pageSize=5'));
    expect(signalRes.status).toBe(200);
    expect((await signalRes.json()).total).toBe(1);

    const agendaRes = await modules.agendaRoute.GET(new Request('http://localhost/api/company/agenda?pageSize=5'));
    expect(agendaRes.status).toBe(200);
    expect((await agendaRes.json()).items[0].id).toBe(agenda[0].id);

    const gateRes = await modules.agendaDispatchCheckRoute.POST(new Request(`http://localhost/api/company/agenda/${agenda[0].id}/dispatch-check`, {
      method: 'POST',
    }), {
      params: Promise.resolve({ id: agenda[0].id }),
    });
    expect(gateRes.status).toBe(200);
    expect((await gateRes.json()).decision.allowed).toBe(true);

    const dayRes = await modules.operatingDayRoute.GET(new Request('http://localhost/api/company/operating-day?limit=5'));
    expect(dayRes.status).toBe(200);
    expect((await dayRes.json()).agenda).toHaveLength(1);
  }, 15_000);

  it('does not reserve budget when agenda dispatch has no workspace', async () => {
    const modules = await loadModules();
    const item = modules.agendaStore.upsertOperatingAgendaItem({
      id: 'agenda-no-workspace',
      signalIds: ['signal-no-workspace'],
      title: 'No workspace agenda',
      recommendedAction: 'dispatch',
      priority: 'p1',
      score: 80,
      status: 'ready',
      reason: 'test',
      evidenceRefs: [],
      estimatedCost: { tokens: 100, minutes: 5 },
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    });

    const dispatchRes = await modules.agendaDispatchRoute.POST(new Request(`http://localhost/api/company/agenda/${item.id}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }), {
      params: Promise.resolve({ id: item.id }),
    });

    expect(dispatchRes.status).toBe(409);
    expect(modules.budgetLedgerStore.countBudgetLedgerEntries({ agendaItemId: item.id })).toBe(0);
  });

  it('proxies new company routes from web role to control-plane', async () => {
    const { signalsRoute } = await loadModules();
    process.env.AG_ROLE = 'web';
    process.env.AG_CONTROL_PLANE_URL = 'http://127.0.0.1:3101';
    shouldProxyControlPlaneRequestMock.mockReturnValue(true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const res = await signalsRoute.GET(new Request('http://localhost/api/company/signals?pageSize=1'));

    expect(res.status).toBe(200);
    expect(proxyToControlPlaneMock).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('http://127.0.0.1:3101/api/company/signals?pageSize=1');
  });
});
