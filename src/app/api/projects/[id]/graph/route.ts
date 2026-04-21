import { NextResponse } from 'next/server';
import { buildProjectGraph } from '@/lib/agents/project-diagnostics';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(_request);
  }

  const { id } = await params;

  const graph = buildProjectGraph(id);
  if (!graph) {
    return NextResponse.json({ error: 'Project not found or no pipeline state' }, { status: 404 });
  }

  return NextResponse.json(graph);
}
