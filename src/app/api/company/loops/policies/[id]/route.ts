import { NextResponse } from 'next/server';

import {
  buildDefaultCompanyLoopPolicy,
  getCompanyLoopPolicy,
  patchCompanyLoopPolicy,
  upsertCompanyLoopPolicy,
} from '@/lib/company-kernel/company-loop-policy';
import type { CompanyLoopPolicy } from '@/lib/company-kernel/contracts';
import { sanitizeCompanyLoopNotificationChannels } from '@/lib/company-kernel/company-loop-notification-targets';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { id } = await params;
  const policy = getCompanyLoopPolicy(id);
  if (!policy) {
    return NextResponse.json({ error: 'Company loop policy not found' }, { status: 404 });
  }
  return NextResponse.json({
    ...policy,
    notificationChannels: sanitizeCompanyLoopNotificationChannels(policy.notificationChannels),
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Partial<CompanyLoopPolicy>;
  const existing = getCompanyLoopPolicy(id);
  const base = existing || buildDefaultCompanyLoopPolicy({
    scope: body.scope || 'organization',
    ...(body.scopeId ? { scopeId: body.scopeId } : {}),
  });
  const next: CompanyLoopPolicy = {
    ...base,
    ...body,
    id,
    scope: body.scope || base.scope,
    timezone: body.timezone || base.timezone,
    dailyReviewHour: Math.max(0, Math.min(23, Math.trunc(body.dailyReviewHour ?? base.dailyReviewHour))),
    weeklyReviewDay: Math.max(0, Math.min(6, Math.trunc(body.weeklyReviewDay ?? base.weeklyReviewDay))),
    weeklyReviewHour: Math.max(0, Math.min(23, Math.trunc(body.weeklyReviewHour ?? base.weeklyReviewHour))),
    maxAgendaPerDailyLoop: Math.max(0, Math.min(100, Math.trunc(body.maxAgendaPerDailyLoop ?? base.maxAgendaPerDailyLoop))),
    maxAutonomousDispatchesPerLoop: Math.max(0, Math.min(10, Math.trunc(body.maxAutonomousDispatchesPerLoop ?? base.maxAutonomousDispatchesPerLoop))),
    allowedAgendaActions: body.allowedAgendaActions?.length ? body.allowedAgendaActions : base.allowedAgendaActions,
    notificationChannels: sanitizeCompanyLoopNotificationChannels(
      Array.isArray(body.notificationChannels) ? body.notificationChannels : base.notificationChannels,
    ),
    createdAt: existing?.createdAt || body.createdAt || base.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const policy = existing ? patchCompanyLoopPolicy(id, next) : upsertCompanyLoopPolicy(next);
  return NextResponse.json({ policy });
}
