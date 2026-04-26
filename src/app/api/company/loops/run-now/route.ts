import { NextResponse } from 'next/server';

import { runCompanyLoop } from '@/lib/company-kernel/company-loop-executor';
import type { CompanyLoopRunKind } from '@/lib/company-kernel/contracts';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const body = await req.json().catch(() => ({})) as {
    policyId?: string;
    kind?: CompanyLoopRunKind;
    date?: string;
    timezone?: string;
  };
  try {
    const result = runCompanyLoop({
      ...(body.policyId ? { policyId: body.policyId } : {}),
      ...(body.kind ? { kind: body.kind } : {}),
      ...(body.date ? { date: body.date } : {}),
      ...(body.timezone ? { timezone: body.timezone } : {}),
      source: 'api',
    });
    return NextResponse.json(result, { status: result.run.status === 'skipped' ? 409 : 201 });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 400 });
  }
}
