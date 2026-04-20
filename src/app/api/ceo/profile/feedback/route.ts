import { NextResponse } from 'next/server';

import { appendCEOFeedback } from '@/lib/organization';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.content || typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    const type = typeof body.type === 'string' ? body.type : 'preference';
    const profile = appendCEOFeedback({
      timestamp: new Date().toISOString(),
      type,
      content: body.content,
      source: 'user',
    });

    return NextResponse.json(profile);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
