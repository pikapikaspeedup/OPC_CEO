import { NextResponse } from 'next/server';

import { buildEvolutionProposalRollout, getEvolutionProposal } from '@/lib/evolution';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const proposal = getEvolutionProposal(id);
  if (!proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }
  return NextResponse.json(proposal.publishedAt
    ? { ...proposal, rollout: buildEvolutionProposalRollout(proposal) }
    : proposal);
}
