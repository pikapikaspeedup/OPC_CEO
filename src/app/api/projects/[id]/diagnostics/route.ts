import { NextResponse } from 'next/server';
import { analyzeProject } from '@/lib/agents/project-diagnostics';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const diagnostics = analyzeProject(id);
  if (!diagnostics) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json(diagnostics);
}
