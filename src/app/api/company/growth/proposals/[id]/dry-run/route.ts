import { NextResponse } from 'next/server';

import { getGrowthProposal } from '@/lib/company-kernel/growth-proposal-store';
import { buildLegacyGrowthReadOnlyPayload } from '@/lib/company-kernel/legacy-growth';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<unknown> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const rawParams = await params as { id?: string };
  const id = rawParams.id || '';
  const proposal = getGrowthProposal(id);
  if (!proposal) {
    return NextResponse.json({ error: 'Growth proposal not found' }, { status: 404 });
  }
  return NextResponse.json(buildLegacyGrowthReadOnlyPayload(`dry-run-growth-proposal:${proposal.id}`), { status: 410 });
}
