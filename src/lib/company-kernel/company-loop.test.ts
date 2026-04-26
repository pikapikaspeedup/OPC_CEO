import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OperatingAgendaItem } from './contracts';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    agendaStore: await import('./agenda-store'),
    budgetPolicy: await import('./budget-policy'),
    loopExecutor: await import('./company-loop-executor'),
    loopPolicy: await import('./company-loop-policy'),
    loopRunStore: await import('./company-loop-run-store'),
    loopSelector: await import('./company-loop-selector'),
  };
}

function makeAgenda(id: string, overrides: Partial<OperatingAgendaItem> = {}): OperatingAgendaItem {
  return {
    id,
    signalIds: [`signal-${id}`],
    title: `Agenda ${id}`,
    recommendedAction: 'dispatch',
    targetDepartmentId: 'file:///tmp/company-loop-workspace',
    priority: 'p1',
    score: 80,
    status: 'ready',
    reason: 'test agenda',
    evidenceRefs: [],
    workspaceUri: 'file:///tmp/company-loop-workspace',
    estimatedCost: { tokens: 100, minutes: 5 },
    createdAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('company loop kernel', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'company-loop-kernel-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.HOME = tempHome;
    process.env.AG_GATEWAY_HOME = path.join(tempHome, 'gateway-home');
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
    vi.resetModules();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('creates default policy and persists loop runs with digests', async () => {
    const modules = await loadModules();
    const policy = modules.loopPolicy.upsertCompanyLoopPolicy({
      ...modules.loopPolicy.getOrCreateCompanyLoopPolicy(),
      notificationChannels: ['web', 'email', 'webhook'],
    });
    expect(policy.enabled).toBe(true);
    expect(modules.loopPolicy.countCompanyLoopPolicies()).toBe(1);

    modules.agendaStore.upsertOperatingAgendaItem(makeAgenda('a'));
    modules.agendaStore.upsertOperatingAgendaItem(makeAgenda('b'));

    const result = modules.loopExecutor.runCompanyLoop({ kind: 'daily-review', source: 'test' });

    expect(result.run.status).toBe('completed');
    expect(result.run.selectedAgendaIds).toHaveLength(2);
    expect(result.run.dispatchedRunIds).toHaveLength(1);
    expect(result.digestId).toBeTruthy();
    expect(result.run.notificationIds).toHaveLength(3);
    expect(modules.loopRunStore.countCompanyLoopRuns()).toBe(1);
    expect(modules.loopRunStore.countCompanyLoopDigests()).toBe(1);
  });

  it('keeps high-risk agenda in digest and enforces dispatch cap', async () => {
    const modules = await loadModules();
    const policy = modules.loopPolicy.upsertCompanyLoopPolicy({
      ...modules.loopPolicy.buildDefaultCompanyLoopPolicy(),
      maxAgendaPerDailyLoop: 3,
      maxAutonomousDispatchesPerLoop: 1,
    });

    const selection = modules.loopSelector.selectCompanyLoopAgenda({
      policy,
      agenda: [
        makeAgenda('safe-1', { score: 90 }),
        makeAgenda('safe-2', { score: 85 }),
        makeAgenda('risky', { score: 100, metadata: { risk: 90 } }),
      ],
      signalResolver: () => null,
    });

    expect(selection.selected.map((item) => item.id)).toContain('risky');
    expect(selection.dispatchCandidates).toHaveLength(1);
    expect(selection.digestOnly.some((entry) => entry.reason.includes('risk-too-high'))).toBe(true);
  });

  it('does not exceed Top-N when selected items are digest-only', async () => {
    const modules = await loadModules();
    const policy = modules.loopPolicy.upsertCompanyLoopPolicy({
      ...modules.loopPolicy.buildDefaultCompanyLoopPolicy(),
      allowedAgendaActions: ['observe', 'dispatch', 'approve', 'snooze', 'dismiss'],
      maxAgendaPerDailyLoop: 1,
      maxAutonomousDispatchesPerLoop: 1,
    });

    const selection = modules.loopSelector.selectCompanyLoopAgenda({
      policy,
      agenda: [
        makeAgenda('needs-approval', { recommendedAction: 'approve', score: 100 }),
        makeAgenda('safe-dispatch', { score: 20 }),
      ],
      signalResolver: () => null,
    });

    expect(selection.selected.map((item) => item.id)).toEqual(['needs-approval']);
    expect(selection.dispatchCandidates).toHaveLength(0);
    expect(selection.digestOnly).toHaveLength(1);
  });

  it('writes skipped ledger when budget blocks loop dispatch', async () => {
    const modules = await loadModules();
    modules.budgetPolicy.upsertBudgetPolicy({
      ...modules.budgetPolicy.buildDefaultBudgetPolicy({
        scope: 'department',
        scopeId: 'file:///tmp/company-loop-workspace',
      }),
      maxTokens: 10,
      maxMinutes: 1,
      maxDispatches: 0,
    });
    modules.agendaStore.upsertOperatingAgendaItem(makeAgenda('blocked', {
      estimatedCost: { tokens: 100, minutes: 5 },
    }));

    const result = modules.loopExecutor.runCompanyLoop({ kind: 'daily-review', source: 'test' });

    expect(result.run.status).toBe('completed');
    expect(result.run.dispatchedRunIds).toHaveLength(0);
    expect(result.budgetLedger[0]?.decision).toBe('skipped');
    expect(result.skipped.some((entry) => entry.reason.includes('exceeded'))).toBe(true);
    expect(Array.isArray(result.run.metadata?.skippedAgenda)).toBe(true);
    expect(result.run.metadata?.skippedCount).toBe(1);
    expect((result.run.metadata?.skippedAgenda as Array<{ id: string; reason: string }>)[0]).toMatchObject({
      id: 'blocked',
    });
  });
});
