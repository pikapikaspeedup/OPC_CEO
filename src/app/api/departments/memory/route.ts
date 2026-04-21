import { NextResponse } from 'next/server';
import {
  readDepartmentMemory,
  readOrganizationMemory,
  appendDepartmentMemory,
  initDepartmentMemory,
  type MemoryCategory,
} from '@/lib/agents/department-memory';
import { getKnownWorkspace } from '@/lib/workspace-catalog';

export const dynamic = 'force-dynamic';

function resolveWorkspace(req: Request): string | null {
  const url = new URL(req.url);
  const workspace = url.searchParams.get('workspace');
  return workspace || null;
}

const VALID_CATEGORIES: MemoryCategory[] = ['knowledge', 'decisions', 'patterns'];

// GET /api/departments/memory?workspace=<uri>[&scope=department|organization]
export async function GET(req: Request) {
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') || 'department';

  if (scope === 'organization') {
    const content = readOrganizationMemory();
    return NextResponse.json({ scope: 'organization', content });
  }

  const workspaceUri = resolveWorkspace(req);
  if (!workspaceUri) return NextResponse.json({ error: 'Missing workspace' }, { status: 400 });
  const workspace = getKnownWorkspace(workspaceUri);
  if (!workspace) return NextResponse.json({ error: 'Unknown workspace' }, { status: 403 });

  const memory = readDepartmentMemory(workspace.path);
  return NextResponse.json({ scope: 'department', workspace: workspace.uri, memory });
}

// POST /api/departments/memory?workspace=<uri>&category=<knowledge|decisions|patterns>
// Body: { content: string, source?: string }
export async function POST(req: Request) {
  const workspaceUri = resolveWorkspace(req);
  if (!workspaceUri) return NextResponse.json({ error: 'Missing workspace' }, { status: 400 });
  const workspace = getKnownWorkspace(workspaceUri);
  if (!workspace) return NextResponse.json({ error: 'Unknown workspace' }, { status: 403 });

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  if (action === 'init') {
    initDepartmentMemory(workspace.path);
    return NextResponse.json({ ok: true, action: 'initialized' });
  }

  const category = url.searchParams.get('category') as MemoryCategory | null;
  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `Invalid category. Valid: ${VALID_CATEGORIES.join(', ')}` }, { status: 400 });
  }

  const body = await req.json();
  if (!body.content || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'Missing content' }, { status: 400 });
  }

  appendDepartmentMemory(workspace.path, category, {
    timestamp: new Date().toISOString(),
    source: body.source || 'manual',
    content: body.content,
  });

  return NextResponse.json({ ok: true, category });
}
