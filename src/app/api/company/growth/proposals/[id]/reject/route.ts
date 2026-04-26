import { NextResponse } from 'next/server';

import { rejectGrowthProposal } from '@/lib/company-kernel/growth-evaluator';
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
  const body = await req.json().catch(() => ({})) as { reason?: string };
  const proposal = rejectGrowthProposal(id, body.reason);
  if (!proposal) {
    return NextResponse.json({ error: 'Growth proposal not found' }, { status: 404 });
  }
  return NextResponse.json({ proposal });
}
