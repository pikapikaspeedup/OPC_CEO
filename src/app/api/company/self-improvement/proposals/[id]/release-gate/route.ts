import { NextResponse } from 'next/server';

import {
  runSystemImprovementReleaseAction,
  type SystemImprovementReleaseAction,
} from '@/lib/company-kernel/self-improvement-release-gate';
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
  const body = await req.json().catch(() => ({})) as {
    action?: SystemImprovementReleaseAction;
    actor?: string;
    note?: string;
    mergeCommitSha?: string;
    restartTarget?: string;
    healthCheckSummary?: string;
    observationSummary?: string;
    rollbackReason?: string;
  };
  if (!body.action) {
    return NextResponse.json({ error: 'release gate action is required' }, { status: 400 });
  }

  try {
    return NextResponse.json(await runSystemImprovementReleaseAction(id, {
      action: body.action,
      actor: body.actor,
      note: body.note,
      mergeCommitSha: body.mergeCommitSha,
      restartTarget: body.restartTarget,
      healthCheckSummary: body.healthCheckSummary,
      observationSummary: body.observationSummary,
      rollbackReason: body.rollbackReason,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
