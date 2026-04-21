import { NextResponse } from 'next/server';
import { getQuotaSummary } from '@/lib/approval/token-quota';
import { getKnownWorkspace } from '@/lib/workspace-catalog';

export const dynamic = 'force-dynamic';

// GET /api/departments/quota?workspace=<uri>
// Returns real-time token quota and usage for a workspace.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspace = url.searchParams.get('workspace');

  if (!workspace) {
    return NextResponse.json({ error: 'Missing workspace' }, { status: 400 });
  }

  const knownWorkspace = getKnownWorkspace(workspace);
  if (!knownWorkspace) {
    return NextResponse.json({ error: 'Unknown workspace' }, { status: 403 });
  }

  const summary = getQuotaSummary(knownWorkspace.path);
  return NextResponse.json({ workspace: knownWorkspace.uri, quota: summary });
}
