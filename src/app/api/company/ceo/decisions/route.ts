import { NextResponse } from 'next/server';

import { listCEODecisionItems } from '@/lib/company-kernel/ceo-decision-control';
import { syncAllActiveSystemImprovementProposals } from '@/lib/company-kernel/self-improvement-runtime-state';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  await syncAllActiveSystemImprovementProposals();
  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get('limit') || 50);
  const items = await listCEODecisionItems(Number.isFinite(limit) ? limit : 50);
  return NextResponse.json({ items });
}
