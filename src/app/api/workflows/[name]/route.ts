import { NextResponse } from 'next/server';
import { deleteCanonicalWorkflow, getCanonicalWorkflow, saveCanonicalWorkflow } from '@/lib/agents/canonical-assets';

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

  saveCanonicalWorkflow(name, body.content);

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

  const workflow = getCanonicalWorkflow(name);
  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  return NextResponse.json({ name: workflow.name, content: workflow.content, description: workflow.description, source: workflow.source });
}

/**
 * DELETE /api/workflows/[name]
 * Delete a workflow file.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name) || name.length > 120) {
    return NextResponse.json({ error: 'Invalid workflow name' }, { status: 400 });
  }

  if (!deleteCanonicalWorkflow(name)) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, name });
}
