import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'node:child_process';
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
    projectRegistry: await import('../agents/project-registry'),
    runRegistry: await import('../agents/run-registry'),
    approval: await import('./self-improvement-approval'),
    codexExecution: await import('./self-improvement-codex-execution'),
    execution: await import('./self-improvement-execution'),
    planner: await import('./self-improvement-planner'),
    platform: await import('../platform-engineering'),
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

  function createRepoSnapshot(changedFiles: string[]) {
    const worktreePath = path.join(tempHome, `worktree-${Date.now().toString(36)}`);
    fs.mkdirSync(worktreePath, { recursive: true });
    execFileSync('git', ['init'], {
      cwd: worktreePath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync('git', ['config', 'user.email', 'platform-engineering@local'], {
      cwd: worktreePath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync('git', ['config', 'user.name', 'Platform Engineering'], {
      cwd: worktreePath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    fs.writeFileSync(path.join(worktreePath, 'README.md'), '# fixture\n', 'utf-8');
    execFileSync('git', ['add', 'README.md'], {
      cwd: worktreePath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync('git', ['commit', '-m', 'base'], {
      cwd: worktreePath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    changedFiles.forEach((relativePath, index) => {
      const absolutePath = path.join(worktreePath, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      const marker = relativePath.endsWith('.md')
        ? `# Self-improvement execution smoke ${index}\n`
        : `// self-improvement execution smoke ${index}\n`;
      fs.writeFileSync(absolutePath, marker, 'utf-8');
    });
    return worktreePath;
  }

  function mockSuccessfulCodexRun(changedFiles: string[]) {
    const worktreePath = createRepoSnapshot(changedFiles);
    const evidencePath = path.join(tempHome, 'evidence.json');
    fs.writeFileSync(evidencePath, JSON.stringify({ ok: true }), 'utf-8');
    mockRunPlatformEngineeringCodexTask.mockResolvedValue(buildSuccessfulCodexRunResult(changedFiles, worktreePath, evidencePath));
  }

  function buildSuccessfulCodexRunResult(changedFiles: string[], worktreePath: string, evidencePath: string) {
    return {
      worktree: {
        runId: 'codex-run-1',
        taskKey: 'system-improvement-task',
        repoPath: process.cwd(),
        worktreePath,
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
        worktreePath,
        evidencePath,
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
    };
  }

  it('approves a proposal, auto-runs preflight, and leaves the proposal waiting for exit review', async () => {
    mockSuccessfulCodexRun(['docs/design/self-evolution/execution-smoke.md']);
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
      affectedFiles: ['docs/design/self-evolution/execution-smoke.md'],
      linkedRunIds: ['run-source-1'],
    });

    const result = await modules.approval.approveSystemImprovementProposal(proposal.id, {
      launchExecution: true,
    });

    expect(result.proposal.status).toBe('ready-to-merge');
    expect(result.launch?.status).toBe('dispatched');
    expect(result.launch?.codexRunId).toBe('codex-run-1');
    expect(result.launch?.templateId).toBe('development-template-1');
    expect(result.proposal.humanGate?.state).toBe('exit-approval-required');
    expect(result.proposal.exitEvidence?.releaseGate?.status).toBe('ready-for-approval');
    expect(result.proposal.exitEvidence?.releaseGate?.preflightStatus).toBe('passed');

    const project = modules.projectRegistry.getProject(String(result.launch?.projectId));
    expect(project?.templateId).toBe('development-template-1');
    expect(project?.workspace).toBe(modules.platform.getPlatformEngineeringWorkspaceUri());
    expect(project?.governance?.platformEngineering?.source).toBe('proposal-created');

    expect(mockRunPlatformEngineeringCodexTask).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: process.cwd(),
      taskKey: proposal.id,
      prompt: expect.stringContaining(`Proposal ID: ${proposal.id}`),
      allowedPathPrefixes: ['docs/design/self-evolution/execution-smoke.md'],
      expectEdits: true,
    }));
    expect(mockExecuteDispatch).not.toHaveBeenCalled();

    const stored = modules.store.getSystemImprovementProposal(proposal.id);
    expect(stored?.metadata?.improvementProjectId).toBe(result.launch?.projectId);
    expect(stored?.metadata?.codexRunId).toBe('codex-run-1');
    expect(stored?.exitEvidence?.codex?.runId).toBe('codex-run-1');
    expect(stored?.exitEvidence?.mergeGate.status).toBe('ready-to-merge');
    expect(stored?.exitEvidence?.releaseGate?.status).toBe('ready-for-approval');
    expect(stored?.linkedRunIds).toContain(String(result.launch?.runId));
    expect(stored?.linkedRunIds).toContain('run-source-1');
  }, 20_000);

  it('does not treat old runner evidence as an active execution on rerun', async () => {
    mockSuccessfulCodexRun(['docs/design/self-evolution/execution-smoke-second.md']);
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
      affectedFiles: ['docs/design/self-evolution/execution-smoke-second.md'],
    });

    const first = await modules.approval.approveSystemImprovementProposal(proposal.id, {
      launchExecution: true,
    });
    expect(first.launch?.status).toBe('dispatched');

    mockRunPlatformEngineeringCodexTask.mockClear();
    mockSuccessfulCodexRun(['docs/design/self-evolution/execution-smoke-second.md']);

    const second = await modules.codexExecution.runApprovedSystemImprovementCodexTask(proposal.id);
    expect(second.launch.status).toBe('dispatched');
    expect(mockRunPlatformEngineeringCodexTask).toHaveBeenCalledTimes(1);
  });

  it('dispatches Codex execution in the background without blocking approval flow', async () => {
    let resolveRun: ((value: ReturnType<typeof buildSuccessfulCodexRunResult>) => void) | null = null;
    const worktreePath = createRepoSnapshot(['docs/design/self-evolution/execution-async-smoke.md']);
    const evidencePath = path.join(tempHome, 'async-evidence.json');
    fs.writeFileSync(evidencePath, JSON.stringify({ ok: true }), 'utf-8');
    mockRunPlatformEngineeringCodexTask.mockImplementation(() => new Promise((resolve) => {
      resolveRun = resolve;
    }));

    const modules = await loadModules();
    modules.platform.ensurePlatformEngineeringWorkspaceSkeleton();

    const signal = modules.signal.createSystemImprovementSignal({
      source: 'runtime-error',
      title: 'Async approval dispatch proposal',
      summary: 'Approval should return before Codex runner finishes.',
      affectedAreas: ['runtime'],
      evidenceRefs: [{
        id: 'evidence-async-runtime-failure',
        type: 'run',
        label: 'Failed runtime run',
        runId: 'run-async-source-1',
        createdAt: '2026-05-06T10:00:00.000Z',
      }],
      metadata: {
        workspaceUri: modules.platform.getPlatformEngineeringWorkspaceUri(),
      },
    });

    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: ['docs/design/self-evolution/execution-async-smoke.md'],
      linkedRunIds: ['run-async-source-1'],
    });

    const dispatched = await modules.approval.approveSystemImprovementProposal(proposal.id, {
      launchExecution: true,
      waitForExecution: false,
    });

    expect(dispatched.launch?.status).toBe('dispatched');
    expect(dispatched.proposal.status).toBe('in-progress');
    expect(dispatched.proposal.automationState?.status).toBe('executing');
    expect(dispatched.proposal.humanGate?.state).toBe('none');
    expect(dispatched.proposal.exitEvidence?.latestRun?.status).toBe('running');
    expect(mockRunPlatformEngineeringCodexTask).toHaveBeenCalledTimes(1);
    expect(resolveRun).toBeTruthy();

    resolveRun?.(buildSuccessfulCodexRunResult(
      ['docs/design/self-evolution/execution-async-smoke.md'],
      worktreePath,
      evidencePath,
    ));

    await vi.waitFor(() => {
      expect(modules.store.getSystemImprovementProposal(proposal.id)?.status).toBe('ready-to-merge');
    }, { timeout: 20_000 });
  }, 20_000);

  it('cancels an active Codex execution and does not let late completion overwrite terminal state', async () => {
    let resolveRun: ((value: ReturnType<typeof buildSuccessfulCodexRunResult>) => void) | null = null;
    const handleCancel = vi.fn();
    const worktreePath = createRepoSnapshot(['docs/design/self-evolution/execution-cancel-smoke.md']);
    const evidencePath = path.join(tempHome, 'cancel-evidence.json');
    fs.writeFileSync(evidencePath, JSON.stringify({ ok: true }), 'utf-8');
    mockRunPlatformEngineeringCodexTask.mockImplementation((input: { onCodexExecHandle?: (handle: unknown) => void }) => {
      input.onCodexExecHandle?.({
        pid: 5150,
        cancel: handleCancel,
        completion: Promise.resolve('done'),
      });
      return new Promise((resolve) => {
        resolveRun = resolve;
      });
    });

    const modules = await loadModules();
    modules.platform.ensurePlatformEngineeringWorkspaceSkeleton();

    const signal = modules.signal.createSystemImprovementSignal({
      source: 'runtime-error',
      title: 'Cancelable proposal',
      summary: 'Codex execution should be cancellable.',
      affectedAreas: ['runtime'],
      evidenceRefs: [{
        id: 'evidence-cancel-runtime',
        type: 'run',
        label: 'Runtime failure',
        runId: 'run-cancel-source-1',
        createdAt: '2026-05-07T10:00:00.000Z',
      }],
      metadata: {
        workspaceUri: modules.platform.getPlatformEngineeringWorkspaceUri(),
      },
    });

    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: ['docs/design/self-evolution/execution-cancel-smoke.md'],
      linkedRunIds: ['run-cancel-source-1'],
    });

    const dispatched = await modules.approval.approveSystemImprovementProposal(proposal.id, {
      launchExecution: true,
      waitForExecution: false,
    });

    expect(dispatched.launch?.runId).toBeTruthy();

    await modules.codexExecution.cancelSystemImprovementCodexRun(String(dispatched.launch?.runId));
    expect(handleCancel).toHaveBeenCalledWith('cancelled_by_user');

    resolveRun?.(buildSuccessfulCodexRunResult(
      ['docs/design/self-evolution/execution-cancel-smoke.md'],
      worktreePath,
      evidencePath,
    ));

    await vi.waitFor(() => {
      const latest = modules.store.getSystemImprovementProposal(proposal.id);
      expect(latest?.automationState?.status).toBe('blocked');
    }, { timeout: 20_000 });

    const latestRun = modules.runRegistry.getRun(String(dispatched.launch?.runId));
    const latestProject = modules.projectRegistry.getProject(String(dispatched.launch?.projectId));
    const latestProposal = modules.store.getSystemImprovementProposal(proposal.id);

    expect(latestRun?.status).toBe('cancelled');
    expect(latestProject?.status).toBe('cancelled');
    expect(latestProposal?.automationState?.status).toBe('blocked');
    expect(latestProposal?.exitEvidence?.latestRun?.status).toBe('cancelled');
    expect(latestProposal?.metadata?.codexRunnerEvidence).toBeUndefined();
  }, 20_000);

  it('backfills system improvement governance when reusing an existing tracking project', async () => {
    mockRunPlatformEngineeringCodexTask.mockImplementation(async () => {
      const worktreePath = createRepoSnapshot(['docs/design/self-evolution/governance-backfill-smoke.md']);
      const evidencePath = path.join(tempHome, 'governance-backfill-evidence.json');
      fs.writeFileSync(evidencePath, JSON.stringify({ ok: true }), 'utf-8');
      return buildSuccessfulCodexRunResult(
        ['docs/design/self-evolution/governance-backfill-smoke.md'],
        worktreePath,
        evidencePath,
      );
    });

    const modules = await loadModules();
    modules.platform.ensurePlatformEngineeringWorkspaceSkeleton();

    const signal = modules.signal.createSystemImprovementSignal({
      source: 'runtime-error',
      title: 'Governance backfill proposal',
      summary: 'Existing tracking projects should keep the proposal source fact.',
      affectedAreas: ['runtime'],
      evidenceRefs: [{
        id: 'evidence-governance-backfill',
        type: 'run',
        label: 'Runtime signal',
        runId: 'run-governance-backfill-1',
        createdAt: '2026-05-07T10:30:00.000Z',
      }],
      metadata: {
        workspaceUri: modules.platform.getPlatformEngineeringWorkspaceUri(),
      },
    });

    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: ['src/lib/company-kernel/self-improvement-runtime-state.ts'],
      linkedRunIds: ['run-governance-backfill-1'],
    });

    const existingProject = modules.projectRegistry.createProject({
      name: 'Legacy tracking project',
      goal: 'Legacy tracking goal',
      workspace: modules.platform.getPlatformEngineeringWorkspaceUri(),
      templateId: 'development-template-1',
      projectType: 'strategic',
      governance: {
        platformEngineering: {
          observe: true,
          allowProposal: true,
          departmentId: 'department:platform-engineering',
          source: 'proposal-created',
          updatedAt: '2026-05-07T10:31:00.000Z',
        },
      },
    });

    modules.store.patchSystemImprovementProposal(proposal.id, {
      metadata: {
        ...(proposal.metadata || {}),
        improvementProjectId: existingProject.projectId,
      },
    });

    const dispatched = await modules.approval.approveSystemImprovementProposal(proposal.id, {
      launchExecution: true,
      waitForExecution: false,
    });

    expect(dispatched.launch?.projectId).toBe(existingProject.projectId);
    const reusedProject = modules.projectRegistry.getProject(existingProject.projectId);
    expect(reusedProject?.governance?.platformEngineering?.systemImprovementProposalId).toBe(proposal.id);
  }, 20_000);
});
