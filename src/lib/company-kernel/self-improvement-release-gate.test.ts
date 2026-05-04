import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'node:child_process';
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

function createWorktreeWithChange(relativePath: string): string {
  const worktreePath = path.join(tempHome, 'codex-worktree');
  fs.mkdirSync(path.join(worktreePath, path.dirname(relativePath)), { recursive: true });
  runGit(worktreePath, ['init']);
  runGit(worktreePath, ['config', 'user.email', 'platform-engineering@local']);
  runGit(worktreePath, ['config', 'user.name', 'Platform Engineering']);
  fs.writeFileSync(path.join(worktreePath, 'README.md'), '# fixture\n', 'utf-8');
  runGit(worktreePath, ['add', 'README.md']);
  runGit(worktreePath, ['commit', '-m', 'base']);
  fs.writeFileSync(path.join(worktreePath, relativePath), '# Release gate smoke\n', 'utf-8');
  return worktreePath;
}

describe('self-improvement release gate', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'self-improvement-release-gate-'));
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
    return { modules, proposal: updated };
  }

  it('runs preflight and records CEO/Ops release progression', async () => {
    const { modules, proposal } = await createReadyProposal();

    const preflight = await modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, { action: 'preflight' });
    expect(preflight.releaseGate.preflightStatus).toBe('passed');
    expect(preflight.releaseGate.status).toBe('ready-for-approval');
    expect(preflight.releaseGate.patchPath).toBeTruthy();
    expect(fs.existsSync(String(preflight.releaseGate.patchPath))).toBe(true);

    const approved = await modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, {
      action: 'approve',
      actor: 'CEO',
      note: 'Release approved.',
    });
    expect(approved.releaseGate.status).toBe('approved');
    expect(approved.releaseGate.approvedBy).toBe('CEO');

    const merged = await modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, { action: 'mark-merged' });
    expect(merged.releaseGate.status).toBe('merged');
    expect(merged.proposal.status).toBe('ready-to-merge');

    const restarted = await modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, {
      action: 'mark-restarted',
      healthCheckSummary: 'health ok',
    });
    expect(restarted.releaseGate.status).toBe('restarted');
    expect(restarted.proposal.status).toBe('published');

    const observing = await modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, {
      action: 'start-observation',
      observationSummary: 'watching release health',
    });
    expect(observing.releaseGate.status).toBe('observing');
    expect(observing.proposal.status).toBe('observing');

    const rolledBack = await modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, {
      action: 'mark-rolled-back',
      rollbackReason: 'smoke rollback',
    });
    expect(rolledBack.releaseGate.status).toBe('rolled-back');
    expect(rolledBack.proposal.status).toBe('rolled-back');
  }, 20_000);

  it('does not allow release approval before preflight passes', async () => {
    const { modules, proposal } = await createReadyProposal();

    await expect(modules.releaseGate.runSystemImprovementReleaseAction(proposal.id, {
      action: 'approve',
      actor: 'CEO',
    })).rejects.toThrow(/cannot be approved/);
  }, 20_000);
});
