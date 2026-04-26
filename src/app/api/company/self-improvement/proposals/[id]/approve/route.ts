import { NextResponse } from 'next/server';

import { approveSystemImprovementProposal } from '@/lib/company-kernel/self-improvement-approval';
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
  try {
    return NextResponse.json({ proposal: approveSystemImprovementProposal(id) });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 404 });
  }
}
