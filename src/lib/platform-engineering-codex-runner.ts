import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { codexExec } from './bridge/codex-adapter';
import { createLogger } from './logger';
import {
  getPlatformEngineeringEvidencePath,
  getPlatformEngineeringWorktreesPath,
} from './platform-engineering';

const execFile = promisify(execFileCallback);
const log = createLogger('PlatformEngineeringCodexRunner');
const EVIDENCE_IGNORED_PATHS = new Set(['node_modules']);
type WorktreeChangeSnapshot = Map<string, string | null>;

export type PlatformEngineeringBaseMode = 'checkpoint' | 'snapshot';

export interface PlatformEngineeringWorktree {
  runId: string;
  taskKey: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  baseMode: PlatformEngineeringBaseMode;
  requestedBaseRef: string;
  baseSha: string;
  headSha: string;
  snapshotSha?: string;
}

export interface PlatformEngineeringValidationResult {
  command: string;
  passed: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface PlatformEngineeringExitEvidence {
  runId: string;
  taskKey: string;
  baseSha: string;
  headSha: string;
  branch: string;
  worktreePath: string;
  evidencePath?: string;
  changedFiles: string[];
  disallowedFiles: string[];
  scopeCheckPassed: boolean;
  diffCheckPassed: boolean;
  validations: PlatformEngineeringValidationResult[];
}

export interface RunPlatformEngineeringCodexTaskInput {
  repoPath: string;
  taskKey: string;
  prompt: string;
  baseMode?: PlatformEngineeringBaseMode;
  baseRef?: string;
  model?: string;
  timeoutMs?: number;
  expectEdits?: boolean;
  seedPaths?: string[];
  allowedPathPrefixes?: string[];
  validationCommands?: string[];
}

export interface RunPlatformEngineeringCodexTaskResult {
  worktree: PlatformEngineeringWorktree;
  codexOutput: string;
  evidence: PlatformEngineeringExitEvidence;
}

interface ResolvedBaseRef {
  baseMode: PlatformEngineeringBaseMode;
  requestedBaseRef: string;
  effectiveBaseRef: string;
  snapshotSha?: string;
}

function sanitizeTaskKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || `task-${Date.now()}`;
}

function createRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function runGit(repoPath: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd: repoPath,
    env,
    maxBuffer: 10_000_000,
  });
  return stdout.trim();
}

async function runValidationCommand(
  cwd: string,
  command: string,
  env?: NodeJS.ProcessEnv,
): Promise<PlatformEngineeringValidationResult> {
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const { stdout, stderr } = await execFile(shell, ['-lc', command], {
      cwd,
      env,
      maxBuffer: 10_000_000,
    });
    return {
      command,
      passed: true,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
    };
  } catch (error: unknown) {
    const err = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | null;
      message?: string;
    };
    return {
      command,
      passed: false,
      stdout: typeof err.stdout === 'string' ? err.stdout.trim() : String(err.stdout || '').trim(),
      stderr: typeof err.stderr === 'string' ? err.stderr.trim() : (err.message || String(err)).trim(),
      exitCode: typeof err.code === 'number' ? err.code : null,
    };
  }
}

function normalizeRelativePath(entry: string): string {
  return entry.split(path.sep).join('/').replace(/^\.\/+/, '').trim();
}

function normalizeRelativePathList(entries: string[] | undefined): string[] {
  return Array.from(new Set((entries || [])
    .map((entry) => normalizeRelativePath(entry))
    .filter(Boolean)));
}

function buildWorktreeExecutionEnv(repoPath: string): NodeJS.ProcessEnv {
  const nodeModulesBin = path.join(repoPath, 'node_modules', '.bin');
  const pathEntries = [nodeModulesBin, process.env.PATH || ''].filter(Boolean);

  return {
    ...process.env,
    NODE_PATH: path.join(repoPath, 'node_modules'),
    PATH: pathEntries.join(path.delimiter),
  };
}

function ensureNodeModulesBridge(repoPath: string, worktreePath: string): void {
  const sourceNodeModules = path.join(repoPath, 'node_modules');
  if (!fs.existsSync(sourceNodeModules)) {
    return;
  }

  const targetNodeModules = path.join(worktreePath, 'node_modules');
  if (fs.existsSync(targetNodeModules)) {
    return;
  }

  const relativeTarget = path.relative(path.dirname(targetNodeModules), sourceNodeModules);
  fs.symlinkSync(relativeTarget, targetNodeModules, 'dir');
}

function seedWorktreePaths(repoPath: string, worktreePath: string, seedPaths: string[] | undefined): void {
  for (const relativePath of normalizeRelativePathList(seedPaths)) {
    const sourcePath = path.join(repoPath, relativePath);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }
    const targetPath = path.join(worktreePath, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
  }
}

function collectDisallowedFiles(changedFiles: string[], allowedPathPrefixes: string[] | undefined): string[] {
  const normalizedAllowlist = normalizeRelativePathList(allowedPathPrefixes);
  if (normalizedAllowlist.length === 0) {
    return [];
  }

  return changedFiles.filter((entry) => !normalizedAllowlist.some((prefix) => (
    entry === prefix || entry.startsWith(`${prefix}/`)
  )));
}

function validationResult(input: {
  command: string;
  passed: boolean;
  stdout?: string;
  stderr?: string;
}): PlatformEngineeringValidationResult {
  return {
    command: input.command,
    passed: input.passed,
    stdout: input.stdout || '',
    stderr: input.stderr || '',
    exitCode: input.passed ? 0 : 1,
  };
}

function buildCodexTaskPacket(input: {
  prompt: string;
  allowedPathPrefixes?: string[];
  validationCommands?: string[];
  expectEdits?: boolean;
}): string {
  const allowedPathPrefixes = normalizeRelativePathList(input.allowedPathPrefixes);
  const validationCommands = (input.validationCommands || []).map((command) => command.trim()).filter(Boolean);
  const allowedSection = allowedPathPrefixes.length > 0
    ? allowedPathPrefixes.map((entry) => `- ${entry}`).join('\n')
    : '- No explicit allowlist was provided. Keep edits minimal and directly task-scoped.';
  const validationSection = validationCommands.length > 0
    ? validationCommands.map((command) => `- ${command}`).join('\n')
    : '- No controller validation commands were provided.';

  return [
    'You are executing a platform engineering task in an isolated git worktree.',
    'Follow the repository AGENTS.md. Use local code search as needed, but keep the task narrow.',
    `Task:\n${input.prompt.trim()}`,
    `Allowed edit paths:\n${allowedSection}`,
    `Expected edits:\n${input.expectEdits ? 'This task is expected to modify files.' : 'Edits are optional if no change is required.'}`,
    `Validation commands to consider:\n${validationSection}`,
    'Do not commit, push, start long-running services, or change unrelated files.',
  ].join('\n\n');
}

async function listChangedFiles(worktreePath: string): Promise<string[]> {
  const trackedChangedFilesRaw = await runGit(worktreePath, ['diff', '--name-only', '--relative']);
  const untrackedFilesRaw = await runGit(worktreePath, ['ls-files', '--others', '--exclude-standard']);

  return [trackedChangedFilesRaw, untrackedFilesRaw]
    .flatMap((chunk) => chunk.split('\n'))
    .map((entry) => normalizeRelativePath(entry))
    .filter(Boolean)
    .filter((entry) => !EVIDENCE_IGNORED_PATHS.has(entry));
}

function fingerprintWorktreePath(worktreePath: string, relativePath: string): string | null {
  const absolutePath = path.join(worktreePath, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    return `symlink:${fs.readlinkSync(absolutePath)}`;
  }
  if (stat.isDirectory()) {
    return 'dir';
  }

  const digest = createHash('sha1');
  digest.update(fs.readFileSync(absolutePath));
  return digest.digest('hex');
}

async function captureWorktreeChangeSnapshot(worktreePath: string): Promise<WorktreeChangeSnapshot> {
  const snapshot: WorktreeChangeSnapshot = new Map();
  for (const relativePath of await listChangedFiles(worktreePath)) {
    snapshot.set(relativePath, fingerprintWorktreePath(worktreePath, relativePath));
  }
  return snapshot;
}

async function createCurrentRepoSnapshotCommit(repoPath: string): Promise<string> {
  const status = await runGit(repoPath, ['status', '--short', '--untracked-files=all']);
  if (!status.trim()) {
    return 'HEAD';
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-platform-snapshot-'));
  const tempIndex = path.join(tempRoot, 'index');
  const snapshotEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_INDEX_FILE: tempIndex,
    GIT_AUTHOR_NAME: 'Platform Engineering',
    GIT_AUTHOR_EMAIL: 'platform-engineering@local',
    GIT_COMMITTER_NAME: 'Platform Engineering',
    GIT_COMMITTER_EMAIL: 'platform-engineering@local',
  };

  try {
    await runGit(repoPath, ['read-tree', 'HEAD'], snapshotEnv);
    await runGit(repoPath, ['add', '-A'], snapshotEnv);
    const tree = await runGit(repoPath, ['write-tree'], snapshotEnv);
    return await runGit(
      repoPath,
      ['commit-tree', tree, '-p', 'HEAD', '-m', `platform engineering snapshot ${new Date().toISOString()}`],
      snapshotEnv,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function resolvePlatformEngineeringBaseRef(input: {
  repoPath: string;
  baseMode?: PlatformEngineeringBaseMode;
  baseRef?: string;
}): Promise<ResolvedBaseRef> {
  const baseMode = input.baseMode || 'checkpoint';
  const requestedBaseRef = input.baseRef || 'HEAD';

  if (baseMode === 'checkpoint') {
    return {
      baseMode,
      requestedBaseRef,
      effectiveBaseRef: requestedBaseRef,
    };
  }

  const snapshotSha = await createCurrentRepoSnapshotCommit(path.resolve(input.repoPath));
  return {
    baseMode,
    requestedBaseRef,
    effectiveBaseRef: snapshotSha,
    snapshotSha: snapshotSha === 'HEAD' ? undefined : snapshotSha,
  };
}

function diffSnapshots(
  before: WorktreeChangeSnapshot | undefined,
  after: WorktreeChangeSnapshot,
): string[] {
  if (!before) {
    return Array.from(after.keys());
  }

  const paths = new Set<string>([
    ...before.keys(),
    ...after.keys(),
  ]);

  return Array.from(paths)
    .filter((relativePath) => before.get(relativePath) !== after.get(relativePath))
    .sort();
}

export async function createPlatformEngineeringWorktree(input: {
  repoPath: string;
  taskKey: string;
  runId?: string;
  baseRef?: string;
  baseMode?: PlatformEngineeringBaseMode;
  requestedBaseRef?: string;
  snapshotSha?: string;
  seedPaths?: string[];
}): Promise<PlatformEngineeringWorktree> {
  const repoPath = path.resolve(input.repoPath);
  const taskKey = sanitizeTaskKey(input.taskKey);
  const runId = input.runId || createRunId();
  const worktreesRoot = getPlatformEngineeringWorktreesPath();
  const worktreeName = `${taskKey}-${runId}`;
  const worktreePath = path.join(worktreesRoot, worktreeName);
  const branch = `ai/platform-${worktreeName}`;
  const baseMode = input.baseMode || 'checkpoint';
  const requestedBaseRef = input.requestedBaseRef || input.baseRef || 'HEAD';
  const baseRef = input.baseRef || requestedBaseRef;

  fs.mkdirSync(worktreesRoot, { recursive: true });
  await runGit(repoPath, ['rev-parse', '--git-dir']);

  const baseSha = await runGit(repoPath, ['rev-parse', '--short', baseRef]);

  if (fs.existsSync(path.join(worktreePath, '.git'))) {
    ensureNodeModulesBridge(repoPath, worktreePath);
    seedWorktreePaths(repoPath, worktreePath, input.seedPaths);
    const headSha = await runGit(worktreePath, ['rev-parse', '--short', 'HEAD']);
    return {
      runId,
      taskKey,
      repoPath,
      worktreePath,
      branch: await runGit(worktreePath, ['branch', '--show-current']),
      baseMode,
      requestedBaseRef,
      baseSha,
      headSha,
      ...(input.snapshotSha ? { snapshotSha: input.snapshotSha } : {}),
    };
  }

  if (fs.existsSync(worktreePath)) {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }

  try {
    await runGit(repoPath, ['worktree', 'add', '-b', branch, worktreePath, baseRef]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('already exists')) {
      throw error;
    }
    await runGit(repoPath, ['worktree', 'add', worktreePath, branch]);
  }

  const headSha = await runGit(worktreePath, ['rev-parse', '--short', 'HEAD']);
  ensureNodeModulesBridge(repoPath, worktreePath);
  seedWorktreePaths(repoPath, worktreePath, input.seedPaths);
  return {
    runId,
    taskKey,
    repoPath,
    worktreePath,
    branch,
    baseMode,
    requestedBaseRef,
    baseSha,
    headSha,
    ...(input.snapshotSha ? { snapshotSha: input.snapshotSha } : {}),
  };
}

export async function collectPlatformEngineeringExitEvidence(input: {
  repoPath: string;
  worktreePath: string;
  taskKey?: string;
  runId?: string;
  baseSha?: string;
  allowedPathPrefixes?: string[];
  baselineSnapshot?: WorktreeChangeSnapshot;
  expectEdits?: boolean;
  validationCommands?: string[];
}): Promise<PlatformEngineeringExitEvidence> {
  const repoPath = path.resolve(input.repoPath);
  const worktreePath = path.resolve(input.worktreePath);
  const branch = await runGit(worktreePath, ['branch', '--show-current']);
  const headSha = await runGit(worktreePath, ['rev-parse', '--short', 'HEAD']);
  const baseSha = input.baseSha || headSha;
  const afterSnapshot = await captureWorktreeChangeSnapshot(worktreePath);
  const changedFiles = diffSnapshots(input.baselineSnapshot, afterSnapshot);
  const disallowedFiles = collectDisallowedFiles(changedFiles, input.allowedPathPrefixes);
  const executionEnv = buildWorktreeExecutionEnv(repoPath);

  const editCheck = validationResult({
    command: 'codex task produced expected workspace changes',
    passed: !input.expectEdits || changedFiles.length > 0,
    stdout: changedFiles.length > 0
      ? changedFiles.join('\n')
      : '',
    stderr: input.expectEdits && changedFiles.length === 0
      ? 'No workspace changes were detected after Codex execution.'
      : '',
  });
  const scopeCheck = validationResult({
    command: 'changed files stay within allowed scope',
    passed: disallowedFiles.length === 0,
    stdout: changedFiles.join('\n'),
    stderr: disallowedFiles.length > 0
      ? `Disallowed files:\n${disallowedFiles.join('\n')}`
      : '',
  });
  const diffCheck = await runValidationCommand(worktreePath, 'git diff --check', executionEnv);
  const extraValidations = await Promise.all(
    (input.validationCommands || []).map((command) => runValidationCommand(worktreePath, command, executionEnv)),
  );

  return {
    runId: input.runId || branch,
    taskKey: input.taskKey || 'manual',
    baseSha,
    headSha,
    branch,
    worktreePath,
    changedFiles,
    disallowedFiles,
    scopeCheckPassed: disallowedFiles.length === 0,
    diffCheckPassed: diffCheck.passed,
    validations: [editCheck, scopeCheck, diffCheck, ...extraValidations],
  };
}

function persistPlatformEngineeringEvidence(input: {
  worktree: PlatformEngineeringWorktree;
  codexOutput: string;
  evidence: PlatformEngineeringExitEvidence;
}): PlatformEngineeringExitEvidence {
  const evidenceDir = path.join(getPlatformEngineeringEvidencePath(), 'codex-runs');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, `${input.worktree.taskKey}-${input.worktree.runId}.json`);
  const evidence = {
    ...input.evidence,
    evidencePath,
  };

  fs.writeFileSync(
    evidencePath,
    JSON.stringify({
      createdAt: new Date().toISOString(),
      worktree: input.worktree,
      codexOutput: input.codexOutput,
      evidence,
    }, null, 2),
    'utf-8',
  );

  return evidence;
}

export async function runPlatformEngineeringCodexTask(
  input: RunPlatformEngineeringCodexTaskInput,
): Promise<RunPlatformEngineeringCodexTaskResult> {
  const resolvedBase = await resolvePlatformEngineeringBaseRef({
    repoPath: input.repoPath,
    baseMode: input.baseMode,
    baseRef: input.baseRef,
  });
  const worktree = await createPlatformEngineeringWorktree({
    repoPath: input.repoPath,
    taskKey: input.taskKey,
    baseMode: resolvedBase.baseMode,
    requestedBaseRef: resolvedBase.requestedBaseRef,
    baseRef: resolvedBase.effectiveBaseRef,
    snapshotSha: resolvedBase.snapshotSha,
    seedPaths: input.seedPaths,
  });

  log.info(
    {
      branch: worktree.branch,
      worktreePath: worktree.worktreePath,
      baseSha: worktree.baseSha,
    },
    'Starting platform engineering Codex task in isolated worktree',
  );
  const baselineSnapshot = await captureWorktreeChangeSnapshot(worktree.worktreePath);

  const taskPacket = buildCodexTaskPacket({
    prompt: input.prompt,
    allowedPathPrefixes: input.allowedPathPrefixes,
    validationCommands: input.validationCommands,
    expectEdits: input.expectEdits,
  });

  const codexOutput = await codexExec(taskPacket, {
    cwd: worktree.worktreePath,
    model: input.model,
    sandbox: 'workspace-write',
    timeoutMs: input.timeoutMs ?? 0,
  });

  const evidence = await collectPlatformEngineeringExitEvidence({
    repoPath: input.repoPath,
    worktreePath: worktree.worktreePath,
    taskKey: worktree.taskKey,
    runId: worktree.runId,
    baseSha: worktree.baseSha,
    allowedPathPrefixes: input.allowedPathPrefixes,
    baselineSnapshot,
    expectEdits: input.expectEdits,
    validationCommands: input.validationCommands,
  });
  const persistedEvidence = persistPlatformEngineeringEvidence({
    worktree,
    codexOutput,
    evidence,
  });

  return {
    worktree,
    codexOutput,
    evidence: persistedEvidence,
  };
}
