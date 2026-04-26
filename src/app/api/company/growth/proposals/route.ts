import { NextResponse } from 'next/server';

import { buildPaginatedResponse, parsePaginationSearchParams } from '@/lib/pagination';
import type {
  GrowthProposalKind,
  GrowthProposalRisk,
  GrowthProposalStatus,
} from '@/lib/company-kernel/contracts';
import {
  countGrowthProposals,
  listGrowthProposals,
} from '@/lib/company-kernel/growth-proposal-store';
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
  const kind = searchParams.get('kind') as GrowthProposalKind | null;
  const status = searchParams.get('status') as GrowthProposalStatus | null;
  const risk = searchParams.get('risk') as GrowthProposalRisk | null;
  const minScore = searchParams.get('minScore') ? Number(searchParams.get('minScore')) : undefined;
  const query = {
    ...(workspaceUri ? { workspaceUri } : {}),
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
    ...(risk ? { risk } : {}),
    ...(Number.isFinite(minScore) ? { minScore } : {}),
  };
  const total = countGrowthProposals(query);
  const items = listGrowthProposals({
    ...query,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return NextResponse.json(buildPaginatedResponse(items, total, pagination));
}
