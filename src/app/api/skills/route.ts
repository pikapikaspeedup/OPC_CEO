import { NextResponse } from 'next/server';
import { listCanonicalSkills } from '@/lib/agents/canonical-assets';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(listCanonicalSkills());
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
