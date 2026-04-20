import { NextResponse } from 'next/server';
import { listCanonicalRules } from '@/lib/agents/canonical-assets';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(listCanonicalRules());
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
