import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;
let previousCwd: string;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    approval: await import('./self-improvement-approval'),
    planner: await import('./self-improvement-planner'),
    releaseGate: await import('./self-improvement-release-gate'),
    signal: await import('./self-improvement-signal'),
    store: await import('./self-improvement-store'),
  };
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function createWorktreeWithChange(relativePath: string, content = '# Release gate smoke\n'): string {
  const worktreePath = path.join(
    tempHome,
    `codex-worktree-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  );
  fs.mkdirSync(path.join(worktreePath, path.dirname(relativePath)), { recursive: true });
  runGit(worktreePath, ['init']);
  runGit(worktreePath, ['config', 'user.email', 'platform-engineering@local']);
  runGit(worktreePath, ['config', 'user.name', 'Platform Engineering']);
  fs.writeFileSync(path.join(worktreePath, 'README.md'), '# fixture\n', 'utf-8');
  runGit(worktreePath, ['add', 'README.md']);
  runGit(worktreePath, ['commit', '-m', 'base']);
  fs.writeFileSync(path.join(worktreePath, relativePath), content, 'utf-8');
  return worktreePath;
}

function createMainRepoFixture(relativePath: string, content: string): string {
  const repoPath = path.join(tempHome, 'main-repo');
  fs.mkdirSync(path.join(repoPath, path.dirname(relativePath)), { recursive: true });
  runGit(repoPath, ['init']);
  runGit(repoPath, ['config', 'user.email', 'platform-engineering@local']);
  runGit(repoPath, ['config', 'user.name', 'Platform Engineering']);
  fs.writeFileSync(path.join(repoPath, relativePath), content, 'utf-8');
  runGit(repoPath, ['add', relativePath]);
  runGit(repoPath, ['commit', '-m', 'base']);
  return repoPath;
}

function createWorktreeFromRepo(repoPath: string, relativePath: string, content: string): string {
  const worktreePath = path.join(
    tempHome,
    `repo-based-worktree-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  );
  execFileSync('git', ['clone', repoPath, worktreePath], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  fs.writeFileSync(path.join(worktreePath, relativePath), content, 'utf-8');
  return worktreePath;
}

describe('self-improvement release gate', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'self-improvement-release-gate-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    previousCwd = process.cwd();
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
    process.chdir(previousCwd);
    vi.doUnmock('./self-improvement-codex-execution');
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  async function createReadyProposal() {
    const modules = await loadModules();
    const relativePath = `docs/design/self-evolution/release-gate-smoke-${Date.now().toString(36)}.md`;
    const worktreePath = createWorktreeWithChange(relativePath);
    const signal = modules.signal.createSystemImprovementSignal({
      source: 'manual-feedback',
      title: 'Release gate smoke proposal',
      summary: 'Exercise the software self-evolution release gate.',
      affectedAreas: ['docs'],
      evidenceRefs: [{
        id: 'release-gate-smoke-evidence',
        type: 'file',
        label: 'Release gate smoke',
        filePath: relativePath,
        createdAt: '2026-05-01T10:00:00.000Z',
      }],
    });
    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: [relativePath],
    });
    const approved = await modules.approval.approveSystemImprovementProposal(proposal.id);
    modules.store.attachSystemImprovementTestEvidence(proposal.id, {
      command: 'test -f README.md',
      status: 'passed',
      outputSummary: 'fixture validation passed',
      createdAt: '2026-05-01T10:01:00.000Z',
    });
    const updated = modules.store.patchSystemImprovementProposal(proposal.id, {
      status: 'ready-to-merge',
      rollbackPlan: ['git apply -R <release patch>'],
      metadata: {
        ...(approved.proposal.metadata || {}),
        improvementProjectId: 'project-release-gate-smoke',
        improvementRunId: 'codex-release-gate-smoke',
        codexRunnerEvidence: {
          runId: 'codex-release-gate-smoke',
          taskKey: proposal.id,
          branch: 'ai/platform-release-gate-smoke',
          worktreePath,
          evidencePath: path.join(tempHome, 'evidence.json'),
          baseMode: 'snapshot',
          baseSha: 'base123',
          headSha: 'head123',
          changedFiles: [relativePath],
          allowedPathPrefixes: [relativePath],
          disallowedFiles: [],
          scopeCheckPassed: true,
          diffCheckPassed: true,
          validationCount: 3,
          passedValidationCount: 3,
          failedValidationCount: 0,
          decision: 'ready-to-merge',
          updatedAt: '2026-05-01T10:02:00.000Z',
        },
      },
    });
    if (!updated) throw new Error('failed to create proposal fixture');
    return { modules, proposal: updated, worktreePath };
  }

  it('runs preflight and records CEO/Ops release progression', async () => {
    const { modules, proposal } = await createReadyProposal();

    const preflight = await modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, { action: 'preflight' });
    expect(preflight.releaseGate.preflightStatus).toBe('passed');
    expect(preflight.releaseGate.status).toBe('ready-for-approval');
    expect(preflight.proposal.humanGate?.state).toBe('exit-approval-required');
    expect(preflight.proposal.automationState?.status).toBe('exit-ready');
    expect(preflight.releaseGate.patchPath).toBeTruthy();
    expect(fs.existsSync(String(preflight.releaseGate.patchPath))).toBe(true);

    const approved = await modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, {
      action: 'approve',
      actor: 'CEO',
      note: 'Release approved.',
    });
    expect(approved.releaseGate.status).toBe('approved');
    expect(approved.releaseGate.approvedBy).toBe('CEO');
    expect(approved.proposal.humanGate?.state).toBe('none');

    const merged = await modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, { action: 'mark-merged' });
    expect(merged.releaseGate.status).toBe('merged');
    expect(merged.proposal.status).toBe('ready-to-merge');

    const restarted = await modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, {
      action: 'mark-restarted',
      healthCheckSummary: 'health ok',
    });
    expect(restarted.releaseGate.status).toBe('restarted');
    expect(restarted.proposal.status).toBe('published');
    expect(restarted.proposal.automationState?.summary).toBe('health ok');
    expect(restarted.proposal.humanGate?.summary).toBe('health ok');

    const observing = await modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, {
      action: 'start-observation',
      observationSummary: 'watching release health',
    });
    expect(observing.releaseGate.status).toBe('observing');
    expect(observing.proposal.status).toBe('observing');
    expect(observing.proposal.automationState?.summary).toBe('watching release health');
    expect(observing.proposal.humanGate?.summary).toBe('watching release health');

    const rolledBack = await modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, {
      action: 'mark-rolled-back',
      rollbackReason: 'smoke rollback',
    });
    expect(rolledBack.releaseGate.status).toBe('rolled-back');
    expect(rolledBack.proposal.status).toBe('rolled-back');
    expect(rolledBack.proposal.automationState?.summary).toBe('smoke rollback');
    expect(rolledBack.proposal.humanGate?.summary).toBe('smoke rollback');
  }, 20_000);

  it('does not allow release approval before preflight passes', async () => {
    const { modules, proposal } = await createReadyProposal();

    await expect(modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, {
      action: 'approve',
      actor: 'CEO',
    })).rejects.toThrow(/cannot be approved/);
  }, 20_000);

  it('auto-remediates trailing whitespace before surfacing preflight results', async () => {
    const modules = await loadModules();
    const relativePath = `docs/design/self-evolution/release-gate-whitespace-${Date.now().toString(36)}.md`;
    const worktreePath = createWorktreeWithChange(
      relativePath,
      [
        '**日期**: 2026-05-01  ',
        '**状态**: ✅ 通过  ',
        '',
      ].join('\n'),
    );
    const signal = modules.signal.createSystemImprovementSignal({
      source: 'manual-feedback',
      title: 'Release gate whitespace remediation',
      summary: 'Exercise auto remediation for whitespace-only preflight failures.',
      affectedAreas: ['docs'],
      evidenceRefs: [{
        id: 'release-gate-whitespace-evidence',
        type: 'file',
        label: 'Release gate whitespace',
        filePath: relativePath,
        createdAt: '2026-05-01T10:10:00.000Z',
      }],
    });
    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: [relativePath],
    });
    const approved = await modules.approval.approveSystemImprovementProposal(proposal.id);
    modules.store.attachSystemImprovementTestEvidence(proposal.id, {
      command: 'test -f README.md',
      status: 'passed',
      outputSummary: 'fixture validation passed',
      createdAt: '2026-05-01T10:11:00.000Z',
    });
    const updated = modules.store.patchSystemImprovementProposal(proposal.id, {
      status: 'ready-to-merge',
      rollbackPlan: ['git apply -R <release patch>'],
      metadata: {
        ...(approved.proposal.metadata || {}),
        improvementProjectId: 'project-release-gate-whitespace',
        improvementRunId: 'codex-release-gate-whitespace',
        codexRunnerEvidence: {
          runId: 'codex-release-gate-whitespace',
          taskKey: proposal.id,
          branch: 'ai/platform-release-gate-whitespace',
          worktreePath,
          evidencePath: path.join(tempHome, 'whitespace-evidence.json'),
          baseMode: 'snapshot',
          baseSha: 'base123',
          headSha: 'head123',
          changedFiles: [relativePath],
          allowedPathPrefixes: [relativePath],
          disallowedFiles: [],
          scopeCheckPassed: true,
          diffCheckPassed: true,
          validationCount: 3,
          passedValidationCount: 3,
          failedValidationCount: 0,
          decision: 'ready-to-merge',
          updatedAt: '2026-05-01T10:12:00.000Z',
        },
      },
    });
    if (!updated) throw new Error('failed to create whitespace remediation fixture');

    const preflight = await modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, { action: 'preflight' });
    expect(preflight.releaseGate.status).toBe('ready-for-approval');
    expect(preflight.releaseGate.preflightStatus).toBe('passed');
    expect(preflight.releaseGate.failureCategory).toBe('none');
    expect(preflight.releaseGate.remediationStatus).toBe('fixed');
    expect(preflight.releaseGate.remediationAttempts).toBe(1);
    expect(preflight.releaseGate.remediationSummary).toContain('行尾空格');
    expect(preflight.releaseGate.checks.some((item) => item.label === 'auto remediation' && item.status === 'passed')).toBe(true);

    const remediatedContent = fs.readFileSync(path.join(worktreePath, relativePath), 'utf-8');
    expect(remediatedContent).toBe(['**日期**: 2026-05-01', '**状态**: ✅ 通过', ''].join('\n'));
  }, 20_000);

  it('retries transient git index locks while generating the release patch', async () => {
    const { modules, proposal, worktreePath } = await createReadyProposal();
    const lockPath = path.join(worktreePath, '.git', 'index.lock');
    fs.writeFileSync(lockPath, 'lock', 'utf-8');

    const releaseLock = setTimeout(() => {
      fs.rmSync(lockPath, { force: true });
    }, 300);

    try {
      const preflight = await modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, { action: 'preflight' });
      expect(preflight.releaseGate.status).toBe('ready-for-approval');
      expect(preflight.releaseGate.preflightStatus).toBe('passed');
      expect(preflight.releaseGate.patchPath).toBeTruthy();
    } finally {
      clearTimeout(releaseLock);
      fs.rmSync(lockPath, { force: true });
    }
  }, 20_000);

  it('does not re-run preflight after a ready-for-approval release gate already exists', async () => {
    const { modules, proposal } = await createReadyProposal();

    const first = await modules.releaseGate.maybeAutoRunSystemImprovementPreflight({ proposal });
    const firstUpdatedAt = first.exitEvidence?.releaseGate?.updatedAt;

    const second = await modules.releaseGate.maybeAutoRunSystemImprovementPreflight({ proposal: first });

    expect(first.exitEvidence?.releaseGate?.status).toBe('ready-for-approval');
    expect(second.exitEvidence?.releaseGate?.status).toBe('ready-for-approval');
    expect(second.exitEvidence?.releaseGate?.updatedAt).toBe(firstUpdatedAt);
  }, 20_000);

  it('auto-reruns Codex when apply check shows the patch no longer fits the current repo snapshot', async () => {
    const relativePath = 'src/example.ts';
    const repoPath = createMainRepoFixture(relativePath, 'export const version = "current";\n');
    process.chdir(repoPath);

    const staleWorktreePath = createWorktreeWithChange(relativePath, 'export const version = "remediation-old";\n');
    const refreshedWorktreePath = createWorktreeFromRepo(repoPath, relativePath, 'export const version = "remediation-new";\n');
    let receivedOptions: { force?: boolean; skipAutoPreflight?: boolean; remediationPrompt?: string } | undefined;

    vi.doMock('./self-improvement-codex-execution', async () => {
      const store = await import('./self-improvement-store');
      return {
        runApprovedSystemImprovementCodexTask: vi.fn(async (proposalId: string, options?: { force?: boolean; skipAutoPreflight?: boolean; remediationPrompt?: string }) => {
          receivedOptions = options;
          const updated = store.patchSystemImprovementProposal(proposalId, {
            exitEvidence: {
              ...(store.getSystemImprovementProposal(proposalId)?.exitEvidence || {
                testing: {
                  plannedCount: 1,
                  evidenceCount: 1,
                  passedCount: 1,
                  failedCount: 0,
                },
                mergeGate: {
                  status: 'ready-to-merge',
                  approvalReady: true,
                  deliveryReady: true,
                  testsReady: true,
                  rollbackReady: true,
                  reasons: [],
                },
                updatedAt: '2026-05-01T10:22:00.000Z',
              }),
              codex: {
                runId: 'codex-remediation-rerun',
                taskKey: proposalId,
                branch: 'ai/platform-remediation-rerun',
                worktreePath: refreshedWorktreePath,
                evidencePath: path.join(tempHome, 'remediation-evidence.json'),
                baseMode: 'snapshot',
                baseSha: 'base456',
                headSha: 'head456',
                changedFiles: [relativePath],
                allowedPathPrefixes: [relativePath],
                disallowedFiles: [],
                scopeCheckPassed: true,
                diffCheckPassed: true,
                validationCount: 3,
                passedValidationCount: 3,
                failedValidationCount: 0,
                decision: 'ready-to-merge',
                updatedAt: '2026-05-01T10:22:00.000Z',
              },
              updatedAt: '2026-05-01T10:22:00.000Z',
            },
            metadata: {
              ...(store.getSystemImprovementProposal(proposalId)?.metadata || {}),
              improvementProjectId: 'project-remediation-rerun',
              improvementRunId: 'codex-remediation-rerun',
              codexRunnerEvidence: {
                runId: 'codex-remediation-rerun',
                taskKey: proposalId,
                branch: 'ai/platform-remediation-rerun',
                worktreePath: refreshedWorktreePath,
                evidencePath: path.join(tempHome, 'remediation-evidence.json'),
                baseMode: 'snapshot',
                baseSha: 'base456',
                headSha: 'head456',
                changedFiles: [relativePath],
                allowedPathPrefixes: [relativePath],
                disallowedFiles: [],
                scopeCheckPassed: true,
                diffCheckPassed: true,
                validationCount: 3,
                passedValidationCount: 3,
                failedValidationCount: 0,
                decision: 'ready-to-merge',
                updatedAt: '2026-05-01T10:22:00.000Z',
              },
            },
          });
          if (!updated) {
            throw new Error('failed to update proposal for remediation rerun');
          }
          return {
            proposal: updated,
            launch: {
              status: 'dispatched' as const,
              projectId: 'project-remediation-rerun',
              runId: 'run-remediation-rerun',
              codexRunId: 'codex-remediation-rerun',
              worktreePath: refreshedWorktreePath,
              branch: 'ai/platform-remediation-rerun',
              evidencePath: path.join(tempHome, 'remediation-evidence.json'),
              createdProject: false,
              templateId: 'development-template-1',
              workspaceUri: 'workspace://platform-engineering',
            },
          };
        }),
      };
    });

    const modules = await loadModules();
    const signal = modules.signal.createSystemImprovementSignal({
      source: 'manual-feedback',
      title: 'Release gate patch drift remediation',
      summary: 'Exercise auto rerunning Codex when the generated patch no longer applies to the main repo.',
      affectedAreas: ['runtime'],
      evidenceRefs: [{
        id: 'release-gate-patch-drift-evidence',
        type: 'file',
        label: 'Patch drift note',
        filePath: relativePath,
        createdAt: '2026-05-01T10:20:00.000Z',
      }],
    });
    const proposal = modules.planner.generateSystemImprovementProposal({
      signalIds: [signal.id],
      affectedFiles: [relativePath],
    });
    const approved = await modules.approval.approveSystemImprovementProposal(proposal.id);
    modules.store.attachSystemImprovementTestEvidence(proposal.id, {
      command: 'test -f src/example.ts',
      status: 'passed',
      outputSummary: 'fixture validation passed',
      createdAt: '2026-05-01T10:21:00.000Z',
    });
    const updated = modules.store.patchSystemImprovementProposal(proposal.id, {
      status: 'ready-to-merge',
      rollbackPlan: ['git apply -R <release patch>'],
      metadata: {
        ...(approved.proposal.metadata || {}),
        improvementProjectId: 'project-remediation-old',
        improvementRunId: 'codex-remediation-old',
        codexRunnerEvidence: {
          runId: 'codex-remediation-old',
          taskKey: proposal.id,
          branch: 'ai/platform-remediation-old',
          worktreePath: staleWorktreePath,
          evidencePath: path.join(tempHome, 'remediation-old-evidence.json'),
          baseMode: 'snapshot',
          baseSha: 'base123',
          headSha: 'head123',
          changedFiles: [relativePath],
          allowedPathPrefixes: [relativePath],
          disallowedFiles: [],
          scopeCheckPassed: true,
          diffCheckPassed: true,
          validationCount: 3,
          passedValidationCount: 3,
          failedValidationCount: 0,
          decision: 'ready-to-merge',
          updatedAt: '2026-05-01T10:21:30.000Z',
        },
      },
    });
    if (!updated) throw new Error('failed to create remediation rerun fixture');

    const preflight = await modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, { action: 'preflight' });

    expect(preflight.releaseGate.status).toBe('ready-for-approval');
    expect(preflight.releaseGate.preflightStatus).toBe('passed');
    expect(preflight.releaseGate.remediationStatus).toBe('fixed');
    expect(preflight.releaseGate.remediationAttempts).toBe(1);
    expect(preflight.releaseGate.remediationSummary).toContain('自动重跑 Codex');
    expect(preflight.releaseGate.checks.some((item) => item.label === 'auto remediation' && item.status === 'passed')).toBe(true);
    expect(preflight.proposal.exitEvidence?.codex?.runId).toBe('codex-remediation-rerun');
    expect(fs.existsSync(String(preflight.releaseGate.patchPath))).toBe(true);
    expect(receivedOptions).toMatchObject({
      force: true,
      skipAutoPreflight: true,
    });
    expect(receivedOptions?.remediationPrompt).toContain('generated patch no longer applies cleanly');
  }, 20_000);
});
