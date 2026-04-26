import { NextResponse } from 'next/server';

import type { RunStatus } from '@/lib/agents/group-types';
import { buildPaginatedResponse, parsePaginationSearchParams } from '@/lib/pagination';
import { countRunCapsules, listRunCapsules } from '@/lib/company-kernel/run-capsule-store';
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
  const projectId = searchParams.get('projectId') || undefined;
  const status = searchParams.get('status') as RunStatus | null;
  const providerId = searchParams.get('providerId') || undefined;
  const query = {
    ...(workspaceUri ? { workspaceUri } : {}),
    ...(projectId ? { projectId } : {}),
    ...(status ? { status } : {}),
    ...(providerId ? { providerId } : {}),
  };

  const total = countRunCapsules(query);
  const items = listRunCapsules({
    ...query,
    limit: pagination.limit,
    offset: pagination.offset,
  });

  return NextResponse.json(buildPaginatedResponse(items, total, pagination));
}
