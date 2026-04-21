import { NextResponse } from 'next/server';
import { getErrorMessage, normalizeProject } from '@/lib/project-utils';
import { getProjectRecord, listRunRecordsByIds } from '@/lib/storage/gateway-db';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { id } = await params;
  const project = getProjectRecord(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const runIds = Array.from(new Set([
    ...project.runIds,
    ...(project.pipelineState?.stages.map((stage) => stage.runId).filter(Boolean) as string[] || []),
  ]));
  const runRecords = listRunRecordsByIds(runIds);
  const runMap = new Map(runRecords.map((run) => [run.runId, run]));
  const normalizedProject = normalizeProject(project, {
    getRunById: (runId) => runMap.get(runId),
  });
  const runs = normalizedProject.runIds.map(runId => runMap.get(runId)).filter(Boolean);

  return NextResponse.json({ ...normalizedProject, runs });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  try {
    const { id } = await params;
    const body = await req.json();
    const { updateProject } = await import('@/lib/agents/project-registry');
    const project = updateProject(id, body);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    return NextResponse.json(project);
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { id } = await params;
  const { deleteProject } = await import('@/lib/agents/project-registry');
  const deleted = deleteProject(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
