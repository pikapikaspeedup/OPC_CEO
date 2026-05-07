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
    platform: await import('../platform-engineering'),
    projectRegistry: await import('../agents/project-registry'),
    runRegistry: await import('../agents/run-registry'),
    runtimeState: await import('./self-improvement-runtime-state'),
    signal: await import('./self-improvement-signal'),
    planner: await import('./self-improvement-planner'),
    store: await import('./self-improvement-store'),
  };
}

describe('self-improvement runtime state', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'self-improvement-runtime-state-'));
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

  it('moves an approved proposal into testing once the platform engineering project completes', async () => {
    const modules = await loadModules();
    const workspace = modules.platform.getPlatformEngineeringWorkspaceUri();
    modules.platform.ensurePlatformEngineeringWorkspaceSkeleton();

    const project = modules.projectRegistry.createProject({
      name: 'Platform fix project',
      goal: 'Deliver a guarded scheduler fix',
      workspace,
      templateId: 'development-template-1',
    });

    const signal = modules.signal.createSystemImprovementSignal({
      source: 'runtime-error',
      title: 'Scheduler lifecycle fix',
      summary: 'The scheduler path must be repaired and verified.',
      affectedAreas: ['scheduler'],
      evidenceRefs: [{
        id: 'evidence-scheduler-runtime',
        type: 'run',
        label: 'Scheduler failure',
        runId: 'source-run-1',
        createdAt: '2026-04-30T10:00:00.000Z',
      }],
      metadata: {
        workspaceUri: workspace,
      },
    });
    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: ['src/lib/agents/scheduler.ts'],
    });
    const approved = await modules.approval.approveSystemImprovementProposal(proposal.id);

    const run = modules.runRegistry.createRun({
      stageId: 'autonomous-dev-pilot',
      workspace,
      prompt: 'Implement the guarded fix',
      projectId: project.projectId,
      templateId: 'development-template-1',
      pipelineStageId: 'autonomous-dev-pilot',
    });
    modules.projectRegistry.addRunToProject(project.projectId, run.runId);
    modules.store.patchSystemImprovementProposal(proposal.id, {
      metadata: {
        ...(approved.proposal.metadata || {}),
        improvementProjectId: project.projectId,
        improvementRunId: run.runId,
        launchStatus: 'running',
      },
    });
    modules.projectRegistry.updateProject(project.projectId, {
      status: 'completed',
    });

    modules.runRegistry.updateRun(run.runId, {
      status: 'completed',
      result: {
        status: 'completed',
        summary: 'Guarded scheduler fix implemented.',
        changedFiles: ['src/lib/agents/scheduler.ts'],
        blockers: [],
        needsReview: [],
      },
    });

    const synced = await modules.runtimeState.syncSystemImprovementProposalRuntimeState(proposal.id);
    expect(synced?.status).toBe('testing');
    expect(synced?.automationState?.status).toBe('validating');
    expect(synced?.humanGate?.state).toBe('none');
    expect(synced?.exitEvidence?.project?.projectId).toBe(project.projectId);
    expect(synced?.exitEvidence?.latestRun?.runId).toBe(run.runId);
    expect(synced?.exitEvidence?.mergeGate.deliveryReady).toBe(true);
    expect(synced?.exitEvidence?.mergeGate.testsReady).toBe(false);
  }, 15_000);

  it('moves a completed implementation to ready-to-merge after passed test evidence', async () => {
    const modules = await loadModules();
    const workspace = modules.platform.getPlatformEngineeringWorkspaceUri();
    modules.platform.ensurePlatformEngineeringWorkspaceSkeleton();

    const project = modules.projectRegistry.createProject({
      name: 'Knowledge cleanup project',
      goal: 'Complete the knowledge runtime improvement',
      workspace,
      templateId: 'development-template-1',
    });

    const signal = modules.signal.createSystemImprovementSignal({
      source: 'manual-feedback',
      title: 'Knowledge runtime cleanup',
      summary: 'Tighten the knowledge runtime path.',
      affectedAreas: ['knowledge'],
      evidenceRefs: [{
        id: 'evidence-knowledge-runtime',
        type: 'file',
        label: 'Knowledge runtime note',
        filePath: '/tmp/runtime-note.md',
        createdAt: '2026-04-30T11:00:00.000Z',
      }],
      metadata: {
        workspaceUri: workspace,
      },
    });
    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: ['src/lib/knowledge/index.ts'],
    });
    const approved = await modules.approval.approveSystemImprovementProposal(proposal.id);

    const run = modules.runRegistry.createRun({
      stageId: 'coding-basic',
      workspace,
      prompt: 'Implement the knowledge cleanup',
      projectId: project.projectId,
      templateId: 'coding-basic-template',
      pipelineStageId: 'coding-basic',
    });
    modules.projectRegistry.addRunToProject(project.projectId, run.runId);
    modules.store.patchSystemImprovementProposal(proposal.id, {
      metadata: {
        ...(approved.proposal.metadata || {}),
        improvementProjectId: project.projectId,
        improvementRunId: run.runId,
        launchStatus: 'running',
      },
    });
    modules.projectRegistry.updateProject(project.projectId, {
      status: 'completed',
    });
    modules.runRegistry.updateRun(run.runId, {
      status: 'completed',
      result: {
        status: 'completed',
        summary: 'Knowledge cleanup delivered.',
        changedFiles: ['src/lib/knowledge/index.ts'],
        blockers: [],
        needsReview: [],
      },
    });

    modules.store.attachSystemImprovementTestEvidence(proposal.id, {
      command: 'npx vitest run src/lib/knowledge/index.test.ts',
      status: 'passed',
      outputSummary: 'knowledge tests passed',
      createdAt: '2026-04-30T11:05:00.000Z',
    });

    const synced = await modules.runtimeState.syncSystemImprovementProposalRuntimeState(proposal.id);
    expect(synced?.status).toBe('ready-to-merge');
    expect(synced?.automationState?.status).toBe('validating');
    expect(synced?.humanGate?.state).toBe('none');
    expect(synced?.exitEvidence?.mergeGate.status).toBe('ready-to-merge');
    expect(synced?.exitEvidence?.mergeGate.testsReady).toBe(true);
    expect(synced?.exitEvidence?.testing.latestStatus).toBe('passed');
  });

  it('keeps preflight failures out of the CEO gate and marks automation blocked', async () => {
    const modules = await loadModules();
    const workspace = modules.platform.getPlatformEngineeringWorkspaceUri();
    modules.platform.ensurePlatformEngineeringWorkspaceSkeleton();

    const project = modules.projectRegistry.createProject({
      name: 'Release gate blocked project',
      goal: 'Exercise release gate failure handling',
      workspace,
      templateId: 'development-template-1',
    });

    const signal = modules.signal.createSystemImprovementSignal({
      source: 'manual-feedback',
      title: 'Release gate blocked',
      summary: 'Keep preflight failures out of CEO approvals.',
      affectedAreas: ['docs'],
      evidenceRefs: [{
        id: 'release-gate-blocked-evidence',
        type: 'file',
        label: 'Release gate blocked note',
        filePath: '/tmp/release-gate-blocked.md',
        createdAt: '2026-05-04T09:00:00.000Z',
      }],
      metadata: {
        workspaceUri: workspace,
      },
    });
    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: ['docs/design/release-gate-blocked.md'],
    });
    const approved = await modules.approval.approveSystemImprovementProposal(proposal.id);

    const run = modules.runRegistry.createRun({
      stageId: 'release-gate-blocked',
      workspace,
      prompt: 'Prepare release gate evidence',
      projectId: project.projectId,
      templateId: 'development-template-1',
      pipelineStageId: 'release-gate-blocked',
    });
    modules.projectRegistry.addRunToProject(project.projectId, run.runId);
    modules.store.patchSystemImprovementProposal(proposal.id, {
      metadata: {
        ...(approved.proposal.metadata || {}),
        improvementProjectId: project.projectId,
        improvementRunId: run.runId,
        launchStatus: 'delivery-complete',
        codexRunnerEvidence: {
          runId: 'codex-blocked-run',
          taskKey: proposal.id,
          branch: 'ai/release-gate-blocked',
          worktreePath: workspace,
          evidencePath: '/tmp/evidence.json',
          baseMode: 'snapshot',
          baseSha: 'base123',
          headSha: 'head123',
          changedFiles: ['docs/design/release-gate-blocked.md'],
          allowedPathPrefixes: ['docs/design/release-gate-blocked.md'],
          disallowedFiles: [],
          scopeCheckPassed: true,
          diffCheckPassed: true,
          validationCount: 2,
          passedValidationCount: 2,
          failedValidationCount: 0,
          decision: 'ready-to-merge',
          updatedAt: '2026-05-04T09:01:00.000Z',
        },
      },
      exitEvidence: {
        testing: {
          plannedCount: 1,
          evidenceCount: 1,
          passedCount: 1,
          failedCount: 0,
          latestStatus: 'passed',
          latestCommand: 'npx tsc --noEmit --pretty false',
          latestSummary: 'typecheck passed',
          latestAt: '2026-05-04T09:03:00.000Z',
        },
        mergeGate: {
          status: 'ready-to-merge',
          approvalReady: true,
          deliveryReady: true,
          testsReady: true,
          rollbackReady: true,
          reasons: [],
        },
        releaseGate: {
          status: 'preflight-failed',
          preflightStatus: 'failed',
          checks: [{
            label: 'worktree diff check',
            status: 'failed',
            detail: 'trailing whitespace',
            command: 'git diff --check',
          }],
          commands: {
            mergeCommand: 'git apply patch.diff',
            verifyCommand: 'npx tsc --noEmit --pretty false',
            restartCommand: 'npm run start',
            rollbackCommand: 'git apply -R patch.diff',
          },
          updatedAt: '2026-05-04T09:02:00.000Z',
        },
        updatedAt: '2026-05-04T09:03:00.000Z',
      },
    });
    modules.projectRegistry.updateProject(project.projectId, {
      status: 'completed',
    });
    modules.runRegistry.updateRun(run.runId, {
      status: 'completed',
      result: {
        status: 'completed',
        summary: 'Release gate evidence delivered.',
        changedFiles: ['docs/design/release-gate-blocked.md'],
        blockers: [],
        needsReview: [],
      },
    });
    modules.store.attachSystemImprovementTestEvidence(proposal.id, {
      command: 'npx tsc --noEmit --pretty false',
      status: 'passed',
      outputSummary: 'typecheck passed',
      createdAt: '2026-05-04T09:03:00.000Z',
    });

    const synced = await modules.runtimeState.syncSystemImprovementProposalRuntimeState(proposal.id);
    expect(synced?.status).toBe('testing');
    expect(synced?.automationState?.status).toBe('blocked');
    expect(synced?.humanGate?.state).toBe('none');
  });

  it('derives entry approval gate for approval-required proposals before runtime launch exists', async () => {
    const modules = await loadModules();

    const signal = modules.signal.createSystemImprovementSignal({
      source: 'user-story-gap',
      title: 'CEO approval deep link gap',
      summary: 'CEO needs URL-deep-link restore before implementation starts.',
      affectedAreas: ['frontend', 'runtime'],
      evidenceRefs: [{
        id: 'evidence-ceo-approval-gap',
        type: 'file',
        label: 'CEO user story gap',
        filePath: '/tmp/ceo-approval-gap.md',
        createdAt: '2026-05-05T09:00:00.000Z',
      }],
    });

    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: [
        'src/components/ceo-office-cockpit.tsx',
        'src/components/system-improvement-detail-drawer.tsx',
        'src/components/ceo-dashboard.tsx',
        'src/lib/api.ts',
      ],
    });

    const withApproval = await modules.approval.ensureSystemImprovementApprovalRequest(proposal.id);
    expect(withApproval.status).toBe('approval-required');
    expect(withApproval.approvalRequestId).toBeTruthy();
    expect(withApproval.metadata?.improvementProjectId).toBeUndefined();

    const synced = await modules.runtimeState.syncSystemImprovementProposalRuntimeState(proposal.id);
    expect(synced?.status).toBe('approval-required');
    expect(synced?.automationState?.status).toBe('queued');
    expect(synced?.automationState?.summary).toContain('等待准入审批');
    expect(synced?.humanGate?.state).toBe('entry-approval-required');
    expect(synced?.humanGate?.title).toContain('批准');
  });

  it('does not treat stale codex evidence alone as active runtime context', async () => {
    const modules = await loadModules();

    const signal = modules.signal.createSystemImprovementSignal({
      source: 'manual-feedback',
      title: 'Stale codex evidence',
      summary: 'Old runner evidence should not keep the proposal in executing state.',
      affectedAreas: ['docs'],
      evidenceRefs: [{
        id: 'stale-codex-evidence',
        type: 'file',
        label: 'Stale evidence note',
        filePath: '/tmp/stale-codex-evidence.md',
        createdAt: '2026-05-07T11:00:00.000Z',
      }],
    });

    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: ['docs/design/stale-codex-evidence.md'],
    });

    modules.store.patchSystemImprovementProposal(proposal.id, {
      status: 'approved',
      metadata: {
        codexRunnerEvidence: {
          runId: 'old-codex-run',
          taskKey: proposal.id,
          branch: 'ai/old-codex-run',
          worktreePath: '/tmp/old-worktree',
          evidencePath: '/tmp/old-evidence.json',
          baseMode: 'snapshot',
          baseSha: 'base123',
          headSha: 'head123',
          changedFiles: ['docs/design/stale-codex-evidence.md'],
          allowedPathPrefixes: ['docs/design/stale-codex-evidence.md'],
          disallowedFiles: [],
          scopeCheckPassed: true,
          diffCheckPassed: true,
          validationCount: 1,
          passedValidationCount: 1,
          failedValidationCount: 0,
          decision: 'ready-to-merge',
          updatedAt: '2026-05-07T11:05:00.000Z',
        },
      },
    });

    const synced = await modules.runtimeState.syncSystemImprovementProposalRuntimeState(proposal.id);
    expect(synced?.status).toBe('approved');
    expect(synced?.automationState).toBeUndefined();
    expect(synced?.humanGate).toBeUndefined();
  });

  it('does not treat stale launch metadata plus old codex evidence as active runtime context', async () => {
    const modules = await loadModules();

    const signal = modules.signal.createSystemImprovementSignal({
      source: 'manual-feedback',
      title: 'Stale launch metadata',
      summary: 'Old launch metadata should not reactivate stale runner evidence.',
      affectedAreas: ['docs'],
      evidenceRefs: [{
        id: 'stale-launch-metadata',
        type: 'file',
        label: 'Stale launch metadata note',
        filePath: '/tmp/stale-launch-metadata.md',
        createdAt: '2026-05-07T11:10:00.000Z',
      }],
    });

    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: ['docs/design/stale-launch-metadata.md'],
    });

    modules.store.patchSystemImprovementProposal(proposal.id, {
      status: 'approved',
      metadata: {
        launchStatus: 'delivery-complete',
        codexRunnerEvidence: {
          runId: 'old-codex-run',
          taskKey: proposal.id,
          branch: 'ai/old-codex-run',
          worktreePath: '/tmp/old-worktree',
          evidencePath: '/tmp/old-evidence.json',
          baseMode: 'snapshot',
          baseSha: 'base123',
          headSha: 'head123',
          changedFiles: ['docs/design/stale-launch-metadata.md'],
          allowedPathPrefixes: ['docs/design/stale-launch-metadata.md'],
          disallowedFiles: [],
          scopeCheckPassed: true,
          diffCheckPassed: true,
          validationCount: 1,
          passedValidationCount: 1,
          failedValidationCount: 0,
          decision: 'ready-to-merge',
          updatedAt: '2026-05-07T11:15:00.000Z',
        },
      },
    });

    const synced = await modules.runtimeState.syncSystemImprovementProposalRuntimeState(proposal.id);
    expect(synced?.status).toBe('approved');
    expect(synced?.automationState).toBeUndefined();
    expect(synced?.humanGate).toBeUndefined();
    expect(synced?.exitEvidence).toBeUndefined();
  });
});
