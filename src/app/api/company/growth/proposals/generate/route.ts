import { NextResponse } from 'next/server';

import { recordBudgetForOperation } from '@/lib/company-kernel/budget-gate';
import { generateGrowthProposals } from '@/lib/company-kernel/crystallizer';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const body = await req.json().catch(() => ({})) as {
    workspaceUri?: string;
    limit?: number;
  };
  const limit = typeof body.limit === 'number' ? Math.max(1, Math.min(100, Math.trunc(body.limit))) : 20;
  const budget = recordBudgetForOperation({
    scope: 'growth-proposal',
    scopeId: body.workspaceUri || 'global',
    estimatedCost: {
      tokens: 1_500 + limit * 250,
      minutes: Math.max(1, Math.ceil(limit / 10)),
    },
    dispatches: 1,
    reason: 'Growth proposal generation',
    operationKind: 'growth.generate',
  });
  if (!budget.decision.allowed) {
    return NextResponse.json({
      error: budget.decision.reasons.join('; ') || 'Growth proposal generation blocked by budget gate',
      decision: budget.decision,
      ledger: budget.ledger,
      proposals: [],
    }, { status: 409 });
  }

  const proposals = generateGrowthProposals({
    ...(body.workspaceUri ? { workspaceUri: body.workspaceUri } : {}),
    limit,
  });
  return NextResponse.json({ proposals, decision: budget.decision, ledger: budget.ledger }, { status: 201 });
}
