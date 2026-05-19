import { NextResponse } from 'next/server';

import { getGrowthProposal } from '@/lib/company-kernel/growth-proposal-store';
import { buildLegacyGrowthReadOnlyPayload } from '@/lib/company-kernel/legacy-growth';
import {
  listGrowthObservations,
} from '@/lib/company-kernel/growth-observation-store';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { searchParams } = new URL(req.url);
  const proposalId = searchParams.get('proposalId') || undefined;
  const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;
  return NextResponse.json({
    observations: listGrowthObservations({
      ...(proposalId ? { proposalId } : {}),
      ...(typeof limit === 'number' ? { limit } : {}),
    }),
  });
}

export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const body = await req.json().catch(() => ({})) as { proposalId?: string };
  if (!body.proposalId) {
    return NextResponse.json({ error: 'proposalId is required' }, { status: 400 });
  }
  const proposal = getGrowthProposal(body.proposalId);
  if (!proposal) {
    return NextResponse.json({ error: 'Growth proposal not found' }, { status: 404 });
  }
  if (proposal.status !== 'published' && proposal.status !== 'observing') {
    return NextResponse.json({ error: 'Growth proposal must be published before observation' }, { status: 409 });
  }
  return NextResponse.json(buildLegacyGrowthReadOnlyPayload(`observe-growth-proposal:${proposal.id}`), { status: 410 });
}
