import { NextResponse } from 'next/server';

import { getOperatingSignal } from '@/lib/company-kernel/operating-signal-store';
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
  const signal = getOperatingSignal(id);
  if (!signal) {
    return NextResponse.json({ error: 'Operating signal not found' }, { status: 404 });
  }
  return NextResponse.json(signal);
}
