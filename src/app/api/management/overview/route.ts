import { NextResponse } from 'next/server';

import { buildDepartmentManagementOverview, buildManagementOverview } from '@/lib/management';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspace = url.searchParams.get('workspace');
  if (workspace) {
    return NextResponse.json(buildDepartmentManagementOverview(workspace));
  }
  return NextResponse.json(buildManagementOverview());
}
