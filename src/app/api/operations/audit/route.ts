import { NextResponse } from 'next/server';
import { queryAuditEvents, type AuditEventKind } from '@/lib/agents/ops-audit';
import { paginateArray, parsePaginationSearchParams } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const pagination = parsePaginationSearchParams(url.searchParams, {
    defaultPageSize: 100,
    maxPageSize: 200,
    legacyPageSizeKeys: ['limit'],
  });
  const kind = url.searchParams.get('kind') || undefined;
  const projectId = url.searchParams.get('projectId') || undefined;
  const since = url.searchParams.get('since') || undefined;
  const until = url.searchParams.get('until') || undefined;
  const events = queryAuditEvents({
    kind: kind as AuditEventKind | undefined,
    projectId,
    since,
    until,
    limit: Number.MAX_SAFE_INTEGER,
  });

  return NextResponse.json(paginateArray(events, pagination));
}
