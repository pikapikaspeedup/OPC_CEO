import { NextResponse } from 'next/server';

import { ensureCEOEventConsumer } from '@/lib/organization/ceo-event-consumer';
import { listCEOEvents } from '@/lib/organization/ceo-event-store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  ensureCEOEventConsumer();
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') || 20);
  return NextResponse.json({ events: listCEOEvents(limit) });
}
