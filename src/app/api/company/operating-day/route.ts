import { NextResponse } from 'next/server';

import { getCompanyOperatingDay } from '@/lib/company-kernel/operating-day';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { searchParams } = new URL(req.url);
  return NextResponse.json(getCompanyOperatingDay({
    date: searchParams.get('date') || undefined,
    timezone: searchParams.get('timezone') || undefined,
    workspaceUri: searchParams.get('workspaceUri') || searchParams.get('workspace') || undefined,
    limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
  }));
}
