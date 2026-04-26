import { NextResponse } from 'next/server';

import { updateOperatingSignalStatus } from '@/lib/company-kernel/operating-signal-store';
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
  const signal = updateOperatingSignalStatus(id, 'dismissed');
  if (!signal) {
    return NextResponse.json({ error: 'Operating signal not found' }, { status: 404 });
  }
  return NextResponse.json({ signal });
}
