import { NextResponse } from 'next/server';
import { deleteCanonicalRule, getCanonicalRule, saveCanonicalRule } from '@/lib/agents/canonical-assets';

export const dynamic = 'force-dynamic';

/**
 * GET /api/rules/[name]
 * Read rule content.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name) || name.length > 120) {
    return NextResponse.json({ error: 'Invalid rule name' }, { status: 400 });
  }

  const rule = getCanonicalRule(name);
  if (!rule) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }

  return NextResponse.json({ name: rule.name, content: rule.content, description: rule.description, source: rule.source });
}

/**
 * PUT /api/rules/[name]
 * Save rule content.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name) || name.length > 120) {
    return NextResponse.json({ error: 'Invalid rule name' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'content is required (string)' }, { status: 400 });
  }

  saveCanonicalRule(name, body.content);

  return NextResponse.json({ success: true, name });
}

/**
 * DELETE /api/rules/[name]
 * Delete a rule.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name) || name.length > 120) {
    return NextResponse.json({ error: 'Invalid rule name' }, { status: 400 });
  }

  if (!deleteCanonicalRule(name)) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true, name });
}
