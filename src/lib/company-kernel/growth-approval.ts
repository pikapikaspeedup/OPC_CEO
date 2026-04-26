import { submitApprovalRequest } from '../approval/handler';
import type { GrowthProposal } from './contracts';
import { patchGrowthProposal } from './growth-proposal-store';

export async function ensureGrowthProposalApprovalRequest(
  proposal: GrowthProposal,
): Promise<GrowthProposal> {
  if (proposal.status !== 'approval-required' && proposal.risk !== 'high') {
    return proposal;
  }
  if (proposal.approvalRequestId) {
    return proposal;
  }

  const request = await submitApprovalRequest({
    type: 'proposal_publish',
    workspace: proposal.workspaceUri || 'organization',
    title: `Publish growth proposal: ${proposal.title}`,
    description: [
      proposal.summary,
      '',
      `Kind: ${proposal.kind}`,
      `Risk: ${proposal.risk}`,
      `Score: ${proposal.score}`,
      `Target: ${proposal.targetRef}`,
    ].join('\n'),
    urgency: proposal.risk === 'high' ? 'high' : 'normal',
    onApproved: {
      type: 'custom',
      payload: {
        action: 'publish-growth-proposal',
        proposalId: proposal.id,
      },
    },
    onRejected: {
      type: 'custom',
      payload: {
        action: 'reject-growth-proposal',
        proposalId: proposal.id,
      },
    },
  });

  return patchGrowthProposal(proposal.id, {
    approvalRequestId: request.id,
  }) || proposal;
}
