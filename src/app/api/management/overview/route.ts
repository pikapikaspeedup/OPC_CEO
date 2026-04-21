import { NextResponse } from 'next/server';

import { buildDepartmentManagementOverview, buildManagementOverview } from '@/lib/management';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const url = new URL(req.url);
  const workspace = url.searchParams.get('workspace');
  if (workspace) {
    return NextResponse.json(buildDepartmentManagementOverview(workspace));
  }
  return NextResponse.json(buildManagementOverview());
}
