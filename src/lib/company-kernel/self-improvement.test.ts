import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    approval: await import('./self-improvement-approval'),
    planner: await import('./self-improvement-planner'),
    risk: await import('./self-improvement-risk'),
    signal: await import('./self-improvement-signal'),
    store: await import('./self-improvement-store'),
  };
}

describe('guarded self-improvement kernel', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'self-improvement-kernel-'));
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

  it('classifies docs-only changes as low risk and protected core as high risk', async () => {
    const modules = await loadModules();

    expect(modules.risk.evaluateSystemImprovementRisk({
      affectedFiles: ['docs/design/example.md'],
    }).risk).toBe('low');
    expect(modules.risk.evaluateSystemImprovementRisk({
      affectedFiles: ['src/lib/storage/gateway-db.ts'],
    }).risk).toBe('critical');
    expect(modules.risk.evaluateSystemImprovementRisk({
      affectedFiles: ['src/lib/agents/scheduler.ts'],
    }).risk).toBe('high');
  });

  it('generates proposals with evidence gate, test plan, rollback plan, and approval requirement', async () => {
    const modules = await loadModules();
    const signal = modules.signal.createSystemImprovementSignal({
      source: 'performance',
      title: 'Slow company API',
      summary: 'A hot API is slower than expected.',
      affectedAreas: ['api'],
      evidenceRefs: [{
        id: 'ev-api-latency',
        type: 'api-response',
        label: 'API latency sample',
        apiRoute: '/api/company/loops/runs',
        createdAt: '2026-04-26T00:00:00.000Z',
      }],
      estimatedBenefit: { latencyReductionMs: 500 },
    });

    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: ['src/app/api/company/loops/runs/route.ts'],
    });

    expect(proposal.status).toBe('approval-required');
    expect(proposal.risk).toBe('high');
    expect(proposal.testPlan.length).toBeGreaterThan(0);
    expect(proposal.rollbackPlan.length).toBeGreaterThan(0);

    const withApproval = await modules.approval.ensureSystemImprovementApprovalRequest(proposal.id);
    expect(withApproval.approvalRequestId).toBeTruthy();
  });

  it('moves proposal to ready-to-merge after passing test evidence', async () => {
    const modules = await loadModules();
    const signal = modules.signal.createSystemImprovementSignal({
      source: 'manual-feedback',
      title: 'Docs improvement',
      summary: 'Clarify operating loop docs.',
      affectedAreas: ['docs'],
      evidenceRefs: [{
        id: 'ev-user-feedback',
        type: 'user-feedback',
        label: 'User feedback',
        createdAt: '2026-04-26T00:00:00.000Z',
      }],
    });
    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: ['docs/design/loop.md'],
    });
    const updated = modules.store.attachSystemImprovementTestEvidence(proposal.id, {
      command: 'npx tsc --noEmit --pretty false',
      status: 'passed',
      outputSummary: 'typecheck passed',
      createdAt: '2026-04-26T00:01:00.000Z',
    });

    expect(updated?.status).toBe('ready-to-merge');
  });

  it('keeps high-risk proposals approval-gated even when tests pass', async () => {
    const modules = await loadModules();
    const signal = modules.signal.createSystemImprovementSignal({
      source: 'manual-feedback',
      title: 'Scheduler hardening',
      summary: 'Tighten scheduler guardrails.',
      affectedAreas: ['scheduler'],
      evidenceRefs: [{
        id: 'ev-scheduler-risk',
        type: 'user-feedback',
        label: 'Scheduler risk feedback',
        createdAt: '2026-04-26T00:00:00.000Z',
      }],
    });
    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: ['src/lib/agents/scheduler.ts'],
    });

    const testedBeforeApproval = modules.store.attachSystemImprovementTestEvidence(proposal.id, {
      command: 'npx vitest run src/lib/agents/scheduler.test.ts',
      status: 'passed',
      outputSummary: 'scheduler tests passed',
      createdAt: '2026-04-26T00:02:00.000Z',
    });

    expect(testedBeforeApproval?.risk).toBe('high');
    expect(testedBeforeApproval?.status).toBe('approval-required');

    const approved = await modules.approval.approveSystemImprovementProposal(proposal.id);
    expect(approved?.status).toBe('approved');

    const testedAfterApproval = modules.store.attachSystemImprovementTestEvidence(proposal.id, {
      command: 'npx tsc --noEmit --pretty false',
      status: 'passed',
      outputSummary: 'typecheck passed',
      createdAt: '2026-04-26T00:03:00.000Z',
    });

    expect(testedAfterApproval?.status).toBe('ready-to-merge');
  });

  it('lets approved high-risk proposals recover from failed test evidence after a later pass', async () => {
    const modules = await loadModules();
    const signal = modules.signal.createSystemImprovementSignal({
      source: 'manual-feedback',
      title: 'Scheduler lifecycle recovery',
      summary: 'Allow protected changes to recover after a fixed test run.',
      affectedAreas: ['scheduler'],
      evidenceRefs: [{
        id: 'ev-scheduler-retry',
        type: 'user-feedback',
        label: 'Scheduler retry lifecycle feedback',
        createdAt: '2026-04-26T00:00:00.000Z',
      }],
    });
    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: ['src/lib/agents/scheduler.ts'],
    });

    const approved = await modules.approval.approveSystemImprovementProposal(proposal.id);
    expect(approved.status).toBe('approved');
    expect(approved.metadata?.approvalStatus).toBe('approved');
    expect(typeof approved.metadata?.approvedAt).toBe('string');

    const failed = modules.store.attachSystemImprovementTestEvidence(proposal.id, {
      command: 'npx vitest run src/lib/agents/scheduler.test.ts',
      status: 'failed',
      outputSummary: 'scheduler tests failed before fix',
      createdAt: '2026-04-26T00:04:00.000Z',
    });

    expect(failed?.status).toBe('testing');

    const passed = modules.store.attachSystemImprovementTestEvidence(proposal.id, {
      command: 'npx vitest run src/lib/agents/scheduler.test.ts',
      status: 'passed',
      outputSummary: 'scheduler tests passed after fix',
      createdAt: '2026-04-26T00:05:00.000Z',
    });

    expect(passed?.status).toBe('ready-to-merge');
    expect(passed?.testEvidence.map((item) => item.status)).toEqual(['failed', 'passed']);
  });
});
