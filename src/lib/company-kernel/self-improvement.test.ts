import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateApprovalInput } from '../approval/types';

vi.mock('../approval/handler', async () => {
  const requestStore = await import('../approval/request-store');
  return {
    submitApprovalRequestSync: (input: CreateApprovalInput) => requestStore.createApprovalRequest(input),
  };
});

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    approval: await import('./self-improvement-approval'),
    approvalStore: await import('../approval/request-store'),
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
  }, 15_000);

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
    expect(approved.proposal.status).toBe('approved');

    const testedAfterApproval = modules.store.attachSystemImprovementTestEvidence(proposal.id, {
      command: 'npx tsc --noEmit --pretty false',
      status: 'passed',
      outputSummary: 'typecheck passed',
      createdAt: '2026-04-26T00:03:00.000Z',
    });

    expect(testedAfterApproval?.status).toBe('ready-to-merge');
  }, 15_000);

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
    expect(approved.proposal.status).toBe('approved');
    expect(approved.proposal.metadata?.approvalStatus).toBe('approved');
    expect(typeof approved.proposal.metadata?.approvedAt).toBe('string');

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

  it('promotes story-top candidates directly into CEO admission approval', async () => {
    const modules = await loadModules();
    const signal = modules.signal.createSystemImprovementSignal({
      source: 'user-story-gap',
      title: '系统改进：候选改进支持直接立项',
      summary: '候选故事应可直接升格为正式提案。',
      evidenceRefs: [{
        id: 'ev-story-top',
        type: 'file',
        label: 'Story source',
        filePath: '/tmp/User Story/CEO Office/CEO 办公室.md',
        excerpt: '作为 CEO，我希望候选改进可以直接立项。',
        createdAt: '2026-05-07T08:00:00.000Z',
      }],
      metadata: {
        candidateKind: 'story-top',
        candidateActive: true,
        storyKey: 'ceo-office-direct-proposal',
        sourcePath: 'User Story/CEO Office/CEO 办公室.md',
        storyText: '作为 CEO，我希望候选改进可以直接立项。',
        expectedOutcome: 'CEO 能直接把故事升格成正式提案。',
        rationale: '缩短立项链路。',
      },
    });

    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
    });

    expect(proposal.status).toBe('approval-required');
    expect(proposal.risk).toBe('high');

    const withApproval = await modules.approval.ensureSystemImprovementApprovalRequest(proposal.id);
    expect(withApproval.approvalRequestId).toBeTruthy();
  });

  it('deletes legacy approval-required proposals that have no approval request', async () => {
    const modules = await loadModules();

    modules.store.upsertSystemImprovementProposal({
      id: 'legacy-invalid-proposal',
      status: 'approval-required',
      title: '旧坏态提案',
      summary: 'This demo record should be removed.',
      sourceSignalIds: ['signal-legacy'],
      evidenceRefs: [],
      affectedFiles: ['src/app/page.tsx'],
      protectedAreas: ['approval'],
      risk: 'high',
      implementationPlan: ['Implement'],
      testPlan: ['npx tsc --noEmit --pretty false'],
      rollbackPlan: ['revert patch'],
      linkedRunIds: [],
      testEvidence: [],
      createdAt: '2026-05-06T10:00:00.000Z',
      updatedAt: '2026-05-06T10:00:00.000Z',
    });

    expect(modules.store.listSystemImprovementProposals().some((proposal) => proposal.id === 'legacy-invalid-proposal')).toBe(false);
    expect(modules.store.getSystemImprovementProposal('legacy-invalid-proposal')).toBeNull();
  });

  it('deletes approval-required proposals whose approval request record is missing', async () => {
    const modules = await loadModules();

    modules.store.upsertSystemImprovementProposal({
      id: 'legacy-missing-request-record',
      status: 'approval-required',
      approvalRequestId: 'missing-request-record',
      title: '旧坏态提案',
      summary: 'This demo record should be removed.',
      sourceSignalIds: ['signal-legacy'],
      evidenceRefs: [],
      affectedFiles: ['src/app/page.tsx'],
      protectedAreas: ['approval'],
      risk: 'high',
      implementationPlan: ['Implement'],
      testPlan: ['npx tsc --noEmit --pretty false'],
      rollbackPlan: ['revert patch'],
      linkedRunIds: [],
      testEvidence: [],
      createdAt: '2026-05-06T10:00:00.000Z',
      updatedAt: '2026-05-06T10:00:00.000Z',
    });

    expect(modules.store.listSystemImprovementProposals().some((proposal) => proposal.id === 'legacy-missing-request-record')).toBe(false);
    expect(modules.store.getSystemImprovementProposal('legacy-missing-request-record')).toBeNull();
  });

  it('deletes linked approval requests when a system improvement proposal is removed', async () => {
    const modules = await loadModules();
    const request = modules.approvalStore.createApprovalRequest({
      type: 'other',
      target: { kind: 'system-improvement-proposal', proposalId: 'proposal-with-linked-approval' },
      workspace: 'organization',
      title: '系统改进审批',
      description: 'cleanup linked request',
      urgency: 'high',
    });

    modules.store.upsertSystemImprovementProposal({
      id: 'proposal-with-linked-approval',
      status: 'approval-required',
      approvalRequestId: request.id,
      title: '待清理提案',
      summary: 'This proposal and its approval should be deleted together.',
      sourceSignalIds: ['signal-cleanup'],
      evidenceRefs: [],
      affectedFiles: ['src/lib/approval/dispatcher.ts'],
      protectedAreas: ['approval'],
      risk: 'high',
      implementationPlan: ['Implement'],
      testPlan: ['npx tsc --noEmit --pretty false'],
      rollbackPlan: ['revert patch'],
      linkedRunIds: [],
      testEvidence: [],
      createdAt: '2026-05-06T10:00:00.000Z',
      updatedAt: '2026-05-06T10:00:00.000Z',
    });

    modules.store.deleteSystemImprovementProposal('proposal-with-linked-approval');

    expect(modules.store.getSystemImprovementProposal('proposal-with-linked-approval')).toBeNull();
    expect(modules.approvalStore.getApprovalRequest(request.id)).toBeUndefined();
  });
});
