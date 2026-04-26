import { NextResponse } from 'next/server';

import { buildPaginatedResponse, parsePaginationSearchParams } from '@/lib/pagination';
import {
  countCompanyLoopDigests,
  listCompanyLoopDigests,
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
    ...(searchParams.get('loopRunId') ? { loopRunId: searchParams.get('loopRunId') || undefined } : {}),
    ...(searchParams.get('date') ? { date: searchParams.get('date') || undefined } : {}),
  };
  const total = countCompanyLoopDigests(query);
  const items = listCompanyLoopDigests({
    ...query,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return NextResponse.json(buildPaginatedResponse(items, total, pagination));
}
