import { NextResponse } from 'next/server';
import { getRun } from '@/lib/agents/run-registry';
import { cancelRun } from '@/lib/agents/group-runtime';
import { cancelPromptRun } from '@/lib/agents/prompt-executor';
import {
  cancelSystemImprovementCodexRun,
  isSystemImprovementCodexTrackingRun,
} from '@/lib/company-kernel/self-improvement-codex-execution';
import { createLogger } from '@/lib/logger';
import {
  proxyToControlPlane,
  proxyToRuntime,
  shouldProxyControlPlaneRequest,
  shouldProxyRuntimeRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

const log = createLogger('AgentRun');

// GET /api/agent-runs/:id — get run status & result
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(_req);
  }

  const { id } = await params;
  const run = getRun(id);
  if (!run) {
    return NextResponse.json({ error: `Run not found: ${id}` }, { status: 404 });
  }
  return NextResponse.json(run);
}

// DELETE /api/agent-runs/:id — cancel a run
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(_req);
  }
  if (shouldProxyRuntimeRequest()) {
    return proxyToRuntime(_req);
  }

  const { id } = await params;
  try {
    const run = getRun(id);
    if (!run) {
      return NextResponse.json({ error: `Run not found: ${id}` }, { status: 404 });
    }

    if (isSystemImprovementCodexTrackingRun(run)) {
      await cancelSystemImprovementCodexRun(id);
    } else if (run.executorKind === 'prompt') {
      await cancelPromptRun(id);
    } else {
      await cancelRun(id);
    }

    log.info({ runId: id.slice(0, 8) }, 'Run cancelled');
    return NextResponse.json({ status: 'cancelled' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not found')) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
