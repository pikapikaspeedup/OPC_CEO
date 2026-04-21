import { NextResponse } from 'next/server';
import { listCheckpoints, createCheckpoint } from '@/lib/agents/checkpoint-manager';
import { appendAuditEvent } from '@/lib/agents/ops-audit';
import { getProject } from '@/lib/agents/project-registry';
import { paginateArray, parsePaginationSearchParams } from '@/lib/pagination';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/[id]/checkpoints — list all checkpoints for a project.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(request);
  }

  const { id } = await params;

  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const pagination = parsePaginationSearchParams(searchParams, {
    defaultPageSize: 50,
    maxPageSize: 100,
  });
  const checkpoints = [...listCheckpoints(id)].reverse();
  return NextResponse.json(paginateArray(checkpoints, pagination));
}

/**
 * POST /api/projects/[id]/checkpoints — manually create a checkpoint.
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
