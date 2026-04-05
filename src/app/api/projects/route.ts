import { NextResponse } from 'next/server';
import { createProject, listProjects } from '@/lib/agents/project-registry';
import { getErrorMessage, normalizeProject } from '@/lib/project-utils';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, goal, templateId, workspace, projectType, skillHint } = body;

    if (!name || !goal || !workspace) {
      return NextResponse.json({ error: 'Missing required fields: name, goal, workspace' }, { status: 400 });
    }

    const project = createProject({ name, goal, templateId, workspace, projectType, skillHint });
    return NextResponse.json(project, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

export async function GET() {
  const projects = listProjects().map(project => normalizeProject(project));
  return NextResponse.json(projects);
}
