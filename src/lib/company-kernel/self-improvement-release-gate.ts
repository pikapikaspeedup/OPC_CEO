import { execFile as execFileCallback } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { getPlatformEngineeringEvidencePath } from '../platform-engineering';
import type {
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
    checks: [],
    commands: buildCommandBundle({ proposal }),
    updatedAt: new Date().toISOString(),
  };
}

function getExistingReleaseGate(proposal: SystemImprovementProposal): SystemImprovementReleaseGateSnapshot {
  const value = proposal.exitEvidence?.releaseGate || proposal.metadata?.releaseGate;
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
  const raw = await runGit(worktreePath, ['ls-files', '--others', '--exclude-standard']);
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
    await runGit(input.worktreePath, ['add', '-N', '--', ...untrackedChangedFiles]);
  }

  const patch = await runGitRaw(input.worktreePath, ['diff', '--binary', '--no-ext-diff', '--', ...changedFiles]);
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
    await runGit(worktreePath, ['diff', '--check']);
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

async function preflightRelease(proposal: SystemImprovementProposal): Promise<SystemImprovementReleaseGateSnapshot> {
  const synced = await syncSystemImprovementProposalRuntimeState(proposal.id, { proposal });
  const current = synced || proposal;
  const codex = current.exitEvidence?.codex;
  const mergeGate = current.exitEvidence?.mergeGate;
  const checks: SystemImprovementReleasePreflightCheck[] = [
    check('merge gate', mergeGate?.status === 'ready-to-merge', mergeGate?.status || 'missing'),
    check('测试证据', mergeGate?.testsReady === true, mergeGate?.testsReady ? '测试证据已通过' : '测试证据未通过'),
    check('回滚计划', mergeGate?.rollbackReady === true, mergeGate?.rollbackReady ? '回滚计划已存在' : '缺少回滚计划'),
    check('Codex evidence', Boolean(codex), codex ? codex.evidencePath || codex.runId : '缺少 Codex runner evidence'),
  ];

  let patchPath: string | undefined;
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
      checks.push(patchResult.check);
      checks.push(await runDiffCheck(codex.worktreePath));
      if (patchPath && patchResult.patchBytes > 0) {
        checks.push(await runApplyCheck(process.cwd(), patchPath));
      }
    }
  }

  const passed = checks.every((item) => item.status === 'passed');
  return {
    ...getExistingReleaseGate(current),
    status: passed ? 'ready-for-approval' : 'preflight-failed',
    preflightStatus: passed ? 'passed' : 'failed',
    checks,
    ...(patchPath ? { patchPath } : {}),
    commands: buildCommandBundle({ proposal: current, patchPath }),
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
    metadata: {
      ...(proposal.metadata || {}),
      ...(patch.metadata || {}),
      releaseGate,
    },
  });
  if (!updated) {
    throw new Error(`System improvement proposal not found: ${proposal.id}`);
  }
  return updated;
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
    const releaseGate = await preflightRelease(proposal);
    const updated = persistReleaseGate(proposal, releaseGate);
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
    const updated = persistReleaseGate(proposal, next);
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
    const updated = persistReleaseGate(proposal, next);
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
    const updated = persistReleaseGate(proposal, next, { status: 'published' });
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
    const updated = persistReleaseGate(proposal, next, {
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
    const updated = persistReleaseGate(proposal, next, { status: 'rolled-back' });
    return { proposal: updated, releaseGate: next };
  }

  throw new Error(`Unsupported release action: ${input.action}`);
}
