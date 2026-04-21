import { NextResponse } from 'next/server';
import { getRun } from '@/lib/agents/run-registry';
import { interveneRun, cancelRun, InterventionConflictError } from '@/lib/agents/group-runtime';
import { cancelPromptRun, evaluatePromptRun } from '@/lib/agents/prompt-executor';
import { createLogger } from '@/lib/logger';
import {
  proxyToControlPlane,
  proxyToRuntime,
  shouldProxyControlPlaneRequest,
  shouldProxyRuntimeRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

const log = createLogger('RunIntervene');

// POST /api/agent-runs/:id/intervene — intervene on a run without creating a new run
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  if (shouldProxyRuntimeRequest()) {
    return proxyToRuntime(req);
  }

  try {
    const { id: runId } = await params;
    const body = await req.json();

    const { action, prompt, roleId } = body;
    const run = getRun(runId);

    if (!action || !['nudge', 'retry', 'restart_role', 'cancel', 'evaluate'].includes(action)) {
      return NextResponse.json(
        { error: 'Missing or invalid action. Must be "nudge", "retry", "restart_role", "cancel", or "evaluate".' },
        { status: 400 },
      );
    }

    if (run?.executorKind === 'prompt' && action !== 'cancel' && action !== 'evaluate') {
      return NextResponse.json(
        { error: 'Prompt-mode runs currently support cancel and evaluate only.' },
        { status: 400 },
      );
    }

    log.info({ runId: runId.slice(0, 8), action, hasPrompt: !!prompt, roleId }, 'Intervention requested');

    // V3.5: Sync admission check (InterventionConflictError is thrown
    // before the first await inside interveneRun, so try/catch works here).
    // The actual intervention work is fire-and-forget to avoid blocking the HTTP response.
    try {
      let resultPromise;
      if (action === 'cancel') {
        resultPromise = run?.executorKind === 'prompt'
          ? cancelPromptRun(runId)
          : cancelRun(runId);
      } else if (action === 'evaluate' && run?.executorKind === 'prompt') {
        resultPromise = evaluatePromptRun(runId);
      } else {
        resultPromise = interveneRun(runId, action, prompt, roleId);
      }

      resultPromise.catch((error: unknown) => {
        log.error({ runId: runId.slice(0, 8), err: error instanceof Error ? error.message : String(error) }, 'Intervention failed');
      });
    } catch (error: unknown) {
      if (error instanceof InterventionConflictError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json(
      { status: 'intervening', action, runId },
      { status: 202 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: message }, 'Intervention request failed');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
