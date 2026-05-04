import { NextResponse } from 'next/server';

import { runApprovedSystemImprovementCodexTask } from '@/lib/company-kernel/self-improvement-codex-execution';
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
  const body = await req.json().catch(() => ({})) as { force?: boolean };
  try {
    const result = await runApprovedSystemImprovementCodexTask(id, { force: Boolean(body.force) });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 400 });
  }
}
