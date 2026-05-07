import { execFile as execFileCallback } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { getPlatformEngineeringEvidencePath } from '../platform-engineering';
import type {
  SystemImprovementReleaseFailureCategory,
  SystemImprovementProposal,
  SystemImprovementReleaseCommandBundle,
  SystemImprovementReleaseGateSnapshot,
  SystemImprovementReleasePreflightCheck,
} from './contracts';
import {
  getSystemImprovementProposal,
  patchSystemImprovementProposal,
} from './self-improvement-store';
import { syncSystemImprovementProposalRuntimeState } from './self-improvement-runtime-state';

const execFile = promisify(execFileCallback);
const TRAILING_WHITESPACE_PATTERN = /[ \t]+$/gm;
const MAX_AUTO_REMEDIATION_ATTEMPTS = 2;
const GIT_INDEX_LOCK_RETRY_ATTEMPTS = 10;
const GIT_INDEX_LOCK_RETRY_DELAY_MS = 200;

export type SystemImprovementReleaseAction =
  | 'preflight'
  | 'approve'
  | 'mark-merged'
  | 'mark-restarted'
  | 'start-observation'
  | 'mark-rolled-back';

export interface SystemImprovementReleaseActionInput {
  action: SystemImprovementReleaseAction;
  actor?: string;
  note?: string;
  mergeCommitSha?: string;
  restartTarget?: string;
  healthCheckSummary?: string;
  observationSummary?: string;
  rollbackReason?: string;
}

export interface SystemImprovementReleaseActionResult {
  proposal: SystemImprovementProposal;
  releaseGate: SystemImprovementReleaseGateSnapshot;
}

export interface MaybeAutoRunSystemImprovementPreflightInput {
  proposal: SystemImprovementProposal;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd,
    maxBuffer: 20_000_000,
  });
  return stdout.trim();
}

async function runGitRaw(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd,
    maxBuffer: 20_000_000,
  });
  return stdout;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
}

function normalizeCommand(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isGitIndexLockFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /index\.lock|another git process seems to be running|unable to create '.*index\.lock'/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withGitIndexLockRetry<T>(task: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < GIT_INDEX_LOCK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await task();
    } catch (error: unknown) {
      lastError = error;
      if (!isGitIndexLockFailure(error) || attempt === GIT_INDEX_LOCK_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      await sleep(GIT_INDEX_LOCK_RETRY_DELAY_MS);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isRunnableValidationCommand(command: string): boolean {
  const normalized = command.trim();
  if (!normalized || normalized.includes('<') || normalized.includes('>')) return false;
  if (/^run\s+/i.test(normalized)) return false;
  return /^(npm|npx|pnpm|yarn|bun|node|tsc|vitest|eslint|test|git)\b/.test(normalized);
}

function resolveVerifyCommand(proposal: SystemImprovementProposal): string {
  const metadataCommands = Array.isArray(proposal.metadata?.validationCommands)
    ? proposal.metadata.validationCommands.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const commands = [...metadataCommands, ...proposal.testPlan]
    .map((command) => command.trim())
    .filter(isRunnableValidationCommand);
  return commands.length > 0 ? commands.join(' && ') : 'npx tsc --noEmit --pretty false';
}

function buildCommandBundle(input: {
  proposal: SystemImprovementProposal;
  patchPath?: string;
}): SystemImprovementReleaseCommandBundle {
  const patchPath = input.patchPath || '<patch-path>';
  const mergeCommand = `git apply ${shellQuote(patchPath)}`;
  const verifyCommand = resolveVerifyCommand(input.proposal);
  const restartCommand = normalizeCommand(input.proposal.metadata?.releaseRestartCommand)
    || normalizeCommand(input.proposal.metadata?.restartCommand)
    || 'npm run build && npm run start';
  const healthCheckCommand = normalizeCommand(input.proposal.metadata?.releaseHealthCheckCommand)
    || normalizeCommand(input.proposal.metadata?.healthCheckCommand)
    || 'curl -fsS http://127.0.0.1:3000/api/health || true';
  const rollbackCommand = input.patchPath
    ? `git apply -R ${shellQuote(input.patchPath)}`
    : input.proposal.rollbackPlan.join(' && ') || `git apply -R ${shellQuote(patchPath)}`;

  return {
    mergeCommand,
    verifyCommand,
    restartCommand,
    rollbackCommand,
    healthCheckCommand,
  };
}

function defaultReleaseGate(proposal: SystemImprovementProposal): SystemImprovementReleaseGateSnapshot {
  return {
    status: 'not-started',
    preflightStatus: 'not-run',
    failureCategory: 'none',
    remediationStatus: 'not-needed',
    remediationAttempts: 0,
    checks: [],
    commands: buildCommandBundle({ proposal }),
    updatedAt: new Date().toISOString(),
  };
}

function getExistingReleaseGate(proposal: SystemImprovementProposal): SystemImprovementReleaseGateSnapshot {
  const value = proposal.exitEvidence?.releaseGate;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaultReleaseGate(proposal);
  }
  const candidate = value as Partial<SystemImprovementReleaseGateSnapshot>;
  if (
    typeof candidate.status !== 'string'
    || typeof candidate.preflightStatus !== 'string'
    || !Array.isArray(candidate.checks)
    || !candidate.commands
  ) {
    return defaultReleaseGate(proposal);
  }
  return {
    ...defaultReleaseGate(proposal),
    ...candidate,
    commands: {
      ...buildCommandBundle({ proposal, patchPath: candidate.patchPath }),
      ...candidate.commands,
    },
  };
}

function check(
  label: string,
  passed: boolean,
  detail: string,
  command?: string,
): SystemImprovementReleasePreflightCheck {
  return {
    label,
    status: passed ? 'passed' : 'failed',
    detail,
    ...(command ? { command } : {}),
  };
}

function releaseEvidencePath(proposalId: string): string {
  const dir = path.join(getPlatformEngineeringEvidencePath(), 'release-gates');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${proposalId}-${Date.now().toString(36)}.patch`);
}

async function listUntrackedFiles(worktreePath: string): Promise<string[]> {
  const raw = await withGitIndexLockRetry(() => runGit(worktreePath, ['ls-files', '--others', '--exclude-standard']));
  return raw.split('\n').map(normalizeRelativePath).filter(Boolean);
}

async function writeWorktreePatch(input: {
  proposal: SystemImprovementProposal;
  worktreePath: string;
  changedFiles: string[];
}): Promise<{ patchPath?: string; patchBytes: number; check: SystemImprovementReleasePreflightCheck }> {
  const changedFiles = input.changedFiles.map(normalizeRelativePath).filter(Boolean);
  if (changedFiles.length === 0) {
    return {
      patchBytes: 0,
      check: check('生成 patch', false, 'Codex evidence 没有 changedFiles，无法生成合并补丁'),
    };
  }

  const untracked = new Set(await listUntrackedFiles(input.worktreePath));
  const untrackedChangedFiles = changedFiles.filter((file) => untracked.has(file));
  if (untrackedChangedFiles.length > 0) {
    await withGitIndexLockRetry(() => runGit(input.worktreePath, ['add', '-N', '--', ...untrackedChangedFiles]));
  }

  const patch = await withGitIndexLockRetry(() => runGitRaw(input.worktreePath, ['diff', '--binary', '--no-ext-diff', '--', ...changedFiles]));
  const patchPath = releaseEvidencePath(input.proposal.id);
  fs.writeFileSync(patchPath, patch, 'utf-8');

  return {
    patchPath,
    patchBytes: Buffer.byteLength(patch),
    check: check(
      '生成 patch',
      patch.trim().length > 0,
      patch.trim().length > 0 ? `${changedFiles.length} 个文件已写入 ${patchPath}` : 'worktree diff 为空，无法合并',
      `git diff --binary --no-ext-diff -- ${changedFiles.join(' ')}`,
    ),
  };
}

async function runApplyCheck(repoPath: string, patchPath: string): Promise<SystemImprovementReleasePreflightCheck> {
  try {
    await runGit(repoPath, ['apply', '--check', '--whitespace=error-all', patchPath]);
    return check(
      '主仓 apply check',
      true,
      '当前主仓可以应用该 patch，没有发现冲突或 whitespace 错误',
      `git apply --check --whitespace=error-all ${patchPath}`,
    );
  } catch (error: unknown) {
    return check(
      '主仓 apply check',
      false,
      error instanceof Error ? error.message : String(error),
      `git apply --check --whitespace=error-all ${patchPath}`,
    );
  }
}

async function runDiffCheck(worktreePath: string): Promise<SystemImprovementReleasePreflightCheck> {
  try {
    await withGitIndexLockRetry(() => runGit(worktreePath, ['diff', '--check']));
    return check('worktree diff check', true, 'worktree diff --check 通过', 'git diff --check');
  } catch (error: unknown) {
    return check(
      'worktree diff check',
      false,
      error instanceof Error ? error.message : String(error),
      'git diff --check',
    );
  }
}

function isWhitespaceFailureText(value: string): boolean {
  return /(trailing whitespace|whitespace error|space before tab|new blank line at eof|行尾空格)/i.test(value);
}

function isPatchApplyDriftFailureText(value: string): boolean {
  return /(patch does not apply|patch failed:|cannot apply binary patch|corrupt patch at line|already exists in working directory)/i.test(value);
}

function isAutoFixableWhitespaceCheck(checkItem: SystemImprovementReleasePreflightCheck): boolean {
  if (checkItem.status !== 'failed') return false;
  if (checkItem.label !== 'worktree diff check' && checkItem.label !== '主仓 apply check') {
    return false;
  }
  return isWhitespaceFailureText(`${checkItem.detail}\n${checkItem.command || ''}`);
}

function classifyFailureCategory(checks: SystemImprovementReleasePreflightCheck[]): SystemImprovementReleaseFailureCategory {
  const failed = checks.filter((item) => item.status === 'failed');
  if (failed.length === 0) return 'none';
  const whitespaceCheckLabels = new Set(['worktree diff check', '主仓 apply check']);
  const onlyWhitespaceRelatedChecks = failed.every((item) => whitespaceCheckLabels.has(item.label));
  if (onlyWhitespaceRelatedChecks && failed.some(isAutoFixableWhitespaceCheck)) {
    return 'auto-fixable';
  }
  if (failed.some((item) => item.label === 'worktree exists' || item.label === 'Codex evidence' || item.label === '生成 patch')) {
    return 'infra-blocking';
  }
  if (failed.some((item) => item.label === 'scope')) {
    return 'policy-blocking';
  }
  if (failed.some((item) => item.label === '主仓 apply check')) {
    return 'policy-blocking';
  }
  return 'quality-blocking';
}

function isCodexRerunEligibleFailure(checks: SystemImprovementReleasePreflightCheck[]): boolean {
  const failed = checks.filter((item) => item.status === 'failed');
  if (!failed.length) return false;

  const blockingLabels = new Set([
    'merge gate',
    '测试证据',
    '回滚计划',
    'Codex evidence',
    'scope',
    'runner validations',
    'worktree exists',
    '生成 patch',
  ]);
  if (failed.some((item) => blockingLabels.has(item.label))) {
    return false;
  }

  return failed.some((item) => (
    item.label === '主仓 apply check'
    && isPatchApplyDriftFailureText(`${item.detail}\n${item.command || ''}`)
  ));
}

function summarizePatchApplyFailure(checks: SystemImprovementReleasePreflightCheck[]): string {
  const failedApplyCheck = checks.find((item) => (
    item.status === 'failed'
    && item.label === '主仓 apply check'
  ));
  if (!failedApplyCheck) {
    return '上一轮 patch 已不再适配当前主仓。';
  }
  const detail = `${failedApplyCheck.detail}`.trim().split('\n').slice(0, 4).join('\n');
  return detail || '上一轮 patch 已不再适配当前主仓。';
}

function buildCodexRerunPrompt(checks: SystemImprovementReleasePreflightCheck[]): string {
  return [
    'Previous preflight failed because the generated patch no longer applies cleanly to the current repository snapshot.',
    'Keep the original proposal goal and file scope, but reconcile the implementation against the latest repository state.',
    'Apply-check excerpt:',
    summarizePatchApplyFailure(checks),
  ].join('\n\n');
}

function stripTrailingWhitespaceFromText(content: string): { content: string; trimmedLines: number } {
  const matches = content.match(TRAILING_WHITESPACE_PATTERN);
  return {
    content: content.replace(TRAILING_WHITESPACE_PATTERN, ''),
    trimmedLines: matches?.length || 0,
  };
}

async function remediateTrailingWhitespace(input: {
  worktreePath: string;
  changedFiles: string[];
}): Promise<{ touchedFiles: number; trimmedLines: number }> {
  let touchedFiles = 0;
  let trimmedLines = 0;

  for (const relativeFile of input.changedFiles.map(normalizeRelativePath).filter(Boolean)) {
    const absolutePath = path.join(input.worktreePath, relativeFile);
    if (!fs.existsSync(absolutePath)) continue;
    const buffer = fs.readFileSync(absolutePath);
    if (buffer.includes(0)) continue;
    const original = buffer.toString('utf-8');
    const stripped = stripTrailingWhitespaceFromText(original);
    if (stripped.trimmedLines === 0 || stripped.content === original) continue;
    fs.writeFileSync(absolutePath, stripped.content, 'utf-8');
    touchedFiles += 1;
    trimmedLines += stripped.trimmedLines;
  }

  return { touchedFiles, trimmedLines };
}

async function collectPreflightChecks(current: SystemImprovementProposal): Promise<{
  checks: SystemImprovementReleasePreflightCheck[];
  patchPath?: string;
  patchBytes: number;
}> {
  const codex = current.exitEvidence?.codex;
  const mergeGate = current.exitEvidence?.mergeGate;
  const checks: SystemImprovementReleasePreflightCheck[] = [
    check('merge gate', mergeGate?.status === 'ready-to-merge', mergeGate?.status || 'missing'),
    check('测试证据', mergeGate?.testsReady === true, mergeGate?.testsReady ? '测试证据已通过' : '测试证据未通过'),
    check('回滚计划', mergeGate?.rollbackReady === true, mergeGate?.rollbackReady ? '回滚计划已存在' : '缺少回滚计划'),
    check('Codex evidence', Boolean(codex), codex ? codex.evidencePath || codex.runId : '缺少 Codex runner evidence'),
  ];

  let patchPath: string | undefined;
  let patchBytes = 0;
  if (codex) {
    checks.push(
      check('scope', codex.scopeCheckPassed && codex.disallowedFiles.length === 0, `${codex.disallowedFiles.length} 个越界文件`),
      check('runner validations', codex.validationCount === codex.passedValidationCount, `${codex.passedValidationCount}/${codex.validationCount} passed`),
      check('worktree exists', fs.existsSync(codex.worktreePath), codex.worktreePath),
    );
    if (fs.existsSync(codex.worktreePath)) {
      const patchResult = await writeWorktreePatch({
        proposal: current,
        worktreePath: codex.worktreePath,
        changedFiles: codex.changedFiles,
      });
      patchPath = patchResult.patchPath;
      patchBytes = patchResult.patchBytes;
      checks.push(patchResult.check);
      checks.push(await runDiffCheck(codex.worktreePath));
      if (patchPath && patchBytes > 0) {
        checks.push(await runApplyCheck(process.cwd(), patchPath));
      }
    }
  }

  return { checks, patchPath, patchBytes };
}

async function preflightRelease(proposal: SystemImprovementProposal): Promise<SystemImprovementReleaseGateSnapshot> {
  const synced = await syncSystemImprovementProposalRuntimeState(proposal.id, { proposal });
  const current = synced || proposal;
  const existingReleaseGate = getExistingReleaseGate(current);
  let codex = current.exitEvidence?.codex;
  let proposalForChecks = current;
  let { checks, patchPath } = await collectPreflightChecks(proposalForChecks);
  let failureCategory = classifyFailureCategory(checks);
  let remediationStatus: SystemImprovementReleaseGateSnapshot['remediationStatus'] = existingReleaseGate.remediationStatus || 'not-needed';
  let remediationAttempts = existingReleaseGate.remediationAttempts || 0;
  let remediationSummary: string | undefined;

  if (failureCategory === 'auto-fixable' && codex && fs.existsSync(codex.worktreePath) && remediationAttempts < MAX_AUTO_REMEDIATION_ATTEMPTS) {
    remediationAttempts += 1;
    const remediation = await remediateTrailingWhitespace({
      worktreePath: codex.worktreePath,
      changedFiles: codex.changedFiles,
    });
    if (remediation.touchedFiles > 0) {
      const rerun = await collectPreflightChecks(current);
      const rerunPassed = rerun.checks.every((item) => item.status === 'passed');
      remediationStatus = rerunPassed ? 'fixed' : 'failed';
      remediationSummary = rerunPassed
        ? `已自动移除 ${remediation.touchedFiles} 个文件中的 ${remediation.trimmedLines} 处行尾空格，并重跑发布前检查。`
        : `已尝试移除 ${remediation.touchedFiles} 个文件中的 ${remediation.trimmedLines} 处行尾空格，但仍有失败项需要内部继续处理。`;
      checks = [
        ...rerun.checks,
        check('auto remediation', rerunPassed, remediationSummary),
      ];
      patchPath = rerun.patchPath;
      failureCategory = classifyFailureCategory(rerun.checks);
    } else {
      remediationStatus = 'failed';
      remediationSummary = '已识别为 whitespace 类失败，但 worktree 中没有找到可自动修复的行尾空格。';
      checks = [...checks, check('auto remediation', false, remediationSummary)];
    }
  }

  if (
    !checks.every((item) => item.status === 'passed')
    && isCodexRerunEligibleFailure(checks)
    && remediationAttempts < MAX_AUTO_REMEDIATION_ATTEMPTS
  ) {
    remediationAttempts += 1;
    try {
      const { runApprovedSystemImprovementCodexTask } = await import('./self-improvement-codex-execution');
      const rerun = await runApprovedSystemImprovementCodexTask(proposalForChecks.id, {
        force: true,
        skipAutoPreflight: true,
        remediationPrompt: buildCodexRerunPrompt(checks),
      });
      proposalForChecks = await syncSystemImprovementProposalRuntimeState(rerun.proposal.id, { proposal: rerun.proposal }) || rerun.proposal;
      codex = proposalForChecks.exitEvidence?.codex;
      const rerunChecks = await collectPreflightChecks(proposalForChecks);
      const rerunPassed = rerunChecks.checks.every((item) => item.status === 'passed');
      remediationStatus = rerunPassed ? 'fixed' : 'failed';
      remediationSummary = rerunPassed
        ? '检测到旧 patch 已不再适配当前主仓，已自动重跑 Codex 并重新生成可应用补丁。'
        : '检测到旧 patch 已不再适配当前主仓，已自动重跑 Codex，但新的发布前检查仍未通过。';
      checks = [
        ...rerunChecks.checks,
        check('auto remediation', rerunPassed, remediationSummary),
      ];
      patchPath = rerunChecks.patchPath;
      failureCategory = classifyFailureCategory(rerunChecks.checks);
    } catch (error: unknown) {
      remediationStatus = 'failed';
      remediationSummary = `检测到旧 patch 已不再适配当前主仓，并已尝试自动重跑 Codex，但执行失败：${error instanceof Error ? error.message : String(error)}`;
      checks = [...checks, check('auto remediation', false, remediationSummary)];
    }
  }

  const passed = checks.every((item) => item.status === 'passed');
  return {
    ...existingReleaseGate,
    status: passed ? 'ready-for-approval' : 'preflight-failed',
    preflightStatus: passed ? 'passed' : 'failed',
    failureCategory: passed ? 'none' : failureCategory,
    remediationStatus: passed && remediationAttempts === 0 ? 'not-needed' : remediationStatus,
    remediationAttempts,
    ...(remediationSummary ? { remediationSummary } : {}),
    checks,
    ...(patchPath ? { patchPath } : {}),
    commands: buildCommandBundle({ proposal: proposalForChecks, patchPath }),
    updatedAt: new Date().toISOString(),
  };
}

function assertReleaseGate(input: {
  releaseGate: SystemImprovementReleaseGateSnapshot;
  allowed: SystemImprovementReleaseGateSnapshot['status'][];
  action: string;
}) {
  if (!input.allowed.includes(input.releaseGate.status)) {
    throw new Error(`Release gate status ${input.releaseGate.status} cannot ${input.action}`);
  }
}

function persistReleaseGate(
  proposal: SystemImprovementProposal,
  releaseGate: SystemImprovementReleaseGateSnapshot,
  patch: Partial<SystemImprovementProposal> = {},
): SystemImprovementProposal {
  const updated = patchSystemImprovementProposal(proposal.id, {
    ...patch,
    exitEvidence: {
      ...(proposal.exitEvidence || {
        testing: {
          plannedCount: proposal.testPlan.length,
          evidenceCount: proposal.testEvidence.length,
          passedCount: proposal.testEvidence.filter((item) => item.status === 'passed').length,
          failedCount: proposal.testEvidence.filter((item) => item.status === 'failed').length,
        },
        mergeGate: {
          status: 'pending',
          approvalReady: false,
          deliveryReady: false,
          testsReady: false,
          rollbackReady: proposal.rollbackPlan.length > 0,
          reasons: ['尚未生成准出证据'],
        },
        updatedAt: new Date().toISOString(),
      }),
      releaseGate,
      updatedAt: new Date().toISOString(),
    },
    ...(patch.metadata ? {
      metadata: {
        ...(proposal.metadata || {}),
        ...patch.metadata,
      },
    } : {}),
  });
  if (!updated) {
    throw new Error(`System improvement proposal not found: ${proposal.id}`);
  }
  return updated;
}

async function persistAndSyncReleaseGate(
  proposal: SystemImprovementProposal,
  releaseGate: SystemImprovementReleaseGateSnapshot,
  patch: Partial<SystemImprovementProposal> = {},
): Promise<SystemImprovementProposal> {
  const updated = persistReleaseGate(proposal, releaseGate, patch);
  return await syncSystemImprovementProposalRuntimeState(updated.id, { proposal: updated }) || updated;
}

export async function maybeAutoRunSystemImprovementPreflight(
  input: MaybeAutoRunSystemImprovementPreflightInput,
): Promise<SystemImprovementProposal> {
  const proposal = input.proposal;
  const synced = await syncSystemImprovementProposalRuntimeState(proposal.id, { proposal });
  const current = synced || proposal;
  const mergeGate = current.exitEvidence?.mergeGate;
  if (mergeGate?.status !== 'ready-to-merge') {
    return current;
  }

  const releaseGate = current.exitEvidence?.releaseGate;
  if (
    releaseGate
    && typeof releaseGate === 'object'
    && !Array.isArray(releaseGate)
    && 'preflightStatus' in releaseGate
    && 'status' in releaseGate
  ) {
    const preflightStatus = releaseGate.preflightStatus;
    const status = releaseGate.status;
    if (preflightStatus !== 'not-run' && status !== 'not-started') {
      return current;
    }
  }

  const result = await runSystemImprovementReleaseAction(current.id, { action: 'preflight' });
  return result.proposal;
}

export async function runSystemImprovementReleaseAction(
  proposalId: string,
  input: SystemImprovementReleaseActionInput,
): Promise<SystemImprovementReleaseActionResult> {
  const proposal = getSystemImprovementProposal(proposalId);
  if (!proposal) {
    throw new Error(`System improvement proposal not found: ${proposalId}`);
  }

  if (input.action === 'preflight') {
    const synced = await syncSystemImprovementProposalRuntimeState(proposal.id, { proposal });
    const current = synced || proposal;
    const releaseGate = await preflightRelease(current);
    const latestProposal = getSystemImprovementProposal(proposalId) || current;
    const updated = await persistAndSyncReleaseGate(latestProposal, releaseGate);
    return { proposal: updated, releaseGate };
  }

  const releaseGate = getExistingReleaseGate(proposal);
  const now = new Date().toISOString();

  if (input.action === 'approve') {
    assertReleaseGate({
      releaseGate,
      allowed: ['ready-for-approval', 'approved'],
      action: 'be approved',
    });
    const next = {
      ...releaseGate,
      status: 'approved' as const,
      approvedAt: now,
      approvedBy: input.actor || 'CEO/Ops',
      ...(input.note ? { approvalNote: input.note } : {}),
      updatedAt: now,
    };
    const updated = await persistAndSyncReleaseGate(proposal, next);
    return { proposal: updated, releaseGate: next };
  }

  if (input.action === 'mark-merged') {
    assertReleaseGate({
      releaseGate,
      allowed: ['approved', 'merged'],
      action: 'be marked merged',
    });
    const next = {
      ...releaseGate,
      status: 'merged' as const,
      mergedAt: now,
      ...(input.mergeCommitSha ? { mergeCommitSha: input.mergeCommitSha } : {}),
      updatedAt: now,
    };
    const updated = await persistAndSyncReleaseGate(proposal, next);
    return { proposal: updated, releaseGate: next };
  }

  if (input.action === 'mark-restarted') {
    assertReleaseGate({
      releaseGate,
      allowed: ['merged', 'restarted'],
      action: 'be marked restarted',
    });
    const next = {
      ...releaseGate,
      status: 'restarted' as const,
      restartedAt: now,
      restartTarget: input.restartTarget || 'primary-app',
      healthCheckSummary: input.healthCheckSummary || releaseGate.commands.healthCheckCommand || 'Restart marked by Ops.',
      updatedAt: now,
    };
    const updated = await persistAndSyncReleaseGate(proposal, next, { status: 'published' });
    return { proposal: updated, releaseGate: next };
  }

  if (input.action === 'start-observation') {
    assertReleaseGate({
      releaseGate,
      allowed: ['restarted', 'observing'],
      action: 'start observation',
    });
    const next = {
      ...releaseGate,
      status: 'observing' as const,
      observingAt: now,
      observationSummary: input.observationSummary || input.note || 'Release observation started.',
      updatedAt: now,
    };
    const updated = await persistAndSyncReleaseGate(proposal, next, {
      status: 'observing',
      metadata: {
        ...(proposal.metadata || {}),
        releaseGate: next,
        observationSummary: next.observationSummary,
        observedAt: now,
      },
    });
    return { proposal: updated, releaseGate: next };
  }

  if (input.action === 'mark-rolled-back') {
    const next = {
      ...releaseGate,
      status: 'rolled-back' as const,
      rolledBackAt: now,
      rollbackReason: input.rollbackReason || input.note || 'Rollback marked by Ops.',
      updatedAt: now,
    };
    const updated = await persistAndSyncReleaseGate(proposal, next, { status: 'rolled-back' });
    return { proposal: updated, releaseGate: next };
  }

  throw new Error(`Unsupported release action: ${input.action}`);
}
