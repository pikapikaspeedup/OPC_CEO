import { NextResponse } from 'next/server';

import { buildPaginatedResponse, parsePaginationSearchParams } from '@/lib/pagination';
import type {
  SystemImprovementProposalStatus,
  SystemImprovementRisk,
} from '@/lib/company-kernel/contracts';
import {
  countSystemImprovementProposals,
  listSystemImprovementProposals,
} from '@/lib/company-kernel/self-improvement-store';
import { syncAllActiveSystemImprovementProposals } from '@/lib/company-kernel/self-improvement-runtime-state';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  await syncAllActiveSystemImprovementProposals();

  const { searchParams } = new URL(req.url);
  const pagination = parsePaginationSearchParams(searchParams, {
    defaultPageSize: 20,
    maxPageSize: 100,
  });
  const query = {
    ...(searchParams.get('status') ? { status: searchParams.get('status') as SystemImprovementProposalStatus } : {}),
    ...(searchParams.get('risk') ? { risk: searchParams.get('risk') as SystemImprovementRisk } : {}),
  };
  const total = countSystemImprovementProposals(query);
  const items = listSystemImprovementProposals({
    ...query,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return NextResponse.json(buildPaginatedResponse(items, total, pagination));
}
