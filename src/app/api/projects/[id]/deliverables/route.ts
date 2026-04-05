import { NextResponse } from 'next/server';
import { getProject } from '@/lib/agents/project-registry';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

// In-memory store for deliverables (Phase 3 — upgrade to disk persistence later)
const deliverables = new Map<string, Array<{
  id: string;
  projectId: string;
  stageId: string;
  type: 'document' | 'code' | 'data' | 'review';
  title: string;
  artifactPath?: string;
  createdAt: string;
  quality: {
    reviewDecision?: 'approved' | 'revise' | 'rejected';
    reviewedAt?: string;
  };
}>>();

// GET /api/projects/[id]/deliverables
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json(deliverables.get(id) || []);
}

// POST /api/projects/[id]/deliverables
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  if (!deliverables.has(id)) {
    deliverables.set(id, []);
  }
  deliverables.get(id)!.push(deliverable);

  return NextResponse.json(deliverable, { status: 201 });
}
