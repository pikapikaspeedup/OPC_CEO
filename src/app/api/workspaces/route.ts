import { NextResponse } from 'next/server';
import { getWorkspaces, getPlaygrounds, discoverLanguageServers } from '@/lib/bridge/gateway';
import { ensureCEOWorkspaceOpen } from '@/lib/agents/ceo-environment';

export const dynamic = 'force-dynamic';

export async function GET() {
  const workspaces = getWorkspaces();
  const playgrounds = getPlaygrounds();

  // Ensure the CEO workspace is opened in Antigravity on first load
  const runningWs = discoverLanguageServers().map(s => s.workspace).filter(Boolean) as string[];
  ensureCEOWorkspaceOpen(runningWs);

  return NextResponse.json({ workspaces, playgrounds });
}
