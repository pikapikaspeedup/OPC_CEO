import { NextResponse } from 'next/server';

import { getMemoryCandidate } from '@/lib/company-kernel/memory-candidate-store';
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
  const candidate = getMemoryCandidate(id);
  if (!candidate) {
    return NextResponse.json({ error: 'Memory candidate not found' }, { status: 404 });
  }
  return NextResponse.json(candidate);
}
