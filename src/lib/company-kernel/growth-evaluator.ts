import type {
  GrowthProposal,
  GrowthProposalEvaluation,
  GrowthProposalStatus,
} from './contracts';
import { growthProposalRequiresApproval } from './autonomy-policy';
import { getGrowthProposal, patchGrowthProposal } from './growth-proposal-store';

function evaluateProposal(proposal: GrowthProposal): GrowthProposalEvaluation {
  const evidenceCount = proposal.evidenceRefs.length
    + proposal.sourceRunIds.length
    + proposal.sourceKnowledgeIds.length
    + proposal.sourceCandidateIds.length;
  const approvalRequired = growthProposalRequiresApproval(proposal);
  const reasons: string[] = [];
  if (evidenceCount < 2) reasons.push('Needs at least two evidence anchors before publication.');
  if (approvalRequired) reasons.push('Proposal requires explicit approval by autonomy policy.');
  if (proposal.score < 50) reasons.push(`Proposal score is low: ${proposal.score}.`);
  if (proposal.sourceRunIds.length === 0) reasons.push('No run evidence is linked.');

  const recommendation = proposal.score < 45
    ? 'reject'
    : approvalRequired || evidenceCount < 2
      ? 'needs-approval'
      : proposal.score >= 70
        ? 'approve'
        : 'observe';

  return {
    evaluatedAt: new Date().toISOString(),
    evidenceCount,
    score: proposal.score,
    recommendation,
    reasons: reasons.length > 0 ? reasons : ['Evidence and risk are within the first-release threshold.'],
  };
}

function statusFromEvaluation(evaluation: GrowthProposalEvaluation): GrowthProposalStatus {
  if (evaluation.recommendation === 'reject') return 'rejected';
  if (evaluation.recommendation === 'needs-approval') return 'approval-required';
  return 'evaluated';
}

export function evaluateGrowthProposal(id: string): GrowthProposal | null {
  const proposal = getGrowthProposal(id);
  if (!proposal) return null;
  const evaluation = evaluateProposal(proposal);
  return patchGrowthProposal(id, {
    evaluation,
    status: statusFromEvaluation(evaluation),
    score: evaluation.score,
    ...(evaluation.recommendation === 'reject' ? { rejectedReason: evaluation.reasons.join('; ') } : {}),
  });
}

export function approveGrowthProposal(id: string): GrowthProposal | null {
  const proposal = getGrowthProposal(id);
  if (!proposal) return null;
  return patchGrowthProposal(id, {
    status: 'approved',
  });
}

export function rejectGrowthProposal(id: string, reason?: string): GrowthProposal | null {
  const proposal = getGrowthProposal(id);
  if (!proposal) return null;
  return patchGrowthProposal(id, {
    status: 'rejected',
    rejectedReason: reason || 'Rejected by operator.',
  });
}
