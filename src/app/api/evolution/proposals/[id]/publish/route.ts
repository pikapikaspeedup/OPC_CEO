import { NextResponse } from 'next/server';

import { submitApprovalRequest } from '@/lib/approval/handler';
import { getEvolutionProposal, patchEvolutionProposal } from '@/lib/evolution';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const proposal = getEvolutionProposal(id);
  if (!proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }
  if (!proposal.evaluation) {
    return NextResponse.json({ error: 'Proposal must be evaluated before publish approval' }, { status: 400 });
  }
  if (proposal.status === 'published') {
    return NextResponse.json({ proposal });
  }
  if (proposal.status === 'pending-approval' && proposal.approvalRequestId) {
    return NextResponse.json({ proposal, approvalRequestId: proposal.approvalRequestId });
  }

  let body: { message?: string } = {};
  try {
    body = await req.json();
  } catch {
    // allow empty body
  }

  const approval = await submitApprovalRequest({
    type: 'proposal_publish',
    workspace: proposal.workspaceUri || 'organization',
    title: `发布提案：${proposal.title}`,
    description: [
      `Target: ${proposal.targetRef}`,
      `Kind: ${proposal.kind}`,
      `Evaluation: ${proposal.evaluation.summary}`,
      body.message ? `Note: ${body.message}` : '',
    ].filter(Boolean).join('\n'),
    urgency: proposal.evaluation.recommendation === 'publish' ? 'normal' : 'high',
    onApproved: {
      type: 'custom',
      payload: {
        action: 'publish-evolution-proposal',
        proposalId: proposal.id,
      },
    },
    onRejected: {
      type: 'custom',
      payload: {
        action: 'reject-evolution-proposal',
        proposalId: proposal.id,
      },
    },
  });

  const updated = patchEvolutionProposal(proposal.id, {
    status: 'pending-approval',
    approvalRequestId: approval.id,
    ...(body.message ? { governanceNote: body.message } : {}),
  });

  return NextResponse.json({
    proposal: updated,
    approvalRequestId: approval.id,
  });
}
