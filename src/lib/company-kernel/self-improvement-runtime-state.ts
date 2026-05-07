import type { AgentRunState, RunStatus } from '../agents/group-types';
import { getProject } from '../agents/project-registry';
import type { ProjectDefinition } from '../agents/project-types';
import type {
  SystemImprovementAutomationState,
  SystemImprovementCodexExecutionSnapshot,
  SystemImprovementExecutionProjectSnapshot,
  SystemImprovementExecutionRunSnapshot,
  SystemImprovementExitEvidenceBundle,
  SystemImprovementHumanGate,
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
  const value = proposal.exitEvidence?.releaseGate;
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
    || getImprovementRunId(proposal),
  );
}

function shouldSyncGovernanceWithoutRuntimeContext(proposal: SystemImprovementProposal): boolean {
  return proposal.status === 'approval-required';
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
  const releaseGateStatus = input.exitEvidence.releaseGate?.status;

  if (TERMINAL_PROPOSAL_STATUSES.has(input.proposal.status)) {
    return input.proposal.status;
  }
  if (!hasRuntimeExecutionContext(input.proposal)) {
    return input.proposal.status;
  }
  if (requiresApproval(input.proposal) && !hasApprovedProposal(input.proposal)) {
    return 'approval-required';
  }
  if (releaseGateStatus === 'preflight-failed') {
    return 'testing';
  }
  if (
    releaseGateStatus === 'ready-for-approval'
    || releaseGateStatus === 'approved'
    || releaseGateStatus === 'merged'
  ) {
    return 'ready-to-merge';
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

function deriveAutomationState(input: {
  proposal: SystemImprovementProposal;
  exitEvidence: SystemImprovementExitEvidenceBundle;
  latestRun: AgentRunState | null;
}): SystemImprovementAutomationState {
  const releaseGateStatus = input.exitEvidence.releaseGate?.status;
  const now = new Date().toISOString();

  if (input.proposal.status === 'approval-required') {
    return {
      status: 'queued',
      summary: '等待准入审批，AI 尚未进入实现阶段。',
      updatedAt: now,
    };
  }

  if (releaseGateStatus === 'ready-for-approval') {
    return {
      status: 'exit-ready',
      summary: 'AI 已完成实现、验证和发布前检查，等待最终准出审批。',
      updatedAt: now,
    };
  }

  if (releaseGateStatus === 'approved') {
    return {
      status: 'exit-ready',
      summary: '准出已批准，等待 Ops 完成合并与发布动作。',
      updatedAt: now,
    };
  }

  if (releaseGateStatus === 'merged') {
    return {
      status: 'exit-ready',
      summary: '代码已合并，等待 Ops 完成重启与发布收口。',
      updatedAt: now,
    };
  }

  if (releaseGateStatus === 'restarted' || input.proposal.status === 'published') {
    return {
      status: 'exit-ready',
      summary: input.exitEvidence.releaseGate?.healthCheckSummary || 'Ops 已完成重启与健康检查，等待进入观察阶段。',
      updatedAt: now,
    };
  }

  if (releaseGateStatus === 'observing' || input.proposal.status === 'observing') {
    return {
      status: 'exit-ready',
      summary: input.exitEvidence.releaseGate?.observationSummary || '发布后观察中。',
      updatedAt: now,
    };
  }

  if (releaseGateStatus === 'rolled-back' || input.proposal.status === 'rolled-back') {
    return {
      status: 'blocked',
      summary: input.exitEvidence.releaseGate?.rollbackReason || '该改进已回滚。',
      updatedAt: now,
    };
  }

  if (releaseGateStatus === 'preflight-failed') {
    const remediationSummary = input.exitEvidence.releaseGate?.remediationSummary;
    return {
      status: 'blocked',
      summary: remediationSummary || '发布前检查仍有失败项，继续留在 AI / Ops 内部处理，不进入 CEO 准出。',
      updatedAt: now,
    };
  }

  const latestRunStatus = input.latestRun?.status;
  if ((latestRunStatus && ACTIVE_RUN_STATUSES.has(latestRunStatus)) || input.exitEvidence.project?.status === 'active') {
    return {
      status: 'executing',
      summary: 'AI 正在平台工程项目中实现这条提升。',
      updatedAt: now,
    };
  }

  if (input.exitEvidence.mergeGate.status === 'blocked') {
    return {
      status: 'blocked',
      summary: '实现或验证仍有阻塞项，继续留在 AI / Ops 内部处理。',
      updatedAt: now,
    };
  }

  if (input.exitEvidence.mergeGate.status === 'ready-to-merge') {
    return {
      status: 'validating',
      summary: '实现与基础校验已完成，等待发布前检查收口。',
      updatedAt: now,
    };
  }

  if (
    input.exitEvidence.mergeGate.deliveryReady
    || input.exitEvidence.testing.evidenceCount > 0
    || Boolean(input.exitEvidence.codex)
  ) {
    return {
      status: 'validating',
      summary: 'AI 正在收口验证结果与发布证据。',
      updatedAt: now,
    };
  }

  return {
    status: 'queued',
    summary: '已进入执行主线，等待 AI 启动实现。',
    updatedAt: now,
  };
}

function deriveHumanGate(input: {
  proposal: SystemImprovementProposal;
  automationState: SystemImprovementAutomationState;
  exitEvidence: SystemImprovementExitEvidenceBundle;
}): SystemImprovementHumanGate {
  const now = new Date().toISOString();

  if (input.proposal.status === 'approval-required') {
    return {
      state: 'entry-approval-required',
      title: '是否批准这条系统能力提升进入实现？',
      summary: '批准后，AI 会自动完成实现、验证、补证据和发布前检查准备。',
      updatedAt: now,
    };
  }

  if (input.exitEvidence.releaseGate?.status === 'ready-for-approval') {
    return {
      state: 'exit-approval-required',
      title: 'AI 已完成实现并通过验证，是否批准合入主线？',
      summary: '当前只剩最终准出确认，技术问题已清零，不需要人类处理代码细节。',
      updatedAt: now,
    };
  }

  return {
    state: 'none',
    title: '当前没有需要 CEO 审批的动作',
    summary: input.automationState.summary,
    updatedAt: now,
  };
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
  const proposal = getSystemImprovementProposal(proposalId) || input.proposal;
  if (!proposal) return null;
  if (
    !hasRuntimeExecutionContext(proposal)
    && !shouldSyncGovernanceWithoutRuntimeContext(proposal)
  ) {
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
  const automationState = deriveAutomationState({
    proposal,
    exitEvidence,
    latestRun,
  });
  const humanGate = deriveHumanGate({
    proposal,
    automationState,
    exitEvidence,
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
  const currentAutomationComparable = stableSerialize(proposal.automationState || null);
  const nextAutomationComparable = stableSerialize(automationState);
  const currentHumanGateComparable = stableSerialize(proposal.humanGate || null);
  const nextHumanGateComparable = stableSerialize(humanGate);

  if (
    proposal.status === nextStatus
    && currentAutomationComparable === nextAutomationComparable
    && currentHumanGateComparable === nextHumanGateComparable
    && currentEvidenceComparable === nextEvidenceComparable
    && currentMetadataComparable === nextMetadataComparable
  ) {
    return proposal;
  }

  const updated = patchSystemImprovementProposal(proposal.id, {
    status: nextStatus,
    automationState,
    humanGate,
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
  const proposals = synced.filter((proposal): proposal is SystemImprovementProposal => Boolean(proposal));
  if (proposals.length === 0) return [];
  const { maybeAutoRunSystemImprovementPreflight } = await import('./self-improvement-release-gate');
  const withPreflight = await Promise.all(proposals.map((proposal) => maybeAutoRunSystemImprovementPreflight({ proposal })));
  return withPreflight;
}

export async function syncAllActiveSystemImprovementProposals(): Promise<SystemImprovementProposal[]> {
  const proposals = listSystemImprovementProposals().filter((proposal) => !TERMINAL_PROPOSAL_STATUSES.has(proposal.status));
  const synced = await Promise.all(proposals.map((proposal) => syncSystemImprovementProposalRuntimeState(proposal.id, { proposal })));
  return synced.filter((proposal): proposal is SystemImprovementProposal => Boolean(proposal));
}
