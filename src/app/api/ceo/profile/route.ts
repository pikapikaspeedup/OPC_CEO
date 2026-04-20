import { NextResponse } from 'next/server';

import { getCEOProfile, updateCEOProfile } from '@/lib/organization';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getCEOProfile());
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const profile = updateCEOProfile(body || {});
    return NextResponse.json(profile);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
