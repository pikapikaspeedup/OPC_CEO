import { NextResponse } from 'next/server';

import { snoozeOperatingAgendaItem } from '@/lib/company-kernel/agenda-store';
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
  const body = await req.json().catch(() => ({})) as { snoozedUntil?: string; minutes?: number };
  const snoozedUntil = body.snoozedUntil
    || new Date(Date.now() + Math.max(1, Math.trunc(body.minutes || 60)) * 60_000).toISOString();
  const item = snoozeOperatingAgendaItem(id, snoozedUntil);
  if (!item) {
    return NextResponse.json({ error: 'Operating agenda item not found' }, { status: 404 });
  }
  return NextResponse.json({ item });
}
