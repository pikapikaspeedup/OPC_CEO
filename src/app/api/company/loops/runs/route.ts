import { NextResponse } from 'next/server';

import { buildPaginatedResponse, parsePaginationSearchParams } from '@/lib/pagination';
import type { CompanyLoopRunKind, CompanyLoopRunStatus } from '@/lib/company-kernel/contracts';
import {
  countCompanyLoopRuns,
  listCompanyLoopRuns,
} from '@/lib/company-kernel/company-loop-run-store';
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
  const pagination = parsePaginationSearchParams(searchParams, {
    defaultPageSize: 20,
    maxPageSize: 100,
  });
  const query = {
    ...(searchParams.get('policyId') ? { policyId: searchParams.get('policyId') || undefined } : {}),
    ...(searchParams.get('kind') ? { kind: searchParams.get('kind') as CompanyLoopRunKind } : {}),
    ...(searchParams.get('status') ? { status: searchParams.get('status') as CompanyLoopRunStatus } : {}),
    ...(searchParams.get('date') ? { date: searchParams.get('date') || undefined } : {}),
  };
  const total = countCompanyLoopRuns(query);
  const items = listCompanyLoopRuns({
    ...query,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return NextResponse.json(buildPaginatedResponse(items, total, pagination));
}
