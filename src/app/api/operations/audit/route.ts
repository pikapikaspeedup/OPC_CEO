import { NextResponse } from 'next/server';
import { queryAuditEvents } from '@/lib/agents/ops-audit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') || undefined;
  const projectId = url.searchParams.get('projectId') || undefined;
  const since = url.searchParams.get('since') || undefined;
  const until = url.searchParams.get('until') || undefined;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  const events = queryAuditEvents({
    kind: kind as any,
    projectId,
    since,
    until,
    limit: limit && !isNaN(limit) ? limit : undefined,
  });

  return NextResponse.json({ events, total: events.length });
}
