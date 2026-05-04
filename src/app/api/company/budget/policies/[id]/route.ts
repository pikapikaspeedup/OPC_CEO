import { NextResponse } from 'next/server';

import {
  buildDefaultBudgetPolicy,
  getBudgetPolicy,
  upsertBudgetPolicy,
} from '@/lib/company-kernel/budget-policy';
import type { BudgetPeriod, BudgetScope, OperatingBudgetPolicy } from '@/lib/company-kernel/contracts';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

const DEFAULT_BUDGET_POLICY_INPUTS: Record<string, {
  scope: BudgetScope;
  period: BudgetPeriod;
}> = {
  'budget:organization:default:day': {
    scope: 'organization',
    period: 'day',
  },
  'budget:department:default:day': {
    scope: 'department',
    period: 'day',
  },
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { id } = await params;
  const existing = getBudgetPolicy(id);
  const policy = existing || (DEFAULT_BUDGET_POLICY_INPUTS[id]
    ? upsertBudgetPolicy(buildDefaultBudgetPolicy(DEFAULT_BUDGET_POLICY_INPUTS[id]))
    : null);
  if (!policy) {
    return NextResponse.json({ error: 'Budget policy not found' }, { status: 404 });
  }
  return NextResponse.json(policy);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Partial<OperatingBudgetPolicy> & {
    scope?: BudgetScope;
    period?: BudgetPeriod;
  };
  const existing = getBudgetPolicy(id);
  const base = existing || buildDefaultBudgetPolicy({
    scope: body.scope || 'organization',
    scopeId: body.scopeId,
    period: body.period || 'day',
  });
  const policy = upsertBudgetPolicy({
    ...base,
    ...body,
    id,
    scope: body.scope || base.scope,
    period: body.period || base.period,
    maxTokens: Math.max(0, Math.trunc(body.maxTokens ?? base.maxTokens)),
    maxMinutes: Math.max(0, Math.trunc(body.maxMinutes ?? base.maxMinutes)),
    maxDispatches: Math.max(0, Math.trunc(body.maxDispatches ?? base.maxDispatches)),
    warningThreshold: Math.max(0, Math.min(1, Number(body.warningThreshold ?? base.warningThreshold))),
    hardStop: body.hardStop ?? base.hardStop,
    createdAt: existing?.createdAt || base.createdAt,
    updatedAt: new Date().toISOString(),
  });
  return NextResponse.json({ policy });
}
