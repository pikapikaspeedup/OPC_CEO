import { NextResponse } from 'next/server';

import { recordBudgetForOperation } from '@/lib/company-kernel/budget-gate';
import { ensureGrowthProposalApprovalRequest } from '@/lib/company-kernel/growth-approval';
import { evaluateGrowthProposal } from '@/lib/company-kernel/growth-evaluator';
import { getGrowthProposal } from '@/lib/company-kernel/growth-proposal-store';
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
  const existing = getGrowthProposal(id);
  if (!existing) {
    return NextResponse.json({ error: 'Growth proposal not found' }, { status: 404 });
  }

  const budget = recordBudgetForOperation({
    scope: 'growth-proposal',
    scopeId: id,
    proposalId: id,
    estimatedCost: {
      tokens: 1_000 + Math.ceil(existing.content.length / 3),
      minutes: 2,
    },
    dispatches: 1,
    reason: `Growth proposal evaluation: ${existing.title}`,
    operationKind: 'growth.evaluate',
  });
  if (!budget.decision.allowed) {
    return NextResponse.json({
      error: budget.decision.reasons.join('; ') || 'Growth proposal evaluation blocked by budget gate',
      decision: budget.decision,
      ledger: budget.ledger,
    }, { status: 409 });
  }

  const evaluated = evaluateGrowthProposal(id);
  const proposal = evaluated ? await ensureGrowthProposalApprovalRequest(evaluated) : null;
  if (!proposal) {
    return NextResponse.json({ error: 'Growth proposal not found' }, { status: 404 });
  }
  return NextResponse.json({ proposal, decision: budget.decision, ledger: budget.ledger });
}
