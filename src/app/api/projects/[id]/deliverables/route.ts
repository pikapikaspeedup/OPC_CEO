import { NextResponse } from 'next/server';
import { getProject } from '@/lib/agents/project-registry';
import { randomUUID } from 'crypto';
import {
  listDeliverableRecordsByProject,
  syncProjectRunArtifactsToDeliverables,
  upsertDeliverableRecord,
} from '@/lib/storage/gateway-db';
import { paginateArray, parsePaginationSearchParams } from '@/lib/pagination';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// GET /api/projects/[id]/deliverables
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  syncProjectRunArtifactsToDeliverables(id);
  const { searchParams } = new URL(req.url);
  const pagination = parsePaginationSearchParams(searchParams, {
    defaultPageSize: 50,
    maxPageSize: 200,
  });
  return NextResponse.json(paginateArray(listDeliverableRecordsByProject(id), pagination));
}

// POST /api/projects/[id]/deliverables
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const body = await req.json();
  const { stageId, type, title, artifactPath } = body;

  if (!stageId || !type || !title) {
    return NextResponse.json({ error: 'Missing required fields: stageId, type, title' }, { status: 400 });
  }

  const validTypes = ['document', 'code', 'data', 'review'];
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` }, { status: 400 });
  }

  const deliverable = {
    id: randomUUID(),
    projectId: id,
    stageId,
    type: type as 'document' | 'code' | 'data' | 'review',
    title,
    artifactPath,
    createdAt: new Date().toISOString(),
    quality: {},
  };
  upsertDeliverableRecord(deliverable);

  return NextResponse.json(deliverable, { status: 201 });
}
