import { NextResponse } from 'next/server';

import { buildPaginatedResponse, parsePaginationSearchParams } from '@/lib/pagination';
import type { BudgetPeriod, BudgetScope } from '@/lib/company-kernel/contracts';
import {
  countBudgetPolicies,
  listBudgetPolicies,
} from '@/lib/company-kernel/budget-policy';
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
  const scope = searchParams.get('scope') as BudgetScope | null;
  const scopeId = searchParams.get('scopeId') || undefined;
  const period = searchParams.get('period') as BudgetPeriod | null;
  const query = {
    ...(scope ? { scope } : {}),
    ...(scopeId ? { scopeId } : {}),
    ...(period ? { period } : {}),
  };
  const total = countBudgetPolicies(query);
  const items = listBudgetPolicies({
    ...query,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return NextResponse.json(buildPaginatedResponse(items, total, pagination));
}
