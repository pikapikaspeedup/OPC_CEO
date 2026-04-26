import { NextResponse } from 'next/server';

import { buildPaginatedResponse, parsePaginationSearchParams } from '@/lib/pagination';
import type { CompanyLoopPolicyScope } from '@/lib/company-kernel/contracts';
import {
  countCompanyLoopPolicies,
  getOrCreateCompanyLoopPolicy,
  listCompanyLoopPolicies,
} from '@/lib/company-kernel/company-loop-policy';
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
  const scope = searchParams.get('scope') as CompanyLoopPolicyScope | null;
  const scopeId = searchParams.get('scopeId') || undefined;
  const enabledParam = searchParams.get('enabled');
  if (!scope) {
    getOrCreateCompanyLoopPolicy();
  }
  const query = {
    ...(scope ? { scope } : {}),
    ...(scopeId !== undefined ? { scopeId } : {}),
    ...(enabledParam !== null ? { enabled: enabledParam === 'true' || enabledParam === '1' } : {}),
  };
  const total = countCompanyLoopPolicies(query);
  const items = listCompanyLoopPolicies({
    ...query,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return NextResponse.json(buildPaginatedResponse(items, total, pagination));
}
