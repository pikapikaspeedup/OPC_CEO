import { NextResponse } from 'next/server';
import { getAllConnections, grpc } from '@/lib/bridge/gateway';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const conns = await getAllConnections();
    const skillMap = new Map<string, {
      name: string;
      description: string;
      path: string;
      baseDir: string;
      scope: 'global' | 'workspace';
      source: 'discovered';
      content?: string;
    }>();

    for (const conn of conns) {
      try {
        const data = await grpc.getAllSkills(conn.port, conn.csrf);
        if (!data?.skills) continue;
        for (const skill of data.skills as Array<Record<string, unknown>>) {
          const name = typeof skill.name === 'string' ? skill.name : '';
          if (!name || skillMap.has(name)) continue;
          skillMap.set(name, {
            name,
            description: typeof skill.description === 'string' ? skill.description : '',
            path: typeof skill.path === 'string' ? skill.path : '',
            baseDir: typeof skill.baseDir === 'string' ? skill.baseDir : '',
            scope: (skill.scope && typeof skill.scope === 'object' && 'globalScope' in skill.scope) ? 'global' : 'workspace',
            source: 'discovered',
            content: typeof skill.content === 'string' ? skill.content : undefined,
          });
        }
      } catch {
        // Ignore per-connection failures
      }
    }

    return NextResponse.json([...skillMap.values()].sort((a, b) => a.name.localeCompare(b.name)));
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
