import { NextResponse } from 'next/server';

import { buildPaginatedResponse, parsePaginationSearchParams } from '@/lib/pagination';
import type { BudgetLedgerDecision, BudgetScope } from '@/lib/company-kernel/contracts';
import {
  countBudgetLedgerEntries,
  listBudgetLedgerEntries,
} from '@/lib/company-kernel/budget-ledger-store';
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
  const decision = searchParams.get('decision') as BudgetLedgerDecision | null;
  const query = {
    ...(scope ? { scope } : {}),
    ...(searchParams.get('scopeId') ? { scopeId: searchParams.get('scopeId') as string } : {}),
    ...(searchParams.get('policyId') ? { policyId: searchParams.get('policyId') as string } : {}),
    ...(decision ? { decision } : {}),
    ...(searchParams.get('agendaItemId') ? { agendaItemId: searchParams.get('agendaItemId') as string } : {}),
    ...(searchParams.get('runId') ? { runId: searchParams.get('runId') as string } : {}),
    ...(searchParams.get('schedulerJobId') ? { schedulerJobId: searchParams.get('schedulerJobId') as string } : {}),
    ...(searchParams.get('proposalId') ? { proposalId: searchParams.get('proposalId') as string } : {}),
  };
  const total = countBudgetLedgerEntries(query);
  const items = listBudgetLedgerEntries({
    ...query,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return NextResponse.json(buildPaginatedResponse(items, total, pagination));
}
