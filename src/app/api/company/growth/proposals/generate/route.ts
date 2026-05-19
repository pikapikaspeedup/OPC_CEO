import { NextResponse } from 'next/server';

import { buildLegacyGrowthReadOnlyPayload } from '@/lib/company-kernel/legacy-growth';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  return NextResponse.json(buildLegacyGrowthReadOnlyPayload('generate-growth-proposals'), { status: 410 });
}
