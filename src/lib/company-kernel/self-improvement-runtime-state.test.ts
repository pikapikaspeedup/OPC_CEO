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
    expect(synced?.exitEvidence?.mergeGate.status).toBe('ready-to-merge');
    expect(synced?.exitEvidence?.mergeGate.testsReady).toBe(true);
    expect(synced?.exitEvidence?.testing.latestStatus).toBe('passed');
  });
});
