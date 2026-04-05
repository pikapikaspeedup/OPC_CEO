import { NextResponse } from 'next/server';
import { deleteProject, getProject, updateProject } from '@/lib/agents/project-registry';
import { getRun } from '@/lib/agents/run-registry';
import { getErrorMessage, normalizeProject } from '@/lib/project-utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const normalizedProject = normalizeProject(project);
  const runs = normalizedProject.runIds.map(runId => getRun(runId)).filter(Boolean);

  return NextResponse.json({ ...normalizedProject, runs });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
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
  const { id } = await params;
  const deleted = deleteProject(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
