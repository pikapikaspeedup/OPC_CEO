import { NextResponse } from 'next/server';
import { syncRulesToIDE, syncRulesToAllIDEs, type IDETarget } from '@/lib/agents/department-sync';
import { getKnownWorkspace } from '@/lib/workspace-catalog';

export const dynamic = 'force-dynamic';

function resolveWorkspace(req: Request): string | null {
  const url = new URL(req.url);
  const workspace = url.searchParams.get('workspace');
  return workspace || null;
}

const VALID_TARGETS: IDETarget[] = ['antigravity', 'codex', 'claude-code', 'cursor'];

// POST /api/departments/sync?workspace=<uri>&target=<ide|all>
export async function POST(req: Request) {
  const workspaceUri = resolveWorkspace(req);
  if (!workspaceUri) return NextResponse.json({ error: 'Missing workspace' }, { status: 400 });
  const workspace = getKnownWorkspace(workspaceUri);
  if (!workspace) return NextResponse.json({ error: 'Unknown workspace' }, { status: 403 });

  const url = new URL(req.url);
  const target = url.searchParams.get('target') || 'all';

  if (target === 'all') {
    const { results } = syncRulesToAllIDEs(workspace.path);
    return NextResponse.json({ ok: true, results });
  }

  if (!VALID_TARGETS.includes(target as IDETarget)) {
    return NextResponse.json({ error: `Invalid target: ${target}. Valid: ${VALID_TARGETS.join(', ')}` }, { status: 400 });
  }

  const { synced } = syncRulesToIDE(workspace.path, target as IDETarget);
  return NextResponse.json({ ok: true, target, synced });
}
