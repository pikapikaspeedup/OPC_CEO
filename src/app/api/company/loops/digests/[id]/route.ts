import { NextResponse } from 'next/server';

import { getCompanyLoopDigest } from '@/lib/company-kernel/company-loop-run-store';
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
  const digest = getCompanyLoopDigest(id);
  if (!digest) {
    return NextResponse.json({ error: 'Company loop digest not found' }, { status: 404 });
  }
  return NextResponse.json(digest);
}
