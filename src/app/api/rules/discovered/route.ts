import { NextResponse } from 'next/server';
import { getAllConnections, grpc } from '@/lib/bridge/gateway';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const conns = await getAllConnections();
    const ruleMap = new Map<string, {
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
        const data = await grpc.getAllRules(conn.port, conn.csrf);
        if (!data?.rules) continue;
        for (const rule of data.rules as Array<Record<string, unknown>>) {
          const key = typeof rule.name === 'string' && rule.name
            ? rule.name
            : typeof rule.path === 'string'
              ? rule.path
              : '';
          if (!key || ruleMap.has(key)) continue;
          ruleMap.set(key, {
            name: typeof rule.name === 'string' ? rule.name : key,
            description: typeof rule.description === 'string' ? rule.description : '',
            path: typeof rule.path === 'string' ? rule.path : '',
            content: typeof rule.content === 'string' ? rule.content : '',
            scope: (rule.scope && typeof rule.scope === 'object' && 'globalScope' in rule.scope) ? 'global' : 'workspace',
            baseDir: typeof rule.baseDir === 'string' ? rule.baseDir : '',
            source: 'discovered',
          });
        }
      } catch {
        // Ignore per-connection failures
      }
    }

    return NextResponse.json([...ruleMap.values()].sort((a, b) => a.name.localeCompare(b.name)));
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
