import { getApprovalRequest } from '../approval/request-store';
import type {
  SystemImprovementControlMilestone,
  SystemImprovementControlNextAction,
  SystemImprovementControlOwner,
  SystemImprovementControlPageMode,
  SystemImprovementControlStage,
  SystemImprovementEntryApprovalSummary,
  SystemImprovementProposal,
  SystemImprovementProposalView,
  SystemImprovementReleaseGateSnapshot,
} from './contracts';

function formatRisk(risk: SystemImprovementProposal['risk']): string {
  switch (risk) {
    case 'critical':
      return '关键风险';
    case 'high':
      return '高风险';
    case 'medium':
      return '中风险';
    case 'low':
    default:
      return '低风险';
  }
}

function formatReleaseCheckSummary(releaseGate?: SystemImprovementReleaseGateSnapshot): string {
  if (!releaseGate) return '发布前检查尚未开始';
  if (!releaseGate.checks.length) return '发布前检查尚未生成结果';
  const passedCount = releaseGate.checks.filter((item) => item.status === 'passed').length;
  return `发布前检查 ${passedCount}/${releaseGate.checks.length} 通过`;
}

function buildDerivedEntryApprovalSummary(proposal: SystemImprovementProposal): SystemImprovementEntryApprovalSummary | undefined {
  if (!proposal.approvalRequestId) return undefined;
  if (
    proposal.metadata?.approvalStatus === 'approved'
    || typeof proposal.metadata?.approvedAt === 'string'
    || proposal.status === 'approved'
    || proposal.status === 'in-progress'
    || proposal.status === 'testing'
    || proposal.status === 'ready-to-merge'
  ) {
    return {
      requestId: proposal.approvalRequestId,
      status: 'approved',
      ...(typeof proposal.metadata?.approvedBy === 'string' && proposal.metadata.approvedBy
        ? { actedBy: proposal.metadata.approvedBy }
        : {}),
      ...(typeof proposal.metadata?.approvedAt === 'string' && proposal.metadata.approvedAt
        ? { actedAt: proposal.metadata.approvedAt }
        : {}),
    };
  }
  if (proposal.status === 'rejected') {
    return {
      requestId: proposal.approvalRequestId,
      status: 'rejected',
      ...(typeof proposal.metadata?.rejectedReason === 'string' && proposal.metadata.rejectedReason
        ? { message: proposal.metadata.rejectedReason }
        : {}),
    };
  }
  return undefined;
}

function buildEntryApprovalSummary(proposal: SystemImprovementProposal): SystemImprovementEntryApprovalSummary | undefined {
  if (!proposal.approvalRequestId) return undefined;
  const request = getApprovalRequest(proposal.approvalRequestId);
  const derived = buildDerivedEntryApprovalSummary(proposal);
  if (request?.status === 'pending' && derived?.status && derived.status !== 'pending') {
    return derived;
  }
  if (!request) {
    return derived || {
      requestId: proposal.approvalRequestId,
      status: 'pending',
    };
  }
  return {
    requestId: request.id,
    status: request.status,
    ...(request.response?.channel ? { actedBy: request.response.channel === 'web' ? 'CEO' : request.response.channel } : {}),
    ...(request.response?.respondedAt ? { actedAt: request.response.respondedAt } : {}),
    ...(request.response?.message ? { message: request.response.message } : {}),
  };
}

function hasEntryApprovalCompleted(proposal: SystemImprovementProposal, approvalSummary?: SystemImprovementEntryApprovalSummary): boolean {
  if (approvalSummary?.status === 'approved' || approvalSummary?.status === 'rejected') return true;
  return proposal.status !== 'approval-required'
    && proposal.status !== 'draft'
    && proposal.status !== 'needs-evidence'
    && proposal.status !== 'rejected';
}

function isEntryApprovalRejected(
  proposal: SystemImprovementProposal,
  approvalSummary?: SystemImprovementEntryApprovalSummary,
): boolean {
  return proposal.status === 'rejected' || approvalSummary?.status === 'rejected';
}

function resolveStage(
  proposal: SystemImprovementProposal,
  approvalSummary?: SystemImprovementEntryApprovalSummary,
): SystemImprovementControlStage {
  const releaseGate = proposal.exitEvidence?.releaseGate;
  const automationStatus = proposal.automationState?.status;

  if (releaseGate?.status === 'rolled-back' || proposal.status === 'rolled-back') return 'rolled-back';
  if (releaseGate?.status === 'observing' || proposal.status === 'observing') return 'observing';
  if (releaseGate?.status === 'restarted' || proposal.status === 'published') return 'published';
  if (releaseGate?.status === 'merged') return 'ops-restart';
  if (releaseGate?.status === 'approved') return 'ops-merge';
  if (proposal.humanGate?.state === 'exit-approval-required' || releaseGate?.status === 'ready-for-approval') return 'exit-review';
  if (isEntryApprovalRejected(proposal, approvalSummary)) return 'blocked';
  if (
    proposal.humanGate?.state === 'entry-approval-required'
    || proposal.status === 'approval-required'
  ) {
    return 'entry-review';
  }
  if (proposal.status === 'ready-to-merge') {
    return 'ai-preflight';
  }
  if (releaseGate?.status === 'preflight-failed' || automationStatus === 'blocked') {
    return 'blocked';
  }
  if (
    automationStatus === 'validating'
    || automationStatus === 'remediating'
    || proposal.exitEvidence?.mergeGate.status === 'ready-to-merge'
  ) {
    return 'ai-preflight';
  }
  if (
    automationStatus === 'queued'
    || automationStatus === 'executing'
    || proposal.status === 'approved'
    || proposal.status === 'in-progress'
    || proposal.status === 'testing'
  ) {
    return 'ai-executing';
  }
  return 'blocked';
}

function resolveOwner(
  proposal: SystemImprovementProposal,
  stage: SystemImprovementControlStage,
  approvalSummary?: SystemImprovementEntryApprovalSummary,
): SystemImprovementControlOwner {
  if (isEntryApprovalRejected(proposal, approvalSummary)) return 'none';
  switch (stage) {
    case 'entry-review':
    case 'exit-review':
      return 'ceo';
    case 'ai-executing':
    case 'ai-preflight':
    case 'blocked':
      return proposal.exitEvidence?.releaseGate?.status === 'preflight-failed' ? 'ai' : 'ai';
    case 'ops-merge':
    case 'ops-restart':
    case 'published':
    case 'observing':
      return 'ops';
    case 'rolled-back':
      return 'none';
    default:
      return 'none';
  }
}

function resolveNextAction(
  proposal: SystemImprovementProposal,
  stage: SystemImprovementControlStage,
  approvalSummary?: SystemImprovementEntryApprovalSummary,
): SystemImprovementControlNextAction {
  if (isEntryApprovalRejected(proposal, approvalSummary)) return 'none';
  switch (stage) {
    case 'entry-review':
      return 'approve-entry';
    case 'ai-preflight':
      return proposal.exitEvidence?.releaseGate ? 'none' : 'run-preflight';
    case 'exit-review':
      return 'approve-exit';
    case 'ops-merge':
      return 'mark-merged';
    case 'ops-restart':
      return 'mark-restarted';
    case 'published':
      return 'start-observation';
    case 'blocked':
      return proposal.exitEvidence?.releaseGate?.status === 'rolled-back' ? 'mark-rolled-back' : 'resolve-blocker';
    default:
      return 'none';
  }
}

function resolvePageMode(stage: SystemImprovementControlStage): SystemImprovementControlPageMode {
  if (stage === 'entry-review') return 'entry-review';
  if (stage === 'exit-review') return 'exit-review';
  return 'progress';
}

function buildHeadlineAndSubline(input: {
  proposal: SystemImprovementProposal;
  stage: SystemImprovementControlStage;
  approvalSummary?: SystemImprovementEntryApprovalSummary;
}): { headline: string; subline: string } {
  const { proposal, stage, approvalSummary } = input;
  const releaseGate = proposal.exitEvidence?.releaseGate;
  const project = proposal.exitEvidence?.project;
  const latestRun = proposal.exitEvidence?.latestRun;
  const testing = proposal.exitEvidence?.testing;
  const fileCount = proposal.affectedFiles.length;
  const signalCount = proposal.sourceSignalIds.length;

  switch (stage) {
    case 'entry-review':
      return {
        headline: '等待 CEO 准入审批',
        subline: `${formatRisk(proposal.risk)} · ${signalCount} 个信号 · ${fileCount} 个文件`,
      };
    case 'ai-executing':
      return {
        headline: 'AI 正在实现这条改进',
        subline: [
          project ? `项目 ${project.status}` : null,
          latestRun ? `最近执行 ${latestRun.status}` : null,
          fileCount ? `${fileCount} 个文件范围` : null,
        ].filter(Boolean).join(' · ') || 'AI 已进入实现主线',
      };
    case 'ai-preflight':
      return {
        headline: 'AI 正在收口发布前检查',
        subline: [
          formatReleaseCheckSummary(releaseGate),
          testing?.evidenceCount ? `测试 ${testing.passedCount}/${testing.evidenceCount}` : null,
        ].filter(Boolean).join(' · '),
      };
    case 'exit-review':
      return {
        headline: '等待 CEO 准出审批',
        subline: [
          formatReleaseCheckSummary(releaseGate),
          testing?.evidenceCount ? `测试 ${testing.passedCount}/${testing.evidenceCount}` : null,
          fileCount ? `${fileCount} 个文件范围` : null,
        ].filter(Boolean).join(' · '),
      };
    case 'ops-merge':
      return {
        headline: '等待 Ops 合并',
        subline: [
          releaseGate?.approvedAt ? `准出批准 ${releaseGate.approvedAt}` : null,
          releaseGate?.approvedBy ? `批准人 ${releaseGate.approvedBy}` : null,
        ].filter(Boolean).join(' · ') || '准出已批准',
      };
    case 'ops-restart':
      return {
        headline: '等待 Ops 重启与健康检查',
        subline: [
          releaseGate?.mergedAt ? `已合并 ${releaseGate.mergedAt}` : null,
          releaseGate?.mergeCommitSha ? `commit ${releaseGate.mergeCommitSha}` : null,
        ].filter(Boolean).join(' · ') || 'Ops 已完成合并',
      };
    case 'published':
      return {
        headline: 'Ops 已完成重启与健康检查',
        subline: [
          releaseGate?.restartedAt ? `重启 ${releaseGate.restartedAt}` : null,
          releaseGate?.healthCheckSummary || null,
        ].filter(Boolean).join(' · ') || '当前已具备发布结果',
      };
    case 'observing':
      return {
        headline: '发布后观察中',
        subline: releaseGate?.observationSummary || (releaseGate?.observingAt ? `观察开始于 ${releaseGate.observingAt}` : 'Ops 已进入观察阶段'),
      };
    case 'rolled-back':
      return {
        headline: '该改进已回滚',
        subline: releaseGate?.rollbackReason || '当前不再继续推进',
      };
    case 'blocked':
    default:
      if (isEntryApprovalRejected(proposal, approvalSummary)) {
        return {
          headline: '该改进已被拒绝',
          subline: approvalSummary?.message || '当前不再继续推进',
        };
      }
      if (releaseGate?.status === 'preflight-failed') {
        const failedChecks = releaseGate.checks.filter((item) => item.status === 'failed').map((item) => item.label);
        return {
          headline: '发布前检查仍有阻塞项',
          subline: releaseGate.remediationSummary || failedChecks.join(' · ') || '当前仍在自动收口',
        };
      }
      return {
        headline: 'AI 执行仍有阻塞项',
        subline: proposal.automationState?.summary || '当前仍在内部处理',
      };
  }
}

function buildMilestones(input: {
  proposal: SystemImprovementProposal;
  stage: SystemImprovementControlStage;
  approvalSummary?: SystemImprovementEntryApprovalSummary;
}): SystemImprovementControlMilestone[] {
  const { proposal, stage, approvalSummary } = input;
  const releaseGate = proposal.exitEvidence?.releaseGate;
  const testing = proposal.exitEvidence?.testing;

  const entryDone = hasEntryApprovalCompleted(proposal, approvalSummary);
  const aiExecutionDone = Boolean(proposal.exitEvidence?.mergeGate.deliveryReady || proposal.exitEvidence?.codex);
  const preflightDone = Boolean(
    releaseGate?.preflightStatus === 'passed'
      || releaseGate?.status === 'approved'
      || releaseGate?.status === 'merged'
      || releaseGate?.status === 'restarted'
      || releaseGate?.status === 'observing'
      || releaseGate?.status === 'rolled-back',
  );
  const exitDone = Boolean(
    releaseGate?.approvedAt
      || releaseGate?.status === 'approved'
      || releaseGate?.status === 'merged'
      || releaseGate?.status === 'restarted'
      || releaseGate?.status === 'observing'
      || releaseGate?.status === 'rolled-back',
  );
  const mergeDone = Boolean(
    releaseGate?.mergedAt
      || releaseGate?.status === 'merged'
      || releaseGate?.status === 'restarted'
      || releaseGate?.status === 'observing'
      || releaseGate?.status === 'rolled-back',
  );
  const restartDone = Boolean(
    releaseGate?.restartedAt
      || releaseGate?.status === 'restarted'
      || releaseGate?.status === 'observing',
  );
  const observationStarted = Boolean(releaseGate?.observingAt || releaseGate?.status === 'observing');

  return [
    {
      key: 'entry-approval',
      label: '准入审批',
      status: entryDone ? 'done' : stage === 'entry-review' ? 'current' : 'pending',
      detail: entryDone
        ? approvalSummary?.actedAt ? `已处理 · ${approvalSummary.actedAt}` : '已完成'
        : '等待 CEO 决定是否进入实现',
      ...(approvalSummary?.actedAt ? { timestamp: approvalSummary.actedAt } : {}),
    },
    {
      key: 'ai-execution',
      label: 'AI 实现',
      status: aiExecutionDone ? 'done' : stage === 'ai-executing' ? 'current' : 'pending',
      detail: aiExecutionDone
        ? proposal.exitEvidence?.project?.status ? `项目 ${proposal.exitEvidence.project.status}` : '实现已完成'
        : proposal.exitEvidence?.latestRun?.status ? `最近执行 ${proposal.exitEvidence.latestRun.status}` : '等待 AI 实现',
      ...(proposal.exitEvidence?.latestRun?.updatedAt ? { timestamp: proposal.exitEvidence.latestRun.updatedAt } : {}),
    },
    {
      key: 'ai-preflight',
      label: 'AI 发布前检查',
      status: preflightDone ? 'done' : stage === 'ai-preflight' || releaseGate?.status === 'preflight-failed' ? 'current' : 'pending',
      detail: preflightDone
        ? formatReleaseCheckSummary(releaseGate)
        : releaseGate?.status === 'preflight-failed'
          ? releaseGate.remediationSummary || '发布前检查仍有阻塞项'
          : '等待 AI 完成发布前检查',
      ...(releaseGate?.updatedAt ? { timestamp: releaseGate.updatedAt } : {}),
    },
    {
      key: 'exit-approval',
      label: '准出审批',
      status: exitDone ? 'done' : stage === 'exit-review' ? 'current' : 'pending',
      detail: exitDone
        ? releaseGate?.approvedBy ? `${releaseGate.approvedBy} 已批准` : '已批准'
        : '等待 CEO 最终放行',
      ...(releaseGate?.approvedAt ? { timestamp: releaseGate.approvedAt } : {}),
    },
    {
      key: 'ops-merge',
      label: 'Ops 合并',
      status: mergeDone ? 'done' : stage === 'ops-merge' ? 'current' : 'pending',
      detail: mergeDone
        ? releaseGate?.mergeCommitSha ? `已合并 · ${releaseGate.mergeCommitSha}` : '已完成合并'
        : '等待 Ops 合并并回写结果',
      ...(releaseGate?.mergedAt ? { timestamp: releaseGate.mergedAt } : {}),
    },
    {
      key: 'ops-restart',
      label: 'Ops 重启',
      status: restartDone ? 'done' : stage === 'ops-restart' ? 'current' : 'pending',
      detail: restartDone
        ? releaseGate?.healthCheckSummary || '已完成重启与健康检查'
        : '等待 Ops 重启与健康检查',
      ...(releaseGate?.restartedAt ? { timestamp: releaseGate.restartedAt } : {}),
    },
    {
      key: 'observation',
      label: '观察/完成',
      status: stage === 'published' || stage === 'observing' || stage === 'rolled-back'
        ? 'current'
        : observationStarted
          ? 'done'
          : 'pending',
      detail: stage === 'rolled-back'
        ? releaseGate?.rollbackReason || '已回滚'
        : stage === 'published'
          ? '等待进入观察阶段'
          : observationStarted
            ? releaseGate?.observationSummary || '观察已开始'
            : testing?.evidenceCount ? `测试 ${testing.passedCount}/${testing.evidenceCount}` : '尚未进入观察阶段',
      ...(releaseGate?.observingAt ? { timestamp: releaseGate.observingAt } : {}),
    },
  ];
}

export function buildSystemImprovementProposalView(proposal: SystemImprovementProposal): SystemImprovementProposalView {
  const entryApprovalSummary = buildEntryApprovalSummary(proposal);
  const stage = resolveStage(proposal, entryApprovalSummary);
  const controlState = {
    stage,
    currentOwner: resolveOwner(proposal, stage, entryApprovalSummary),
    nextAction: resolveNextAction(proposal, stage, entryApprovalSummary),
    pageMode: resolvePageMode(stage),
    ...buildHeadlineAndSubline({ proposal, stage, approvalSummary: entryApprovalSummary }),
    milestones: buildMilestones({ proposal, stage, approvalSummary: entryApprovalSummary }),
  };

  return {
    ...proposal,
    controlState,
    ...(entryApprovalSummary ? { entryApprovalSummary } : {}),
  };
}

export function buildSystemImprovementProposalViews(
  proposals: SystemImprovementProposal[],
): SystemImprovementProposalView[] {
  return proposals.map((proposal) => buildSystemImprovementProposalView(proposal));
}
