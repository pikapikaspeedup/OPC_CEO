import { NextResponse } from 'next/server';

import { buildPaginatedResponse, parsePaginationSearchParams } from '@/lib/pagination';
import type { BudgetScope, CircuitBreakerStatus } from '@/lib/company-kernel/contracts';
import {
  countCircuitBreakers,
  listCircuitBreakers,
} from '@/lib/company-kernel/circuit-breaker';
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
  const scope = searchParams.get('scope') as BudgetScope | 'provider' | 'workflow' | null;
  const status = searchParams.get('status') as CircuitBreakerStatus | null;
  const query = {
    ...(scope ? { scope } : {}),
    ...(searchParams.get('scopeId') ? { scopeId: searchParams.get('scopeId') as string } : {}),
    ...(status ? { status } : {}),
  };
  const total = countCircuitBreakers(query);
  const items = listCircuitBreakers({
    ...query,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return NextResponse.json(buildPaginatedResponse(items, total, pagination));
}
