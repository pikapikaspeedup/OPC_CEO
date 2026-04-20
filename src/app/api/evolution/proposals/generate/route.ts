import { NextResponse } from 'next/server';

import { generateEvolutionProposals } from '@/lib/evolution';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { workspaceUri?: string; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    // allow empty body
  }

  const proposals = generateEvolutionProposals({
    ...(body.workspaceUri ? { workspaceUri: body.workspaceUri } : {}),
    ...(typeof body.limit === 'number' ? { limit: body.limit } : {}),
  });
  return NextResponse.json({ proposals }, { status: 201 });
}
