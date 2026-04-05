import { NextResponse } from 'next/server';
import { getWorkspaces } from '@/lib/bridge/gateway';
import { getQuotaSummary } from '@/lib/approval/token-quota';

export const dynamic = 'force-dynamic';

// GET /api/departments/quota?workspace=<uri>
// Returns real-time token quota and usage for a workspace.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspace = url.searchParams.get('workspace');

  if (!workspace) {
    return NextResponse.json({ error: 'Missing workspace' }, { status: 400 });
  }

  const uri = workspace.replace(/^file:\/\//, '');
  const registered = getWorkspaces() as Array<{ uri: string }>;
  const isKnown = registered.some(w => w.uri.replace(/^file:\/\//, '') === uri);
  if (!isKnown) {
    return NextResponse.json({ error: 'Unknown workspace' }, { status: 403 });
  }

  const summary = getQuotaSummary(uri);
  return NextResponse.json({ workspace: uri, quota: summary });
}
