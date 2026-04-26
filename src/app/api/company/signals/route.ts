import { NextResponse } from 'next/server';

import { buildPaginatedResponse, parsePaginationSearchParams } from '@/lib/pagination';
import type {
  OperatingSignalKind,
  OperatingSignalSource,
  OperatingSignalStatus,
} from '@/lib/company-kernel/contracts';
import {
  countOperatingSignals,
  listOperatingSignals,
} from '@/lib/company-kernel/operating-signal-store';
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
  const workspaceUri = searchParams.get('workspaceUri') || searchParams.get('workspace') || undefined;
  const source = searchParams.get('source') as OperatingSignalSource | null;
  const kind = searchParams.get('kind') as OperatingSignalKind | null;
  const status = searchParams.get('status') as OperatingSignalStatus | null;
  const minScore = searchParams.get('minScore') ? Number(searchParams.get('minScore')) : undefined;
  const query = {
    ...(workspaceUri ? { workspaceUri } : {}),
    ...(source ? { source } : {}),
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
    ...(Number.isFinite(minScore) ? { minScore } : {}),
  };

  const total = countOperatingSignals(query);
  const items = listOperatingSignals({
    ...query,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return NextResponse.json(buildPaginatedResponse(items, total, pagination));
}
