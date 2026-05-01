import { NextResponse } from 'next/server';

import { syncSystemImprovementProposalRuntimeState } from '@/lib/company-kernel/self-improvement-runtime-state';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { id } = await params;
  const proposal = await syncSystemImprovementProposalRuntimeState(id);
  if (!proposal) {
    return NextResponse.json({ error: 'System improvement proposal not found' }, { status: 404 });
  }
  return NextResponse.json(proposal);
}
