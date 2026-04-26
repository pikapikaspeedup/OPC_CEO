import { NextResponse } from 'next/server';

import { getRunCapsuleByRunId } from '@/lib/company-kernel/run-capsule-store';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { runId } = await params;
  const capsule = getRunCapsuleByRunId(runId);
  if (!capsule) {
    return NextResponse.json({ error: 'Run capsule not found' }, { status: 404 });
  }
  return NextResponse.json(capsule);
}
