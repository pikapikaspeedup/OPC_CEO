import { NextResponse } from 'next/server';

import { getCcConnectLocalState } from '@/lib/cc-connect-local';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const state = await getCcConnectLocalState();
    return NextResponse.json({ ok: true, data: state });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to inspect cc-connect local state',
      },
      { status: 500 },
    );
  }
}
