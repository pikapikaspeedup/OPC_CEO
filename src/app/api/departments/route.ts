import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getWorkspaces } from '@/lib/bridge/gateway';
import { syncRulesToAllIDEs } from '@/lib/agents/department-sync';

export const dynamic = 'force-dynamic';

function resolveWorkspace(req: Request): string | null {
  const url = new URL(req.url);
  const workspace = url.searchParams.get('workspace');
  return workspace ? workspace.replace(/^file:\/\//, '') : null;
}

/** Only allow registered workspace paths to prevent path traversal */
function isRegisteredWorkspace(uri: string): boolean {
  const registered = getWorkspaces() as Array<{ uri: string }>;
  return registered.some(w => w.uri.replace(/^file:\/\//, '') === uri);
}

// GET /api/departments?workspace=<encoded_uri>
export async function GET(req: Request) {
  const uri = resolveWorkspace(req);
  if (!uri) return NextResponse.json({ error: 'Missing workspace' }, { status: 400 });
  if (!isRegisteredWorkspace(uri)) return NextResponse.json({ error: 'Unknown workspace' }, { status: 403 });

  const configPath = path.join(uri, '.department', 'config.json');

  if (!fs.existsSync(configPath)) {
    return NextResponse.json({
      name: path.basename(uri),
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
  const uri = resolveWorkspace(req);
  if (!uri) return NextResponse.json({ error: 'Missing workspace' }, { status: 400 });
  if (!isRegisteredWorkspace(uri)) return NextResponse.json({ error: 'Unknown workspace' }, { status: 403 });

  const config = await req.json();

  const dir = path.join(uri, '.department');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  try {
    syncRulesToAllIDEs(uri);
  } catch (err: unknown) {
    console.warn('[Department Sync Error]', err instanceof Error ? err.message : String(err));
  }

  return NextResponse.json({ ok: true });
}
