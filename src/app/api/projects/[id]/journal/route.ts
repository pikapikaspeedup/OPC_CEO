import { NextResponse } from 'next/server';
import { queryJournal, type JournalEventType } from '@/lib/agents/execution-journal';
import { getProject } from '@/lib/agents/project-registry';
import { paginateArray, parsePaginationSearchParams } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/[id]/journal
 * Query execution journal entries with optional filters.
 *
 * Query params:
 *   nodeId  — filter by node ID
 *   type    — filter by event type (e.g. 'gate:decided', 'loop:iteration')
 *   limit   — legacy alias for pageSize
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const url = new URL(request.url);
  const pagination = parsePaginationSearchParams(url.searchParams, {
    defaultPageSize: 100,
    maxPageSize: 200,
    legacyPageSizeKeys: ['limit'],
  });
  const nodeId = url.searchParams.get('nodeId');
  const type = url.searchParams.get('type');

  let entries;
  if (nodeId) {
    entries = queryJournal(id, {
      nodeId,
      limit: Number.MAX_SAFE_INTEGER,
    });
  } else {
    entries = queryJournal(id, {
      ...(type ? { eventType: type as JournalEventType } : {}),
      limit: Number.MAX_SAFE_INTEGER,
    });
  }

  return NextResponse.json(paginateArray([...entries].reverse(), pagination));
}
