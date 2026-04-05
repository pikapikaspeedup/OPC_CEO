import { NextResponse } from 'next/server';
import { getWorkspaces } from '@/lib/bridge/gateway';
import { syncRulesToIDE, syncRulesToAllIDEs, type IDETarget } from '@/lib/agents/department-sync';

export const dynamic = 'force-dynamic';

function resolveWorkspace(req: Request): string | null {
  const url = new URL(req.url);
  const workspace = url.searchParams.get('workspace');
  return workspace ? workspace.replace(/^file:\/\//, '') : null;
}

function isRegisteredWorkspace(uri: string): boolean {
  const registered = getWorkspaces() as Array<{ uri: string }>;
  return registered.some(w => w.uri.replace(/^file:\/\//, '') === uri);
}

const VALID_TARGETS: IDETarget[] = ['antigravity', 'codex', 'claude-code', 'cursor'];

// POST /api/departments/sync?workspace=<uri>&target=<ide|all>
export async function POST(req: Request) {
  const uri = resolveWorkspace(req);
  if (!uri) return NextResponse.json({ error: 'Missing workspace' }, { status: 400 });
  if (!isRegisteredWorkspace(uri)) return NextResponse.json({ error: 'Unknown workspace' }, { status: 403 });

  const url = new URL(req.url);
  const target = url.searchParams.get('target') || 'all';

  if (target === 'all') {
    const { results } = syncRulesToAllIDEs(uri);
    return NextResponse.json({ ok: true, results });
  }

  if (!VALID_TARGETS.includes(target as IDETarget)) {
    return NextResponse.json({ error: `Invalid target: ${target}. Valid: ${VALID_TARGETS.join(', ')}` }, { status: 400 });
  }

  const { synced } = syncRulesToIDE(uri, target as IDETarget);
  return NextResponse.json({ ok: true, target, synced });
}
