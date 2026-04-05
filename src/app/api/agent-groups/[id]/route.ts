import { NextResponse } from 'next/server';
import { getGroup } from '@/lib/agents/group-registry';

export const dynamic = 'force-dynamic';

// GET /api/agent-groups/:id — get a specific agent group definition
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = getGroup(id);
  if (!group || group.executionMode === 'orchestration') {
    return NextResponse.json({ error: `Group not found: ${id}` }, { status: 404 });
  }
  return NextResponse.json(group);
}
