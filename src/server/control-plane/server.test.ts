import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemoryCandidate, RunCapsule } from '@/lib/company-kernel/contracts';
import type { RouteDefinition } from '@/server/shared/http-server';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;
let previousRole: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    companyRoutes: await import('./company-routes'),
    capsuleStore: await import('@/lib/company-kernel/run-capsule-store'),
    candidateStore: await import('@/lib/company-kernel/memory-candidate-store'),
  };
}

function makeCapsule(runId: string): RunCapsule {
  return {
    capsuleId: `capsule-${runId}`,
    runId,
    workspaceUri: 'file:///tmp/company-kernel',
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

function makeCandidate(id: string): MemoryCandidate {
  return {
    id,
    workspaceUri: 'file:///tmp/company-kernel',
    sourceRunId: 'run-company',
    sourceCapsuleId: 'capsule-run-company',
    kind: 'decision',
    title: 'Decision candidate',
    content: 'Use control-plane registered routes.',
    evidenceRefs: [],
    volatility: 'stable',
    score: {
      total: 55,
      evidence: 0,
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
  };
}

async function callRoute(
  routes: RouteDefinition[],
  pathWithQuery: string,
): Promise<Response> {
  const url = new URL(pathWithQuery, 'http://localhost');
  const route = routes.find((candidate) => candidate.pattern.test(url.pathname));
  expect(route).toBeDefined();
  const match = url.pathname.match(route!.pattern);
  expect(match).toBeTruthy();
  return route!.handler(new Request(url), match!);
}

describe('control-plane company routes', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'control-plane-company-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    previousRole = process.env.AG_ROLE;
    process.env.HOME = tempHome;
    process.env.AG_GATEWAY_HOME = path.join(tempHome, 'gateway-home');
    process.env.AG_ROLE = 'api';
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
    vi.resetModules();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    if (previousRole === undefined) delete process.env.AG_ROLE;
    else process.env.AG_ROLE = previousRole;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('serves Company Kernel routes from the split API/control-plane route table', async () => {
    const { companyRoutes, capsuleStore, candidateStore } = await loadModules();
    capsuleStore.upsertRunCapsule(makeCapsule('run-company'));
    candidateStore.upsertMemoryCandidate(makeCandidate('candidate-company'));
    const routes = companyRoutes.createCompanyControlPlaneRoutes();

    const capsulesRes = await callRoute(routes, '/api/company/run-capsules?pageSize=1');
    expect(capsulesRes.status).toBe(200);
    await expect(capsulesRes.json()).resolves.toEqual(expect.objectContaining({
      items: [expect.objectContaining({ runId: 'run-company' })],
      total: 1,
    }));

    const candidatesRes = await callRoute(routes, '/api/company/memory-candidates?pageSize=1');
    expect(candidatesRes.status).toBe(200);
    await expect(candidatesRes.json()).resolves.toEqual(expect.objectContaining({
      items: [expect.objectContaining({ id: 'candidate-company' })],
      total: 1,
    }));
  });
});
