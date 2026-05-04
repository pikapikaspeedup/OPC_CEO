import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCodexExec } = vi.hoisted(() => ({
  mockCodexExec: vi.fn(),
}));

vi.mock('./bridge/codex-adapter', () => ({
  codexExec: (...args: unknown[]) => mockCodexExec(...args),
}));

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

describe('platform engineering codex runner', () => {
  const tempRoot = path.join(os.tmpdir(), `ag-platform-codex-runner-${process.pid}-${Date.now()}`);
  const tempGatewayHome = path.join(tempRoot, 'gateway-home');
  const repoPath = path.join(tempRoot, 'repo');
  let previousGatewayHome: string | undefined;

  beforeEach(() => {
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.AG_GATEWAY_HOME = tempGatewayHome;
    vi.resetModules();
    vi.clearAllMocks();
    fs.rmSync(tempRoot, { recursive: true, force: true });

    fs.mkdirSync(repoPath, { recursive: true });
    runGit(repoPath, ['init']);
    runGit(repoPath, ['config', 'user.email', 'codex@test.local']);
    runGit(repoPath, ['config', 'user.name', 'Codex Test']);
    writeFile(path.join(repoPath, 'AGENTS.md'), '# AGENTS\n');
    writeFile(path.join(repoPath, 'README.md'), '# Repo\n');
    fs.mkdirSync(path.join(repoPath, 'node_modules'), { recursive: true });
    runGit(repoPath, ['add', '.']);
    runGit(repoPath, ['commit', '-m', 'initial']);
  });

  afterEach(() => {
    vi.resetModules();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (previousGatewayHome === undefined) {
      delete process.env.AG_GATEWAY_HOME;
    } else {
      process.env.AG_GATEWAY_HOME = previousGatewayHome;
    }
  });

  it('creates an isolated worktree and collects Codex task evidence', async () => {
    mockCodexExec.mockImplementation(async (_prompt: string, opts?: { cwd?: string }) => {
      const cwd = opts?.cwd;
      if (!cwd) {
        throw new Error('cwd missing');
      }
      writeFile(
        path.join(cwd, 'docs', 'design', 'self-evolution', 'trial-output.md'),
        '# Trial output\n',
      );
      return 'done';
    });

    const mod = await import('./platform-engineering-codex-runner');
    const result = await mod.runPlatformEngineeringCodexTask({
      repoPath,
      taskKey: 'trial-onboarding',
      prompt: 'Create a single trial output file.',
      validationCommands: ['test -f docs/design/self-evolution/trial-output.md'],
    });

    expect(result.worktree.branch).toMatch(/^ai\/platform-trial-onboarding-/);
    expect(result.worktree.taskKey).toBe('trial-onboarding');
    expect(result.worktree.runId).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    expect(result.worktree.baseMode).toBe('checkpoint');
    expect(result.worktree.requestedBaseRef).toBe('HEAD');
    expect(result.worktree.snapshotSha).toBeUndefined();
    expect(result.worktree.baseSha).toMatch(/^[0-9a-f]+$/);
    expect(fs.existsSync(path.join(result.worktree.worktreePath, '.git'))).toBe(true);
    expect(mockCodexExec).toHaveBeenCalledWith(
      expect.stringContaining('Task:\nCreate a single trial output file.'),
      expect.objectContaining({
        cwd: result.worktree.worktreePath,
        sandbox: 'workspace-write',
      }),
    );
    expect(mockCodexExec).toHaveBeenCalledWith(
      expect.stringContaining('Allowed edit paths:'),
      expect.any(Object),
    );
    expect(fs.lstatSync(path.join(result.worktree.worktreePath, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(result.evidence.evidencePath || '')).toBe(true);
    expect(result.evidence.taskKey).toBe('trial-onboarding');
    expect(result.evidence.runId).toBe(result.worktree.runId);
    expect(result.evidence.changedFiles).toEqual([
      'docs/design/self-evolution/trial-output.md',
    ]);
    expect(result.evidence.disallowedFiles).toEqual([]);
    expect(result.evidence.scopeCheckPassed).toBe(true);
    expect(result.evidence.diffCheckPassed).toBe(true);
    expect(result.evidence.validations.every((entry) => entry.passed)).toBe(true);
  });

  it('seeds scoped files from the current repo into the isolated worktree', async () => {
    writeFile(path.join(repoPath, 'README.md'), '# Repo\nseeded\n');

    mockCodexExec.mockImplementation(async (_prompt: string, opts?: { cwd?: string }) => {
      const cwd = opts?.cwd;
      if (!cwd) {
        throw new Error('cwd missing');
      }
      const readme = fs.readFileSync(path.join(cwd, 'README.md'), 'utf-8');
      writeFile(path.join(cwd, 'seed-check.txt'), readme);
      return 'seeded';
    });

    const mod = await import('./platform-engineering-codex-runner');
    const result = await mod.runPlatformEngineeringCodexTask({
      repoPath,
      taskKey: 'seed-check',
      prompt: 'Capture the seeded README content.',
      seedPaths: ['README.md'],
      allowedPathPrefixes: ['README.md', 'seed-check.txt'],
      validationCommands: ['test -f seed-check.txt'],
    });

    expect(fs.readFileSync(path.join(result.worktree.worktreePath, 'seed-check.txt'), 'utf-8')).toContain('seeded');
    expect(result.evidence.changedFiles).toEqual([
      'seed-check.txt',
    ]);
    expect(result.evidence.disallowedFiles).toEqual([]);
    expect(result.evidence.scopeCheckPassed).toBe(true);
  });

  it('uses a snapshot base when the current repo has uncommitted changes', async () => {
    writeFile(path.join(repoPath, 'README.md'), '# Repo\nsnapshot base\n');

    mockCodexExec.mockImplementation(async (_prompt: string, opts?: { cwd?: string }) => {
      const cwd = opts?.cwd;
      if (!cwd) {
        throw new Error('cwd missing');
      }
      const readme = fs.readFileSync(path.join(cwd, 'README.md'), 'utf-8');
      writeFile(path.join(cwd, 'snapshot-check.txt'), readme);
      return 'snapshot';
    });

    const mod = await import('./platform-engineering-codex-runner');
    const result = await mod.runPlatformEngineeringCodexTask({
      repoPath,
      taskKey: 'snapshot-check',
      prompt: 'Capture the current README content.',
      baseMode: 'snapshot',
      expectEdits: true,
      allowedPathPrefixes: ['snapshot-check.txt'],
      validationCommands: ['test -f snapshot-check.txt'],
    });

    expect(result.worktree.baseMode).toBe('snapshot');
    expect(result.worktree.requestedBaseRef).toBe('HEAD');
    expect(result.worktree.snapshotSha).toMatch(/^[0-9a-f]{40}$/);
    expect(fs.readFileSync(path.join(result.worktree.worktreePath, 'snapshot-check.txt'), 'utf-8')).toContain('snapshot base');
    expect(result.evidence.changedFiles).toEqual([
      'snapshot-check.txt',
    ]);
    expect(result.evidence.disallowedFiles).toEqual([]);
    expect(result.evidence.validations.every((entry) => entry.passed)).toBe(true);
    expect(runGit(repoPath, ['status', '--short', '--', 'README.md'])).toBe('M README.md');
  });

  it('marks expected edit tasks as failed when Codex makes no changes', async () => {
    mockCodexExec.mockResolvedValue('no changes');

    const mod = await import('./platform-engineering-codex-runner');
    const result = await mod.runPlatformEngineeringCodexTask({
      repoPath,
      taskKey: 'no-edit-check',
      prompt: 'Make a change.',
      expectEdits: true,
    });

    expect(result.evidence.changedFiles).toEqual([]);
    expect(result.evidence.validations[0]).toMatchObject({
      command: 'codex task produced expected workspace changes',
      passed: false,
      exitCode: 1,
    });
  });

  it('marks evidence as out of scope when Codex modifies disallowed files', async () => {
    mockCodexExec.mockImplementation(async (_prompt: string, opts?: { cwd?: string }) => {
      const cwd = opts?.cwd;
      if (!cwd) {
        throw new Error('cwd missing');
      }
      writeFile(path.join(cwd, 'blocked.txt'), 'blocked\n');
      return 'blocked';
    });

    const mod = await import('./platform-engineering-codex-runner');
    const result = await mod.runPlatformEngineeringCodexTask({
      repoPath,
      taskKey: 'scope-check',
      prompt: 'Create a blocked file.',
      expectEdits: true,
      allowedPathPrefixes: ['allowed'],
    });

    expect(result.evidence.changedFiles).toEqual(['blocked.txt']);
    expect(result.evidence.disallowedFiles).toEqual(['blocked.txt']);
    expect(result.evidence.scopeCheckPassed).toBe(false);
    expect(result.evidence.validations.some((entry) => (
      entry.command === 'changed files stay within allowed scope' && !entry.passed
    ))).toBe(true);
  });
});
