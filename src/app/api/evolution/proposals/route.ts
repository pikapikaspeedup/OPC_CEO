import { NextResponse } from 'next/server';

import { buildEvolutionProposalRollout, listEvolutionProposals } from '@/lib/evolution';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspaceUri = url.searchParams.get('workspace') ?? undefined;
  const kind = url.searchParams.get('kind') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;
  const observe = url.searchParams.get('observe') !== 'false';
  const proposals = listEvolutionProposals({
    ...(workspaceUri ? { workspaceUri } : {}),
    ...(kind ? { kind: kind as 'workflow' | 'skill' } : {}),
    ...(status ? { status: status as 'draft' | 'evaluated' | 'pending-approval' | 'published' | 'rejected' } : {}),
  }).map((proposal) => (
    observe && proposal.publishedAt
      ? { ...proposal, rollout: buildEvolutionProposalRollout(proposal) }
      : proposal
  ));

  return NextResponse.json({ proposals });
}
