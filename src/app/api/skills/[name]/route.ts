import { NextResponse } from 'next/server';
import { deleteCanonicalSkill, getCanonicalSkill, saveCanonicalSkill } from '@/lib/agents/canonical-assets';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  try {
    const skill = getCanonicalSkill(name);
    if (skill) {
      return NextResponse.json(skill);
    }
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * PUT /api/skills/[name]
 * Save skill SKILL.md content to disk.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name) || name.length > 120) {
    return NextResponse.json({ error: 'Invalid skill name' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'content is required (string)' }, { status: 400 });
  }

  saveCanonicalSkill(name, body.content);

  return NextResponse.json({ success: true, name });
}

/**
 * DELETE /api/skills/[name]
 * Delete a skill directory.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name) || name.length > 120) {
    return NextResponse.json({ error: 'Invalid skill name' }, { status: 400 });
  }

  if (!deleteCanonicalSkill(name)) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true, name });
}
