import { NextResponse } from 'next/server';

import { evaluateEvolutionProposal } from '@/lib/evolution';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const proposal = evaluateEvolutionProposal(id);
  if (!proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }
  return NextResponse.json(proposal);
}
