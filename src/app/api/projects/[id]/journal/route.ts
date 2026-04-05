import { NextResponse } from 'next/server';
import { queryJournal, getNodeJournal } from '@/lib/agents/execution-journal';
import { getProject } from '@/lib/agents/project-registry';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/[id]/journal
 * Query execution journal entries with optional filters.
 *
 * Query params:
 *   nodeId  — filter by node ID
 *   type    — filter by event type (e.g. 'gate:decided', 'loop:iteration')
 *   limit   — max entries to return (default 100)
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
  const nodeId = url.searchParams.get('nodeId');
  const type = url.searchParams.get('type');
  const limitStr = url.searchParams.get('limit');
  const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 100, 1), 1000) : 100;

  let entries;
  if (nodeId) {
    entries = getNodeJournal(id, nodeId);
  } else {
    entries = queryJournal(id, {
      ...(type ? { eventType: type as any } : {}),
    });
  }

  // Apply limit (most recent entries)
  const sliced = entries.slice(-limit);

  return NextResponse.json({ entries: sliced, total: entries.length });
}
