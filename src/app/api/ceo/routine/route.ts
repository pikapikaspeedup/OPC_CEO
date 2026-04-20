import { NextResponse } from 'next/server';

import { buildCEORoutineSummary } from '@/lib/organization';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(buildCEORoutineSummary());
}
