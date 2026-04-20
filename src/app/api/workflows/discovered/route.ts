import { NextResponse } from 'next/server';
import { getAllConnections, grpc } from '@/lib/bridge/gateway';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const conns = await getAllConnections();
    const workflowMap = new Map<string, {
      name: string;
      description: string;
      path: string;
      content: string;
      scope: 'global' | 'workspace';
      baseDir: string;
      source: 'discovered';
    }>();

    for (const conn of conns) {
      try {
        const data = await grpc.getAllWorkflows(conn.port, conn.csrf);
        if (!data?.workflows) continue;
        for (const wf of data.workflows as Array<Record<string, unknown>>) {
          const name = typeof wf.name === 'string' ? wf.name : '';
          if (!name || workflowMap.has(name)) continue;
          workflowMap.set(name, {
            name,
            description: typeof wf.description === 'string' ? wf.description : '',
            path: typeof wf.path === 'string' ? wf.path : '',
            content: typeof wf.content === 'string' ? wf.content : '',
            scope: (wf.scope && typeof wf.scope === 'object' && 'globalScope' in wf.scope) ? 'global' : 'workspace',
            baseDir: typeof wf.baseDir === 'string' ? wf.baseDir : '',
            source: 'discovered',
          });
        }
      } catch {
        // Ignore per-connection failures; discovered view is best-effort
      }
    }

    return NextResponse.json([...workflowMap.values()].sort((a, b) => a.name.localeCompare(b.name)));
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
