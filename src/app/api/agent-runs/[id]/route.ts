import { NextResponse } from 'next/server';
import { getRun } from '@/lib/agents/run-registry';
import { cancelRun } from '@/lib/agents/group-runtime';
import { createLogger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const log = createLogger('AgentRun');

// GET /api/agent-runs/:id — get run status & result
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) {
    return NextResponse.json({ error: `Run not found: ${id}` }, { status: 404 });
  }
  return NextResponse.json(run);
}

// DELETE /api/agent-runs/:id — cancel a run
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await cancelRun(id);
    log.info({ runId: id.slice(0, 8) }, 'Run cancelled');
    return NextResponse.json({ status: 'cancelled' });
  } catch (err: any) {
    if (err.message.includes('not found')) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
