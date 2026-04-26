import { NextResponse } from 'next/server';

import { buildPaginatedResponse, parsePaginationSearchParams } from '@/lib/pagination';
import type {
  OperatingAgendaPriority,
  OperatingAgendaStatus,
} from '@/lib/company-kernel/contracts';
import {
  countOperatingAgendaItems,
  listOperatingAgendaItems,
} from '@/lib/company-kernel/agenda-store';
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
  const status = searchParams.get('status') as OperatingAgendaStatus | null;
  const priority = searchParams.get('priority') as OperatingAgendaPriority | null;
  const minScore = searchParams.get('minScore') ? Number(searchParams.get('minScore')) : undefined;
  const query = {
    ...(workspaceUri ? { workspaceUri } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(Number.isFinite(minScore) ? { minScore } : {}),
  };

  const total = countOperatingAgendaItems(query);
  const items = listOperatingAgendaItems({
    ...query,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return NextResponse.json(buildPaginatedResponse(items, total, pagination));
}
