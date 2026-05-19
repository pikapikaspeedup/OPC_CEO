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
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { id } = await params;
  await req.json().catch(() => ({}));
  const proposal = getGrowthProposal(id);
  if (!proposal) {
    return NextResponse.json({ error: 'Growth proposal not found' }, { status: 404 });
  }
  return NextResponse.json(buildLegacyGrowthReadOnlyPayload(`publish-growth-proposal:${proposal.id}`), { status: 410 });
}
