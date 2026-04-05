import { NextResponse } from 'next/server';
import { listCheckpoints, createCheckpoint } from '@/lib/agents/checkpoint-manager';
import { appendAuditEvent } from '@/lib/agents/ops-audit';
import { getProject } from '@/lib/agents/project-registry';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/[id]/checkpoints — list all checkpoints for a project.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const checkpoints = listCheckpoints(id);
  return NextResponse.json({ checkpoints });
}

/**
 * POST /api/projects/[id]/checkpoints — manually create a checkpoint.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const project = getProject(id);
  if (!project || !project.pipelineState) {
    return NextResponse.json({ error: 'Project not found or no pipeline state' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const nodeId = (body as Record<string, unknown>).nodeId as string | undefined;

  const checkpoint = createCheckpoint(
    id,
    nodeId ?? 'manual',
    project.pipelineState,
    project.pipelineState.loopCounters ?? {},
  );

  appendAuditEvent({
    kind: 'checkpoint:created',
    projectId: id,
    message: `Checkpoint ${checkpoint.id} created manually`,
    meta: { checkpointId: checkpoint.id, nodeId: nodeId ?? 'manual' },
  });

  return NextResponse.json(checkpoint, { status: 201 });
}
