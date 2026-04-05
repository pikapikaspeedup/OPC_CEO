import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { GLOBAL_ASSETS_DIR } from '@/lib/agents/gateway-home';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/workflows/[name]
 * Save workflow markdown content to disk.
 *
 * Body: { content: string }
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  // Validate name — strict character set to prevent path traversal
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name) || name.length > 120) {
    return NextResponse.json({ error: 'Invalid workflow name (alphanumeric, hyphens, underscores only)' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'content is required (string)' }, { status: 400 });
  }

  const workflowsDir = path.join(GLOBAL_ASSETS_DIR, 'workflows');
  fs.mkdirSync(workflowsDir, { recursive: true });
  const filePath = path.join(workflowsDir, `${name}.md`);
  fs.writeFileSync(filePath, body.content, 'utf-8');

  // Also sync to repo workflows if directory exists
  const repoWorkflowsDir = path.join(process.cwd(), '.agents', 'assets', 'workflows');
  if (fs.existsSync(repoWorkflowsDir)) {
    const repoPath = path.join(repoWorkflowsDir, `${name}.md`);
    fs.writeFileSync(repoPath, body.content, 'utf-8');
  }

  return NextResponse.json({ success: true, name });
}

/**
 * GET /api/workflows/[name]
 * Read workflow markdown content.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  // Validate name — strict character set to prevent path traversal
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name) || name.length > 120) {
    return NextResponse.json({ error: 'Invalid workflow name (alphanumeric, hyphens, underscores only)' }, { status: 400 });
  }

  const workflowsDir = path.join(GLOBAL_ASSETS_DIR, 'workflows');
  const filePath = path.join(workflowsDir, `${name}.md`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return NextResponse.json({ name, content });
}
