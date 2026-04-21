import { NextResponse } from 'next/server';
import { getPlaygrounds } from '@/lib/bridge/gateway';
import { listKnownWorkspaces } from '@/lib/workspace-catalog';

export const dynamic = 'force-dynamic';

export async function GET() {
  const workspaces = listKnownWorkspaces().map((workspace) => ({
    name: workspace.name,
    uri: workspace.uri,
  }));
  const playgrounds = getPlaygrounds();

  return NextResponse.json({ workspaces, playgrounds });
}
