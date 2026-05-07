import { listProjects } from '../agents/project-registry';
import type { DecisionItemPriority, DecisionItemTone, DecisionItemView, DecisionTarget } from '../decision-control';
import type { GrowthProposal, SystemImprovementProposalView } from './contracts';
import { listGrowthProposals } from './growth-proposal-store';
import { buildSystemImprovementProposalViews } from './self-improvement-control-state';
import { listSystemImprovementProposals } from './self-improvement-store';

function targetKey(target: DecisionTarget): string {
  return JSON.stringify(target);
}

function riskPriority(risk?: string): DecisionItemPriority {
  if (risk === 'critical' || risk === 'high') return '高';
  if (risk === 'medium') return '中';
  return '低';
}

function riskTone(risk?: string): DecisionItemTone {
  if (risk === 'critical' || risk === 'high') return 'danger';
  if (risk === 'medium') return 'warning';
  return 'info';
}

function addUnique(
  items: DecisionItemView[],
  seen: Set<string>,
  item: DecisionItemView,
): void {
  const key = targetKey(item.target);
  if (seen.has(key)) return;
  seen.add(key);
  items.push(item);
}

function buildSystemImprovementDecision(proposal: SystemImprovementProposalView): DecisionItemView | null {
  if (proposal.controlState.currentOwner !== 'ceo') return null;
  if (proposal.controlState.pageMode === 'entry-review' && !proposal.approvalRequestId) return null;
  return {
    id: `system-improvement:${proposal.id}:${proposal.controlState.stage}`,
    title: proposal.title,
    source: '软件自迭代',
    status: proposal.controlState.headline,
    detail: proposal.controlState.subline,
    priority: riskPriority(proposal.risk),
    tone: riskTone(proposal.risk),
    currentOwner: proposal.controlState.currentOwner,
    nextAction: proposal.controlState.nextAction,
    target: { kind: 'system-improvement-proposal', proposalId: proposal.id },
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}

function buildGrowthDecision(proposal: GrowthProposal): DecisionItemView | null {
  if (proposal.status !== 'approval-required') return null;
  if (!proposal.approvalRequestId) return null;
  return {
    id: `growth:${proposal.id}`,
    title: proposal.title,
    source: `增长提案 · ${proposal.kind}`,
    status: '待 CEO 审批',
    detail: proposal.summary,
    priority: riskPriority(proposal.risk),
    tone: riskTone(proposal.risk),
    currentOwner: 'ceo',
    nextAction: 'approve-entry',
    target: { kind: 'growth-proposal', proposalId: proposal.id },
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}

export async function listCEODecisionItems(limit = 50): Promise<DecisionItemView[]> {
  const items: DecisionItemView[] = [];
  const seen = new Set<string>();

  const systemImprovementViews = buildSystemImprovementProposalViews(
    listSystemImprovementProposals({ limit: Math.max(limit, 100) }),
  );
  for (const proposal of systemImprovementViews) {
    const item = buildSystemImprovementDecision(proposal);
    if (item) addUnique(items, seen, item);
  }

  for (const proposal of listGrowthProposals({ limit: Math.max(limit, 100) })) {
    const item = buildGrowthDecision(proposal);
    if (item) addUnique(items, seen, item);
  }

  for (const project of listProjects()) {
    for (const stage of project.pipelineState?.stages || []) {
      if (stage.gateApproval?.status !== 'pending') continue;
      addUnique(items, seen, {
        id: `project-stage-gate:${project.projectId}:${stage.stageId}`,
        title: stage.title || project.name,
        source: project.name,
        status: '待阶段审批',
        detail: stage.lastError,
        priority: '高',
        tone: 'warning',
        currentOwner: 'ceo',
        nextAction: 'approve-stage-gate',
        target: { kind: 'project-stage-gate', projectId: project.projectId, stageId: stage.stageId },
        createdAt: project.createdAt,
        updatedAt: stage.completedAt || project.updatedAt,
      });
    }
  }

  return items
    .sort((a, b) => {
      const ownerDiff = (a.currentOwner === 'ceo' ? 0 : 1) - (b.currentOwner === 'ceo' ? 0 : 1);
      if (ownerDiff) return ownerDiff;
      const priorityScore = (value: DecisionItemPriority) => value === '高' ? 0 : value === '中' ? 1 : 2;
      const priorityDiff = priorityScore(a.priority) - priorityScore(b.priority);
      if (priorityDiff) return priorityDiff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })
    .slice(0, limit);
}
