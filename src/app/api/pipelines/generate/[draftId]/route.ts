import { NextResponse } from 'next/server';
import { getDraft } from '@/lib/agents/pipeline-generator';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pipelines/generate/[draftId]
 * Retrieve a draft by ID.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await params;

  const draft = getDraft(draftId);
  if (!draft) {
    return NextResponse.json({ error: 'Draft not found or expired' }, { status: 404 });
  }

  return NextResponse.json(draft);
}
