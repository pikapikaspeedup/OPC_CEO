import { NextResponse } from 'next/server';

import { rejectSystemImprovementProposal } from '@/lib/company-kernel/self-improvement-approval';
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
  try {
    return NextResponse.json({ proposal: rejectSystemImprovementProposal(id, body.reason) });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 404 });
  }
}
