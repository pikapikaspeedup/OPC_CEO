import { NextResponse } from 'next/server';

import { resetCircuitBreaker } from '@/lib/company-kernel/circuit-breaker';
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
  const breaker = resetCircuitBreaker(id);
  if (!breaker) {
    return NextResponse.json({ error: 'Circuit breaker not found' }, { status: 404 });
  }
  return NextResponse.json({ breaker });
}
