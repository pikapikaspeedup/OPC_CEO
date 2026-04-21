import { NextResponse } from 'next/server';
import { listCheckpoints, restoreFromCheckpoint } from '@/lib/agents/checkpoint-manager';
import { appendAuditEvent } from '@/lib/agents/ops-audit';
import { getProject, updateProject } from '@/lib/agents/project-registry';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/[id]/replay
 * Resume from latest checkpoint, or from a specified checkpointId.
 *
 * Body (optional): { checkpointId?: string }
 * - If checkpointId provided → restore from that checkpoint
 * - If omitted → restore from most recent checkpoint
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(request);
  }

  const { id } = await params;

  const project = getProject(id);
  if (!project || !project.pipelineState) {
    return NextResponse.json({ error: 'Project not found or no pipeline state' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  let checkpointId = (body as Record<string, unknown>).checkpointId as string | undefined;

  // If no explicit checkpoint, use latest
  if (!checkpointId) {
    const checkpoints = listCheckpoints(id);
    if (checkpoints.length === 0) {
      return NextResponse.json({ error: 'No checkpoints available for replay' }, { status: 400 });
    }
    checkpointId = checkpoints[checkpoints.length - 1].id;
  }

  try {
    const restored = restoreFromCheckpoint(id, checkpointId);

    const updatedState = {
      ...project.pipelineState,
      stages: restored.state.stages,
      activeStageIds: restored.state.activeStageIds,
      loopCounters: restored.loopCounters,
      lastCheckpointId: checkpointId,
      status: 'running' as const,
    };

    updateProject(id, {
      pipelineState: updatedState,
      status: 'active',
      updatedAt: new Date().toISOString(),
    });

    appendAuditEvent({
      kind: 'checkpoint:restored',
      projectId: id,
      message: `Replay from checkpoint ${checkpointId}`,
      meta: { checkpointId, action: 'replay' },
    });

    return NextResponse.json({
      replayed: true,
      checkpointId,
      restoredStageCount: restored.state.stages.length,
      activeStageIds: restored.state.activeStageIds,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
