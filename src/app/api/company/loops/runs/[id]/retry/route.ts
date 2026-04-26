import { NextResponse } from 'next/server';

import { retryCompanyLoopRun } from '@/lib/company-kernel/company-loop-executor';
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
    const result = retryCompanyLoopRun(id);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 409 });
  }
}
