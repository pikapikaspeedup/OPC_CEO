import { NextResponse } from 'next/server';
import { reconcileProject } from '@/lib/agents/project-reconciler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let dryRun = true;
  try {
    const body = await request.json();
    if (body.dryRun === false) {
      dryRun = false;
    }
  } catch {
    // No body or invalid JSON — default to dryRun: true
  }

  try {
    const result = await reconcileProject(id, { dryRun });
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
