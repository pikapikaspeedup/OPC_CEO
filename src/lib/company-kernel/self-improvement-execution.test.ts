import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecuteDispatch, mockRunPlatformEngineeringCodexTask } = vi.hoisted(() => ({
  mockExecuteDispatch: vi.fn(),
  mockRunPlatformEngineeringCodexTask: vi.fn(),
}));

vi.mock('../agents/dispatch-service', () => ({
  executeDispatch: (...args: unknown[]) => mockExecuteDispatch(...args),
}));

vi.mock('../platform-engineering-codex-runner', () => ({
  runPlatformEngineeringCodexTask: (...args: unknown[]) => mockRunPlatformEngineeringCodexTask(...args),
}));

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    approval: await import('./self-improvement-approval'),
    codexExecution: await import('./self-improvement-codex-execution'),
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
    mockRunPlatformEngineeringCodexTask.mockReset();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
    vi.resetModules();
    mockExecuteDispatch.mockReset();
    mockRunPlatformEngineeringCodexTask.mockReset();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  function mockSuccessfulCodexRun(changedFiles: string[]) {
    mockRunPlatformEngineeringCodexTask.mockResolvedValue({
      worktree: {
        runId: 'codex-run-1',
        taskKey: 'system-improvement-task',
        repoPath: process.cwd(),
        worktreePath: path.join(tempHome, 'worktree'),
        branch: 'ai/platform-system-improvement-task',
        baseMode: 'snapshot',
        requestedBaseRef: 'HEAD',
        baseSha: 'abc123',
        headSha: 'abc123',
        snapshotSha: 'snapshot123',
      },
      codexOutput: 'done',
      evidence: {
        runId: 'codex-run-1',
        taskKey: 'system-improvement-task',
        baseSha: 'abc123',
        headSha: 'abc123',
        branch: 'ai/platform-system-improvement-task',
        worktreePath: path.join(tempHome, 'worktree'),
        evidencePath: path.join(tempHome, 'evidence.json'),
        changedFiles,
        disallowedFiles: [],
        scopeCheckPassed: true,
        diffCheckPassed: true,
        validations: [
          {
            command: 'git diff --check',
            passed: true,
            stdout: '',
            stderr: '',
            exitCode: 0,
          },
        ],
      },
    });
  }

  it('approves a proposal and launches Codex worktree execution for platform engineering', async () => {
    mockSuccessfulCodexRun(['src/lib/agents/scheduler.ts']);
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

    expect(result.proposal.status).toBe('ready-to-merge');
    expect(result.launch?.status).toBe('dispatched');
    expect(result.launch?.codexRunId).toBe('codex-run-1');
    expect(result.launch?.templateId).toBe('development-template-1');

    const project = modules.projectRegistry.getProject(String(result.launch?.projectId));
    expect(project?.templateId).toBe('development-template-1');
    expect(project?.workspace).toBe(modules.platform.getPlatformEngineeringWorkspaceUri());
    expect(project?.governance?.platformEngineering?.source).toBe('proposal-created');

    expect(mockRunPlatformEngineeringCodexTask).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: process.cwd(),
      taskKey: proposal.id,
      prompt: expect.stringContaining(`Proposal ID: ${proposal.id}`),
      allowedPathPrefixes: ['src/lib/agents/scheduler.ts'],
      expectEdits: true,
    }));
    expect(mockExecuteDispatch).not.toHaveBeenCalled();

    const stored = modules.store.getSystemImprovementProposal(proposal.id);
    expect(stored?.metadata?.improvementProjectId).toBe(result.launch?.projectId);
    expect(stored?.metadata?.codexRunId).toBe('codex-run-1');
    expect(stored?.exitEvidence?.codex?.runId).toBe('codex-run-1');
    expect(stored?.exitEvidence?.mergeGate.status).toBe('ready-to-merge');
    expect(stored?.linkedRunIds).toContain(String(result.launch?.runId));
    expect(stored?.linkedRunIds).toContain('run-source-1');
  });

  it('does not run Codex twice after runner evidence already exists', async () => {
    mockSuccessfulCodexRun(['src/lib/knowledge/index.ts']);
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

    mockRunPlatformEngineeringCodexTask.mockClear();

    const second = await modules.codexExecution.runApprovedSystemImprovementCodexTask(proposal.id);
    expect(second.launch.status).toBe('already-running');
    expect(second.launch.codexRunId).toBe('codex-run-1');
    expect(mockRunPlatformEngineeringCodexTask).not.toHaveBeenCalled();
  });
});
