import { NextResponse } from 'next/server';

import { buildPaginatedResponse, parsePaginationSearchParams } from '@/lib/pagination';
import type { MemoryCandidateKind, MemoryCandidateStatus } from '@/lib/company-kernel/contracts';
import {
  countMemoryCandidates,
  listMemoryCandidates,
} from '@/lib/company-kernel/memory-candidate-store';
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
  const sourceRunId = searchParams.get('sourceRunId') || undefined;
  const sourceCapsuleId = searchParams.get('sourceCapsuleId') || undefined;
  const kind = searchParams.get('kind') as MemoryCandidateKind | null;
  const status = searchParams.get('status') as MemoryCandidateStatus | null;
  const minScore = searchParams.get('minScore') ? Number(searchParams.get('minScore')) : undefined;
  const query = {
    ...(workspaceUri ? { workspaceUri } : {}),
    ...(sourceRunId ? { sourceRunId } : {}),
    ...(sourceCapsuleId ? { sourceCapsuleId } : {}),
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
    ...(Number.isFinite(minScore) ? { minScore } : {}),
  };

  const total = countMemoryCandidates(query);
  const items = listMemoryCandidates({
    ...query,
    limit: pagination.limit,
    offset: pagination.offset,
  });

  return NextResponse.json(buildPaginatedResponse(items, total, pagination));
}
