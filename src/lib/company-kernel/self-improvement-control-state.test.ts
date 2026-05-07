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
    approvalStore: await import('../approval/request-store'),
    controlState: await import('./self-improvement-control-state'),
  };
}

function baseProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proposal-1',
    status: 'approved',
    title: 'System improvement: sample',
    summary: 'Improve the system improvement control plane.',
    sourceSignalIds: ['signal-1'],
    evidenceRefs: [],
    affectedFiles: ['src/lib/sample.ts'],
    protectedAreas: [],
    risk: 'medium',
    implementationPlan: ['Implement change'],
    testPlan: ['npx vitest run sample'],
    rollbackPlan: ['git apply -R patch.diff'],
    linkedRunIds: [],
    testEvidence: [],
    createdAt: '2026-05-05T10:00:00.000Z',
    updatedAt: '2026-05-05T10:00:00.000Z',
    ...overrides,
  };
}

function baseExitEvidence(overrides: Record<string, unknown> = {}) {
  return {
    testing: {
      plannedCount: 1,
      evidenceCount: 1,
      passedCount: 1,
      failedCount: 0,
      latestStatus: 'passed',
      latestCommand: 'npx vitest run sample',
      latestSummary: 'passed',
      latestAt: '2026-05-05T10:05:00.000Z',
    },
    mergeGate: {
      status: 'ready-to-merge',
      approvalReady: true,
      deliveryReady: true,
      testsReady: true,
      rollbackReady: true,
      reasons: [],
    },
    updatedAt: '2026-05-05T10:05:00.000Z',
    ...overrides,
  };
}

describe('self-improvement control state', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'self-improvement-control-state-'));
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

  it('maps lifecycle facts to the canonical control stages', async () => {
    const { controlState } = await loadModules();
    const cases = [
      {
        proposal: baseProposal({
          status: 'approval-required',
          humanGate: {
            state: 'entry-approval-required',
            title: '等待准入',
            summary: '等待 CEO',
            updatedAt: '2026-05-05T10:00:00.000Z',
          },
        }),
        stage: 'entry-review',
        owner: 'ceo',
        nextAction: 'approve-entry',
        pageMode: 'entry-review',
      },
      {
        proposal: baseProposal({
          status: 'in-progress',
          automationState: {
            status: 'executing',
            summary: 'AI executing',
            updatedAt: '2026-05-05T10:00:00.000Z',
          },
        }),
        stage: 'ai-executing',
        owner: 'ai',
        nextAction: 'none',
        pageMode: 'progress',
      },
      {
        proposal: baseProposal({
          status: 'ready-to-merge',
          automationState: {
            status: 'validating',
            summary: 'AI validating',
            updatedAt: '2026-05-05T10:00:00.000Z',
          },
          exitEvidence: baseExitEvidence(),
        }),
        stage: 'ai-preflight',
        owner: 'ai',
        nextAction: 'run-preflight',
        pageMode: 'progress',
      },
      {
        proposal: baseProposal({
          status: 'ready-to-merge',
          humanGate: {
            state: 'exit-approval-required',
            title: '等待准出',
            summary: '等待 CEO',
            updatedAt: '2026-05-05T10:00:00.000Z',
          },
          exitEvidence: baseExitEvidence({
            releaseGate: {
              status: 'ready-for-approval',
              preflightStatus: 'passed',
              checks: [],
              commands: {
                mergeCommand: 'git apply patch.diff',
                verifyCommand: 'npx vitest run sample',
                restartCommand: 'npm run start',
                rollbackCommand: 'git apply -R patch.diff',
              },
              updatedAt: '2026-05-05T10:06:00.000Z',
            },
          }),
        }),
        stage: 'exit-review',
        owner: 'ceo',
        nextAction: 'approve-exit',
        pageMode: 'exit-review',
      },
      {
        proposal: baseProposal({
          exitEvidence: baseExitEvidence({
            releaseGate: {
              status: 'approved',
              preflightStatus: 'passed',
              checks: [],
              commands: {
                mergeCommand: 'git apply patch.diff',
                verifyCommand: 'npx vitest run sample',
                restartCommand: 'npm run start',
                rollbackCommand: 'git apply -R patch.diff',
              },
              approvedAt: '2026-05-05T10:07:00.000Z',
              approvedBy: 'CEO',
              updatedAt: '2026-05-05T10:07:00.000Z',
            },
          }),
        }),
        stage: 'ops-merge',
        owner: 'ops',
        nextAction: 'mark-merged',
        pageMode: 'progress',
      },
      {
        proposal: baseProposal({
          exitEvidence: baseExitEvidence({
            releaseGate: {
              status: 'merged',
              preflightStatus: 'passed',
              checks: [],
              commands: {
                mergeCommand: 'git apply patch.diff',
                verifyCommand: 'npx vitest run sample',
                restartCommand: 'npm run start',
                rollbackCommand: 'git apply -R patch.diff',
              },
              mergedAt: '2026-05-05T10:08:00.000Z',
              updatedAt: '2026-05-05T10:08:00.000Z',
            },
          }),
        }),
        stage: 'ops-restart',
        owner: 'ops',
        nextAction: 'mark-restarted',
        pageMode: 'progress',
      },
      {
        proposal: baseProposal({
          status: 'published',
          exitEvidence: baseExitEvidence({
            releaseGate: {
              status: 'restarted',
              preflightStatus: 'passed',
              checks: [],
              commands: {
                mergeCommand: 'git apply patch.diff',
                verifyCommand: 'npx vitest run sample',
                restartCommand: 'npm run start',
                rollbackCommand: 'git apply -R patch.diff',
              },
              restartedAt: '2026-05-05T10:09:00.000Z',
              updatedAt: '2026-05-05T10:09:00.000Z',
            },
          }),
        }),
        stage: 'published',
        owner: 'ops',
        nextAction: 'start-observation',
        pageMode: 'progress',
      },
      {
        proposal: baseProposal({
          status: 'observing',
          exitEvidence: baseExitEvidence({
            releaseGate: {
              status: 'observing',
              preflightStatus: 'passed',
              checks: [],
              commands: {
                mergeCommand: 'git apply patch.diff',
                verifyCommand: 'npx vitest run sample',
                restartCommand: 'npm run start',
                rollbackCommand: 'git apply -R patch.diff',
              },
              observingAt: '2026-05-05T10:10:00.000Z',
              observationSummary: 'Watching release health',
              updatedAt: '2026-05-05T10:10:00.000Z',
            },
          }),
        }),
        stage: 'observing',
        owner: 'ops',
        nextAction: 'none',
        pageMode: 'progress',
      },
      {
        proposal: baseProposal({
          status: 'rolled-back',
          exitEvidence: baseExitEvidence({
            releaseGate: {
              status: 'rolled-back',
              preflightStatus: 'passed',
              checks: [],
              commands: {
                mergeCommand: 'git apply patch.diff',
                verifyCommand: 'npx vitest run sample',
                restartCommand: 'npm run start',
                rollbackCommand: 'git apply -R patch.diff',
              },
              rolledBackAt: '2026-05-05T10:11:00.000Z',
              rollbackReason: 'Rollback',
              updatedAt: '2026-05-05T10:11:00.000Z',
            },
          }),
        }),
        stage: 'rolled-back',
        owner: 'none',
        nextAction: 'none',
        pageMode: 'progress',
      },
      {
        proposal: baseProposal({
          status: 'testing',
          automationState: {
            status: 'blocked',
            summary: 'Blocked',
            updatedAt: '2026-05-05T10:00:00.000Z',
          },
          exitEvidence: baseExitEvidence({
            releaseGate: {
              status: 'preflight-failed',
              preflightStatus: 'failed',
              remediationStatus: 'failed',
              remediationAttempts: 1,
              remediationSummary: 'Still blocked',
              checks: [],
              commands: {
                mergeCommand: 'git apply patch.diff',
                verifyCommand: 'npx vitest run sample',
                restartCommand: 'npm run start',
                rollbackCommand: 'git apply -R patch.diff',
              },
              updatedAt: '2026-05-05T10:12:00.000Z',
            },
          }),
        }),
        stage: 'blocked',
        owner: 'ai',
        nextAction: 'resolve-blocker',
        pageMode: 'progress',
      },
    ] as const;

    for (const testCase of cases) {
      const view = controlState.buildSystemImprovementProposalView(testCase.proposal as never);
      expect(view.controlState.stage).toBe(testCase.stage);
      expect(view.controlState.currentOwner).toBe(testCase.owner);
      expect(view.controlState.nextAction).toBe(testCase.nextAction);
      expect(view.controlState.pageMode).toBe(testCase.pageMode);
      expect(view.controlState.milestones).toHaveLength(7);
      expect(view.controlState.headline.length).toBeGreaterThan(0);
      expect(view.controlState.subline.length).toBeGreaterThan(0);
    }
  });

  it('aggregates entry approval facts into the proposal view', async () => {
    const { approvalStore, controlState } = await loadModules();
    const request = approvalStore.createApprovalRequest({
      type: 'other',
      target: { kind: 'system-improvement-proposal', proposalId: 'proposal-1' },
      workspace: 'organization',
      title: '系统改进审批',
      description: 'Need CEO approval',
      urgency: 'high',
    });
    approvalStore.respondToRequest(request.id, {
      action: 'approved',
      message: 'Approved for execution',
      respondedAt: '2026-05-05T10:15:00.000Z',
      channel: 'web',
    });

    const view = controlState.buildSystemImprovementProposalView(baseProposal({
      approvalRequestId: request.id,
      status: 'approved',
    }) as never);

    expect(view.entryApprovalSummary).toEqual({
      requestId: request.id,
      status: 'approved',
      actedBy: 'CEO',
      actedAt: '2026-05-05T10:15:00.000Z',
      message: 'Approved for execution',
    });
  });

  it('prefers persisted approval facts over missing approval requests', async () => {
    const { controlState } = await loadModules();

    const view = controlState.buildSystemImprovementProposalView(baseProposal({
      approvalRequestId: 'missing-request',
      status: 'testing',
      metadata: {
        approvalStatus: 'approved',
        approvedAt: '2026-05-05T10:15:00.000Z',
        approvedBy: 'ceo',
      },
      automationState: {
        status: 'blocked',
        summary: 'Blocked',
        updatedAt: '2026-05-05T10:16:00.000Z',
      },
      exitEvidence: baseExitEvidence({
        releaseGate: {
          status: 'preflight-failed',
          preflightStatus: 'failed',
          remediationStatus: 'failed',
          remediationAttempts: 1,
          remediationSummary: 'Still blocked',
          checks: [],
          commands: {
            mergeCommand: 'git apply patch.diff',
            verifyCommand: 'npx vitest run sample',
            restartCommand: 'npm run start',
            rollbackCommand: 'git apply -R patch.diff',
          },
          updatedAt: '2026-05-05T10:16:00.000Z',
        },
      }),
    }) as never);

    expect(view.entryApprovalSummary).toEqual({
      requestId: 'missing-request',
      status: 'approved',
      actedBy: 'ceo',
      actedAt: '2026-05-05T10:15:00.000Z',
    });
    expect(view.controlState.stage).toBe('blocked');
    expect(view.controlState.currentOwner).toBe('ai');
    expect(view.controlState.nextAction).toBe('resolve-blocker');
  });

  it('derives rejected approval facts when stale approval requests are gone', async () => {
    const { controlState } = await loadModules();

    const view = controlState.buildSystemImprovementProposalView(baseProposal({
      approvalRequestId: 'missing-request',
      status: 'rejected',
      metadata: {
        rejectedReason: 'Superseded by landed change.',
      },
    }) as never);

    expect(view.entryApprovalSummary).toEqual({
      requestId: 'missing-request',
      status: 'rejected',
      message: 'Superseded by landed change.',
    });
    expect(view.controlState.stage).toBe('blocked');
    expect(view.controlState.currentOwner).toBe('none');
    expect(view.controlState.nextAction).toBe('none');
    expect(view.controlState.headline).toBe('该改进已被拒绝');
  });

  it('treats rejected approval facts as terminal even if proposal status stayed approval-required', async () => {
    const { approvalStore, controlState } = await loadModules();

    const request = approvalStore.createApprovalRequest({
      type: 'other',
      target: { kind: 'system-improvement-proposal', proposalId: 'proposal-rejected-entry' },
      workspace: 'organization',
      title: '系统改进审批',
      description: 'Need approval',
      urgency: 'high',
    });
    approvalStore.respondToRequest(request.id, {
      action: 'rejected',
      message: 'Declined by CEO.',
      respondedAt: '2026-05-06T10:20:00.000Z',
      channel: 'web',
    });

    const view = controlState.buildSystemImprovementProposalView(baseProposal({
      approvalRequestId: request.id,
      status: 'approval-required',
      humanGate: {
        state: 'entry-approval-required',
        title: '等待 CEO 准入审批',
        summary: '等待 CEO',
        updatedAt: '2026-05-06T10:19:00.000Z',
      },
    }) as never);

    expect(view.entryApprovalSummary).toEqual({
      requestId: request.id,
      status: 'rejected',
      actedBy: 'CEO',
      actedAt: '2026-05-06T10:20:00.000Z',
      message: 'Declined by CEO.',
    });
    expect(view.controlState.stage).toBe('blocked');
    expect(view.controlState.currentOwner).toBe('none');
    expect(view.controlState.nextAction).toBe('none');
    expect(view.controlState.headline).toBe('该改进已被拒绝');
  });

  it('keeps the original approved entry fact when a later obsolete closure rejects the proposal', async () => {
    const { controlState } = await loadModules();

    const view = controlState.buildSystemImprovementProposalView(baseProposal({
      approvalRequestId: 'missing-request',
      status: 'rejected',
      metadata: {
        approvalStatus: 'approved',
        approvedAt: '2026-05-05T10:15:00.000Z',
        approvedBy: 'ceo',
        rejectedReason: 'Superseded by landed change.',
      },
    }) as never);

    expect(view.entryApprovalSummary).toEqual({
      requestId: 'missing-request',
      status: 'approved',
      actedBy: 'ceo',
      actedAt: '2026-05-05T10:15:00.000Z',
    });
    expect(view.controlState.headline).toBe('该改进已被拒绝');
  });
});
