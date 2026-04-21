import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getKnownWorkspace } from '@/lib/workspace-catalog';

export const dynamic = 'force-dynamic';

function resolveWorkspace(req: Request): string | null {
  const url = new URL(req.url);
  const workspace = url.searchParams.get('workspace');
  return workspace || null;
}

// GET /api/departments?workspace=<encoded_uri>
export async function GET(req: Request) {
  const workspaceUri = resolveWorkspace(req);
  if (!workspaceUri) return NextResponse.json({ error: 'Missing workspace' }, { status: 400 });
  const workspace = getKnownWorkspace(workspaceUri);
  if (!workspace) return NextResponse.json({ error: 'Unknown workspace' }, { status: 403 });

  const configPath = path.join(workspace.path, '.department', 'config.json');

  if (!fs.existsSync(configPath)) {
    return NextResponse.json({
      name: path.basename(workspace.path),
      type: 'build',
      skills: [],
      okr: null,
    });
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return NextResponse.json(config);
  } catch {
    return NextResponse.json({ error: 'Invalid .department/config.json format' }, { status: 422 });
  }
}

// PUT /api/departments?workspace=<encoded_uri>
export async function PUT(req: Request) {
  const workspaceUri = resolveWorkspace(req);
  if (!workspaceUri) return NextResponse.json({ error: 'Missing workspace' }, { status: 400 });
  const workspace = getKnownWorkspace(workspaceUri);
  if (!workspace) return NextResponse.json({ error: 'Unknown workspace' }, { status: 403 });

  const config = await req.json();

  const dir = path.join(workspace.path, '.department');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));

  return NextResponse.json({ ok: true, syncPending: true });
}
