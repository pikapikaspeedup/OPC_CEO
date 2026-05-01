import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecuteDispatch } = vi.hoisted(() => ({
  mockExecuteDispatch: vi.fn(),
}));

vi.mock('../agents/dispatch-service', () => ({
  executeDispatch: (...args: unknown[]) => mockExecuteDispatch(...args),
}));

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    approval: await import('./self-improvement-approval'),
    execution: await import('./self-improvement-execution'),
    planner: await import('./self-improvement-planner'),
    platform: await import('../platform-engineering'),
    projectRegistry: await import('../agents/project-registry'),
    signal: await import('./self-improvement-signal'),
    store: await import('./self-improvement-store'),
  };
}

describe('self-improvement execution', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'self-improvement-execution-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.HOME = tempHome;
    process.env.AG_GATEWAY_HOME = path.join(tempHome, 'gateway-home');
    mockExecuteDispatch.mockReset();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
    vi.resetModules();
    mockExecuteDispatch.mockReset();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('approves a proposal and launches a platform engineering project', async () => {
    mockExecuteDispatch.mockResolvedValue({ runId: 'run-improvement-1' });
    const modules = await loadModules();
    modules.platform.ensurePlatformEngineeringWorkspaceSkeleton();

    const signal = modules.signal.createSystemImprovementSignal({
      source: 'runtime-error',
      title: 'Scheduler hardening proposal',
      summary: 'A protected-core scheduler path failed and needs a guarded fix.',
      affectedAreas: ['scheduler'],
      evidenceRefs: [{
        id: 'evidence-runtime-failure',
        type: 'run',
        label: 'Failed scheduler run',
        runId: 'run-source-1',
        createdAt: '2026-04-30T08:00:00.000Z',
      }],
      metadata: {
        workspaceUri: modules.platform.getPlatformEngineeringWorkspaceUri(),
      },
    });

    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: ['src/lib/agents/scheduler.ts'],
      linkedRunIds: ['run-source-1'],
    });

    const result = await modules.approval.approveSystemImprovementProposal(proposal.id, {
      launchExecution: true,
    });

    expect(result.proposal.status).toBe('in-progress');
    expect(result.launch?.status).toBe('dispatched');
    expect(result.launch?.runId).toBe('run-improvement-1');
    expect(result.launch?.templateId).toBe('development-template-1');

    const project = modules.projectRegistry.getProject(String(result.launch?.projectId));
    expect(project?.templateId).toBe('development-template-1');
    expect(project?.workspace).toBe(modules.platform.getPlatformEngineeringWorkspaceUri());
    expect(project?.governance?.platformEngineering?.source).toBe('proposal-created');

    expect(mockExecuteDispatch).toHaveBeenCalledWith(expect.objectContaining({
      workspace: modules.platform.getPlatformEngineeringWorkspaceUri(),
      projectId: result.launch?.projectId,
      templateId: 'development-template-1',
      prompt: expect.stringContaining(`Proposal ID: ${proposal.id}`),
      taskEnvelope: expect.objectContaining({
        proposalId: proposal.id,
        proposalRisk: 'high',
      }),
    }));

    const stored = modules.store.getSystemImprovementProposal(proposal.id);
    expect(stored?.metadata?.improvementProjectId).toBe(result.launch?.projectId);
    expect(stored?.metadata?.improvementRunId).toBe('run-improvement-1');
    expect(stored?.linkedRunIds).toContain('run-improvement-1');
    expect(stored?.linkedRunIds).toContain('run-source-1');
  });

  it('does not dispatch twice after a proposal is already in progress', async () => {
    mockExecuteDispatch.mockResolvedValue({ runId: 'run-improvement-2' });
    const modules = await loadModules();
    modules.platform.ensurePlatformEngineeringWorkspaceSkeleton();

    const signal = modules.signal.createSystemImprovementSignal({
      source: 'manual-feedback',
      title: 'Knowledge indexing cleanup',
      summary: 'Refine the knowledge path safely.',
      affectedAreas: ['knowledge'],
      evidenceRefs: [{
        id: 'evidence-knowledge-gap',
        type: 'file',
        label: 'Knowledge note',
        filePath: '/tmp/example.md',
        createdAt: '2026-04-30T09:00:00.000Z',
      }],
      metadata: {
        workspaceUri: modules.platform.getPlatformEngineeringWorkspaceUri(),
      },
    });

    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: ['src/lib/knowledge/index.ts'],
    });

    const first = await modules.approval.approveSystemImprovementProposal(proposal.id, {
      launchExecution: true,
    });
    expect(first.launch?.status).toBe('dispatched');

    mockExecuteDispatch.mockClear();

    const second = await modules.execution.ensureSystemImprovementProjectLaunched(proposal.id);
    expect(second.launch.status).toBe('already-running');
    expect(second.launch.runId).toBe('run-improvement-2');
    expect(mockExecuteDispatch).not.toHaveBeenCalled();
  });
});
