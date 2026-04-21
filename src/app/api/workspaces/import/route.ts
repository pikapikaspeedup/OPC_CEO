import { NextResponse } from 'next/server';

import { registerWorkspace } from '@/lib/workspace-catalog';

export const dynamic = 'force-dynamic';

// POST /api/workspaces/import — Register a workspace without launching Antigravity.
export async function POST(req: Request) {
  const { workspace } = await req.json();
  if (!workspace || typeof workspace !== 'string') {
    return NextResponse.json({ error: 'Missing workspace path' }, { status: 400 });
  }

  try {
    const registered = registerWorkspace({
      workspace,
      sourceKind: 'manual-import',
    });
    return NextResponse.json({
      ok: true,
      workspace: {
        name: registered.name,
        uri: registered.uri,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to import workspace' }, { status: 400 });
  }
}
