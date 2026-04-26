import { NextResponse } from 'next/server';

import { getOperatingAgendaItem } from '@/lib/company-kernel/agenda-store';
import { checkBudgetForAgendaItem } from '@/lib/company-kernel/budget-gate';
import type { BudgetScope } from '@/lib/company-kernel/contracts';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    scope?: BudgetScope;
    scopeId?: string;
    schedulerJobId?: string;
    proposalId?: string;
  };
  const item = getOperatingAgendaItem(id);
  if (!item) {
    return NextResponse.json({ error: 'Operating agenda item not found' }, { status: 404 });
  }
  const decision = checkBudgetForAgendaItem(item, body);
  return NextResponse.json({ decision });
}
