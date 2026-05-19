import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GrowthProposal, RunCapsule } from '@/lib/company-kernel/contracts';

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
    growthGenerateRoute: await import('./growth/proposals/generate/route'),
    growthEvaluateRoute: await import('./growth/proposals/[id]/evaluate/route'),
    growthListRoute: await import('./growth/proposals/route'),
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

function seedGrowthProposal(db: Database.Database, proposal: GrowthProposal): void {
  db.prepare(`
    INSERT INTO growth_proposals(
      proposal_id, kind, status, risk, score, workspace, target_name, target_ref,
      created_at, updated_at, payload_json
    )
    VALUES (
      @proposal_id, @kind, @status, @risk, @score, @workspace, @target_name, @target_ref,
      @created_at, @updated_at, @payload_json
    )
  `).run({
    proposal_id: proposal.id,
    kind: proposal.kind,
    status: proposal.status,
    risk: proposal.risk,
    score: proposal.score,
    workspace: proposal.workspaceUri || null,
    target_name: proposal.targetName,
    target_ref: proposal.targetRef,
    created_at: proposal.createdAt,
    updated_at: proposal.updatedAt,
    payload_json: JSON.stringify(proposal),
  });
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

  it('keeps growth proposal APIs read-only while still listing legacy proposals', async () => {
    const modules = await loadModules();
    seedGrowthProposal(modules.gatewayDb.getGatewayDb(), {
      id: 'growth-legacy-1',
      kind: 'workflow',
      status: 'draft',
      risk: 'medium',
      score: 75,
      workspaceUri: 'file:///tmp/workspace',
      title: 'Legacy growth proposal',
      summary: 'Historical growth proposal.',
      targetName: 'legacy-growth-proposal',
      targetRef: 'workflow:/legacy-growth-proposal',
      content: '# Legacy Growth Proposal',
      sourceRunIds: [],
      sourceCapsuleIds: [],
      sourceKnowledgeIds: [],
      sourceCandidateIds: [],
      evidenceRefs: [],
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    });

    const generateRes = await modules.growthGenerateRoute.POST(new Request('http://localhost/api/company/growth/proposals/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 5 }),
    }));
    const generateBody = await generateRes.json();
    expect(generateRes.status).toBe(410);
    expect(generateBody.legacyMode).toBe('read-only');

    const listRes = await modules.growthListRoute.GET(new Request('http://localhost/api/company/growth/proposals?pageSize=5'));
    expect(listRes.status).toBe(200);
    expect((await listRes.json()).total).toBeGreaterThan(0);
  });

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

  it('returns 410 for legacy growth generation even when old automation inputs are provided', async () => {
    const modules = await loadModules();
    const generateRes = await modules.growthGenerateRoute.POST(new Request('http://localhost/api/company/growth/proposals/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 5 }),
    }));
    const body = await generateRes.json();

    expect(generateRes.status).toBe(410);
    expect(body.legacyMode).toBe('read-only');
    expect(body.replacement).toContain('/api/company/self-improvement/proposals');
  });

  it('returns 410 when mutating a legacy growth proposal', async () => {
    const modules = await loadModules();
    seedGrowthProposal(modules.gatewayDb.getGatewayDb(), {
      id: 'growth-high-risk-route',
      kind: 'workflow',
      status: 'draft',
      risk: 'high',
      score: 80,
      workspaceUri: 'file:///tmp/workspace',
      title: 'High-risk workflow',
      summary: 'Publish a workflow that changes operating behavior.',
      targetName: 'high-risk-workflow',
      targetRef: 'workflow:/high-risk-workflow',
      content: '# High Risk Workflow',
      sourceRunIds: ['run-a', 'run-b', 'run-c'],
      sourceCapsuleIds: [],
      sourceKnowledgeIds: [],
      sourceCandidateIds: [],
      evidenceRefs: [],
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    });

    const evaluateRes = await modules.growthEvaluateRoute.POST(new Request('http://localhost/api/company/growth/proposals/growth-high-risk-route/evaluate', {
      method: 'POST',
    }), {
      params: Promise.resolve({ id: 'growth-high-risk-route' }),
    });
    const body = await evaluateRes.json();

    expect(evaluateRes.status).toBe(410);
    expect(body.legacyMode).toBe('read-only');
  });

  it('proxies new company routes from web role to control-plane', async () => {
    const { signalsRoute } = await loadModules();
    process.env.AG_ROLE = 'web';
    process.env.AG_CONTROL_PLANE_URL = 'http://127.0.0.1:3101';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const res = await signalsRoute.GET(new Request('http://localhost/api/company/signals?pageSize=1'));

    expect(res.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('http://127.0.0.1:3101/api/company/signals?pageSize=1');
  });
});
