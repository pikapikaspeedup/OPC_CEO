import { NextResponse } from 'next/server';

import { getCompanyLoopRun } from '@/lib/company-kernel/company-loop-run-store';
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
  const run = getCompanyLoopRun(id);
  if (!run) {
    return NextResponse.json({ error: 'Company loop run not found' }, { status: 404 });
  }
  return NextResponse.json(run);
}
