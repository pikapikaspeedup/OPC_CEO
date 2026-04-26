import { submitApprovalRequest } from '../approval/handler';
import {
  getSystemImprovementProposal,
  patchSystemImprovementProposal,
} from './self-improvement-store';

function buildApprovalMetadata(input: {
  existingMetadata?: Record<string, unknown>;
  approvedBy?: string;
}): Record<string, unknown> {
  return {
    ...(input.existingMetadata || {}),
    approvalStatus: 'approved',
    approvedAt: new Date().toISOString(),
    approvedBy: input.approvedBy || 'ceo',
  };
}

export async function ensureSystemImprovementApprovalRequest(id: string) {
  const proposal = getSystemImprovementProposal(id);
  if (!proposal) {
    throw new Error(`System improvement proposal not found: ${id}`);
  }
  if (proposal.approvalRequestId) {
    return proposal;
  }
  if (proposal.risk !== 'high' && proposal.risk !== 'critical') {
    return patchSystemImprovementProposal(id, {
      status: 'approved',
      metadata: buildApprovalMetadata({
        existingMetadata: proposal.metadata,
        approvedBy: 'system',
      }),
    }) || proposal;
  }

  const request = await submitApprovalRequest({
    type: 'other',
    workspace: 'organization',
    title: `系统改进审批：${proposal.title}`,
    description: [
      proposal.summary,
      '',
      `Risk: ${proposal.risk}`,
      `Protected areas: ${proposal.protectedAreas.join(', ') || 'none'}`,
      '',
      'Implementation plan:',
      ...proposal.implementationPlan.map((item) => `- ${item}`),
      '',
      'Test plan:',
      ...proposal.testPlan.map((item) => `- ${item}`),
      '',
      'Rollback plan:',
      ...proposal.rollbackPlan.map((item) => `- ${item}`),
    ].join('\n'),
    urgency: proposal.risk === 'critical' ? 'critical' : 'high',
    onApproved: {
      type: 'custom',
      payload: {
        action: 'approve-system-improvement-proposal',
        proposalId: proposal.id,
      },
    },
    onRejected: {
      type: 'custom',
      payload: {
        action: 'reject-system-improvement-proposal',
        proposalId: proposal.id,
      },
    },
  });

  return patchSystemImprovementProposal(id, {
    status: 'approval-required',
    approvalRequestId: request.id,
  }) || proposal;
}

export function approveSystemImprovementProposal(id: string) {
  const existing = getSystemImprovementProposal(id);
  const proposal = patchSystemImprovementProposal(id, {
    status: 'approved',
    metadata: buildApprovalMetadata({
      existingMetadata: existing?.metadata,
      approvedBy: 'ceo',
    }),
  });
  if (!proposal) {
    throw new Error(`System improvement proposal not found: ${id}`);
  }
  return proposal;
}

export function rejectSystemImprovementProposal(id: string, reason?: string) {
  const proposal = patchSystemImprovementProposal(id, {
    status: 'rejected',
    metadata: {
      ...(getSystemImprovementProposal(id)?.metadata || {}),
      rejectedReason: reason || 'Rejected',
    },
  });
  if (!proposal) {
    throw new Error(`System improvement proposal not found: ${id}`);
  }
  return proposal;
}
