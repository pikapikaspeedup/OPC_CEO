import type { AgentRunState, RunStatus } from '../agents/group-types';
import { getProject } from '../agents/project-registry';
import type { ProjectDefinition } from '../agents/project-types';
import type {
  SystemImprovementCodexExecutionSnapshot,
  SystemImprovementExecutionProjectSnapshot,
  SystemImprovementExecutionRunSnapshot,
  SystemImprovementExitEvidenceBundle,
  SystemImprovementMergeGateSummary,
  SystemImprovementProposal,
  SystemImprovementProposalStatus,
  SystemImprovementReleaseGateSnapshot,
} from './contracts';
import {
  getSystemImprovementProposal,
  listSystemImprovementProposals,
  patchSystemImprovementProposal,
} from './self-improvement-store';

const ACTIVE_RUN_STATUSES = new Set<RunStatus>(['queued', 'starting', 'running']);
const FAILED_RUN_STATUSES = new Set<RunStatus>(['failed', 'blocked', 'timeout', 'cancelled']);
const TERMINAL_PROPOSAL_STATUSES = new Set<SystemImprovementProposalStatus>([
  'published',
  'rejected',
  'rolled-back',
  'observing',
]);

function stableSerialize(value: unknown): string {
  return JSON.stringify(value);
}

function requiresApproval(proposal: SystemImprovementProposal): boolean {
  return proposal.risk === 'high' || proposal.risk === 'critical';
}

function hasApprovedProposal(proposal: SystemImprovementProposal): boolean {
  return proposal.status === 'approved'
    || proposal.status === 'in-progress'
    || proposal.status === 'testing'
    || proposal.status === 'ready-to-merge'
    || proposal.metadata?.approvalStatus === 'approved'
    || typeof proposal.metadata?.approvedAt === 'string';
}

function getImprovementProjectId(proposal: SystemImprovementProposal): string | null {
  const value = proposal.metadata?.improvementProjectId;
  return typeof value === 'string' && value ? value : null;
}

function getImprovementRunId(proposal: SystemImprovementProposal): string | null {
  const value = proposal.metadata?.improvementRunId;
  return typeof value === 'string' && value ? value : null;
}

function getLaunchStatus(proposal: SystemImprovementProposal): string | null {
  const value = proposal.metadata?.launchStatus;
  return typeof value === 'string' && value ? value : null;
}

function getCodexEvidence(proposal: SystemImprovementProposal): SystemImprovementCodexExecutionSnapshot | null {
  const value = proposal.metadata?.codexRunnerEvidence;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<SystemImprovementCodexExecutionSnapshot>;
  if (
    typeof candidate.runId !== 'string'
    || typeof candidate.taskKey !== 'string'
    || typeof candidate.branch !== 'string'
    || typeof candidate.worktreePath !== 'string'
    || typeof candidate.baseSha !== 'string'
    || typeof candidate.headSha !== 'string'
    || !Array.isArray(candidate.changedFiles)
    || !Array.isArray(candidate.allowedPathPrefixes)
    || !Array.isArray(candidate.disallowedFiles)
  ) {
    return null;
  }
  return candidate as SystemImprovementCodexExecutionSnapshot;
}

function getReleaseGate(proposal: SystemImprovementProposal): SystemImprovementReleaseGateSnapshot | null {
  const value = proposal.exitEvidence?.releaseGate || proposal.metadata?.releaseGate;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<SystemImprovementReleaseGateSnapshot>;
  if (
    typeof candidate.status !== 'string'
    || typeof candidate.preflightStatus !== 'string'
    || !Array.isArray(candidate.checks)
    || !candidate.commands
    || typeof candidate.commands !== 'object'
    || typeof candidate.updatedAt !== 'string'
  ) {
    return null;
  }
  return candidate as SystemImprovementReleaseGateSnapshot;
}

function hasRuntimeExecutionContext(proposal: SystemImprovementProposal): boolean {
  return Boolean(
    getImprovementProjectId(proposal)
    || getImprovementRunId(proposal)
    || getLaunchStatus(proposal)
    || getCodexEvidence(proposal),
  );
}

function summarizeProject(project: ProjectDefinition): SystemImprovementExecutionProjectSnapshot {
  return {
    projectId: project.projectId,
    name: project.name,
    status: project.status,
    workspaceUri: project.workspace,
    templateId: project.templateId,
    runCount: project.runIds.length,
    updatedAt: project.updatedAt,
  };
}

function summarizeRun(run: AgentRunState): SystemImprovementExecutionRunSnapshot {
  return {
    runId: run.runId,
    status: run.status,
    stageId: run.stageId,
    summary: run.result?.summary,
    lastError: run.lastError,
    changedFilesCount: run.result?.changedFiles.length || 0,
    blockerCount: run.result?.blockers.length || 0,
    finishedAt: run.finishedAt,
    updatedAt: run.finishedAt || run.startedAt || run.createdAt,
  };
}

async function resolveLatestRun(
  proposal: SystemImprovementProposal,
  project: ProjectDefinition | null,
  preferredRun?: AgentRunState | null,
): Promise<AgentRunState | null> {
  if (preferredRun) {
    return preferredRun;
  }
  const improvementRunId = getImprovementRunId(proposal);
  const { getRun } = await import('../agents/run-registry');
  if (improvementRunId) {
    const exact = getRun(improvementRunId);
    if (exact) return exact;
  }
  if (!project?.runIds.length) return null;
  const candidates = project.runIds
    .map((runId) => getRun(runId))
    .filter((run): run is AgentRunState => Boolean(run));
  if (candidates.length === 0) return null;
  return candidates.sort((left, right) => {
    const leftTime = new Date(left.finishedAt || left.startedAt || left.createdAt).getTime();
    const rightTime = new Date(right.finishedAt || right.startedAt || right.createdAt).getTime();
    return rightTime - leftTime;
  })[0] || null;
}

function buildMergeGate(input: {
  proposal: SystemImprovementProposal;
  deliveryReady: boolean;
  deliveryBlocked: boolean;
}): SystemImprovementMergeGateSummary {
  const latestTest = input.proposal.testEvidence.at(-1);
  const approvalReady = !requiresApproval(input.proposal) || hasApprovedProposal(input.proposal);
  const testsReady = latestTest?.status === 'passed';
  const rollbackReady = input.proposal.rollbackPlan.length > 0;
  const reasons: string[] = [];

  if (!approvalReady) reasons.push('等待 CEO 准入审批');
  if (!input.deliveryReady) reasons.push(input.deliveryBlocked ? '平台工程项目当前处于失败或阻塞态' : '平台工程项目尚未完成交付');
  if (!testsReady) {
    if (!latestTest) reasons.push('尚未提交测试证据');
    else if (latestTest.status === 'failed') reasons.push('最近一次测试证据失败');
  }
  if (!rollbackReady) reasons.push('缺少回滚计划');

  return {
    status: reasons.length === 0 ? 'ready-to-merge' : (input.deliveryBlocked || latestTest?.status === 'failed' ? 'blocked' : 'pending'),
    approvalReady,
    deliveryReady: input.deliveryReady,
    testsReady,
    rollbackReady,
    reasons,
  };
}

function buildExitEvidenceBundle(input: {
  proposal: SystemImprovementProposal;
  project: ProjectDefinition | null;
  latestRun: AgentRunState | null;
}): SystemImprovementExitEvidenceBundle {
  const latestTest = input.proposal.testEvidence.at(-1);
  const codexEvidence = getCodexEvidence(input.proposal);
  const releaseGate = getReleaseGate(input.proposal);
  const deliveryReady = input.project?.status === 'completed'
    || (!input.project && input.latestRun?.status === 'completed')
    || Boolean(codexEvidence?.evidencePath);
  const deliveryBlocked = input.project?.status === 'failed'
    || input.project?.status === 'cancelled'
    || input.project?.status === 'paused'
    || (input.latestRun ? FAILED_RUN_STATUSES.has(input.latestRun.status) : false)
    || getLaunchStatus(input.proposal) === 'dispatch-failed'
    || getLaunchStatus(input.proposal) === 'codex-failed';

  return {
    ...(input.project ? { project: summarizeProject(input.project) } : {}),
    ...(input.latestRun ? { latestRun: summarizeRun(input.latestRun) } : {}),
    ...(codexEvidence ? { codex: codexEvidence } : {}),
    testing: {
      plannedCount: input.proposal.testPlan.length,
      evidenceCount: input.proposal.testEvidence.length,
      passedCount: input.proposal.testEvidence.filter((item) => item.status === 'passed').length,
      failedCount: input.proposal.testEvidence.filter((item) => item.status === 'failed').length,
      latestStatus: latestTest?.status,
      latestCommand: latestTest?.command,
      latestSummary: latestTest?.outputSummary,
      latestAt: latestTest?.createdAt,
    },
    mergeGate: buildMergeGate({
      proposal: input.proposal,
      deliveryReady: Boolean(deliveryReady),
      deliveryBlocked: Boolean(deliveryBlocked),
    }),
    ...(releaseGate ? { releaseGate } : {}),
    updatedAt: new Date().toISOString(),
  };
}

function deriveProposalStatus(input: {
  proposal: SystemImprovementProposal;
  exitEvidence: SystemImprovementExitEvidenceBundle;
  latestRun: AgentRunState | null;
}): SystemImprovementProposalStatus {
  if (TERMINAL_PROPOSAL_STATUSES.has(input.proposal.status)) {
    return input.proposal.status;
  }
  if (!hasRuntimeExecutionContext(input.proposal)) {
    return input.proposal.status;
  }
  if (requiresApproval(input.proposal) && !hasApprovedProposal(input.proposal)) {
    return 'approval-required';
  }
  if (input.exitEvidence.mergeGate.status === 'ready-to-merge') {
    return 'ready-to-merge';
  }
  if (input.exitEvidence.mergeGate.deliveryReady) {
    return 'testing';
  }
  const latestRunStatus = input.latestRun?.status;
  if ((latestRunStatus && ACTIVE_RUN_STATUSES.has(latestRunStatus)) || input.exitEvidence.project?.status === 'active') {
    return 'in-progress';
  }
  if (input.exitEvidence.mergeGate.status === 'blocked') {
    return 'in-progress';
  }
  return input.proposal.status === 'approved' ? 'approved' : 'in-progress';
}

function deriveLaunchStatus(input: {
  proposal: SystemImprovementProposal;
  project: ProjectDefinition | null;
  latestRun: AgentRunState | null;
  nextStatus: SystemImprovementProposalStatus;
}): string | null {
  const current = getLaunchStatus(input.proposal);
  if (current === 'dispatch-failed' || current === 'codex-failed') return current;
  if (input.project?.status === 'completed' || input.nextStatus === 'ready-to-merge' || input.nextStatus === 'testing') {
    return 'delivery-complete';
  }
  if (input.project?.status === 'failed' || input.project?.status === 'cancelled' || input.project?.status === 'paused') {
    return 'project-blocked';
  }
  if (input.latestRun && FAILED_RUN_STATUSES.has(input.latestRun.status)) {
    return 'run-blocked';
  }
  if (input.latestRun && ACTIVE_RUN_STATUSES.has(input.latestRun.status)) {
    return 'running';
  }
  return current;
}

export async function syncSystemImprovementProposalRuntimeState(
  proposalId: string,
  input: {
    proposal?: SystemImprovementProposal | null;
    project?: ProjectDefinition | null;
    latestRun?: AgentRunState | null;
  } = {},
): Promise<SystemImprovementProposal | null> {
  const proposal = input.proposal || getSystemImprovementProposal(proposalId);
  if (!proposal) return null;
  if (!hasRuntimeExecutionContext(proposal)) {
    return proposal;
  }

  const project = input.project === undefined
    ? (() => {
      const projectId = getImprovementProjectId(proposal);
      return projectId ? getProject(projectId) : null;
    })()
    : input.project;
  const latestRun = await resolveLatestRun(proposal, project || null, input.latestRun || null);
  const exitEvidence = buildExitEvidenceBundle({
    proposal,
    project: project || null,
    latestRun,
  });
  const nextStatus = deriveProposalStatus({
    proposal,
    exitEvidence,
    latestRun,
  });
  const nextLaunchStatus = deriveLaunchStatus({
    proposal,
    project: project || null,
    latestRun,
    nextStatus,
  });
  const nextMetadata = nextLaunchStatus
    ? {
      ...(proposal.metadata || {}),
      launchStatus: nextLaunchStatus,
    }
    : proposal.metadata;
  const currentEvidenceComparable = stableSerialize({
    ...(proposal.exitEvidence || {}),
    updatedAt: null,
  });
  const nextEvidenceComparable = stableSerialize({
    ...exitEvidence,
    updatedAt: null,
  });
  const currentMetadataComparable = stableSerialize(proposal.metadata || {});
  const nextMetadataComparable = stableSerialize(nextMetadata || {});

  if (
    proposal.status === nextStatus
    && currentEvidenceComparable === nextEvidenceComparable
    && currentMetadataComparable === nextMetadataComparable
  ) {
    return proposal;
  }

  const updated = patchSystemImprovementProposal(proposal.id, {
    status: nextStatus,
    exitEvidence,
    ...(nextMetadata ? { metadata: nextMetadata } : {}),
  });
  return updated || proposal;
}

export async function syncSystemImprovementProposalsForRun(run: AgentRunState): Promise<SystemImprovementProposal[]> {
  const candidates = listSystemImprovementProposals().filter((proposal) => {
    if (proposal.metadata?.improvementProjectId === run.projectId) return true;
    if (proposal.metadata?.improvementRunId === run.runId) return true;
    return proposal.linkedRunIds.includes(run.runId);
  });
  if (candidates.length === 0) return [];
  const project = run.projectId ? getProject(run.projectId) : null;
  const synced = await Promise.all(candidates.map((proposal) => syncSystemImprovementProposalRuntimeState(proposal.id, {
    proposal,
    project,
    latestRun: run,
  })));
  return synced.filter((proposal): proposal is SystemImprovementProposal => Boolean(proposal));
}

export async function syncAllActiveSystemImprovementProposals(): Promise<SystemImprovementProposal[]> {
  const proposals = listSystemImprovementProposals().filter((proposal) => !TERMINAL_PROPOSAL_STATUSES.has(proposal.status));
  const synced = await Promise.all(proposals.map((proposal) => syncSystemImprovementProposalRuntimeState(proposal.id, { proposal })));
  return synced.filter((proposal): proposal is SystemImprovementProposal => Boolean(proposal));
}
