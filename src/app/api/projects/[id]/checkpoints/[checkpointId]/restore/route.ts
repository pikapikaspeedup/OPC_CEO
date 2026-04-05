import { NextResponse } from 'next/server';
import { restoreFromCheckpoint } from '@/lib/agents/checkpoint-manager';
import { appendAuditEvent } from '@/lib/agents/ops-audit';
import { getProject, updateProject } from '@/lib/agents/project-registry';

export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/[id]/checkpoints/[checkpointId]/restore
 * Restore project pipeline state from a checkpoint.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; checkpointId: string }> },
) {
  const { id, checkpointId } = await params;

  const project = getProject(id);
  if (!project || !project.pipelineState) {
    return NextResponse.json({ error: 'Project not found or no pipeline state' }, { status: 404 });
  }

  try {
    const restored = restoreFromCheckpoint(id, checkpointId);

    // Apply restored state
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
      updatedAt: new Date().toISOString(),
    });

    appendAuditEvent({
      kind: 'checkpoint:restored',
      projectId: id,
      message: `Restored from checkpoint ${checkpointId}`,
      meta: { checkpointId },
    });

    return NextResponse.json({
      restored: true,
      checkpointId,
      activeStageIds: project.pipelineState.activeStageIds,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
