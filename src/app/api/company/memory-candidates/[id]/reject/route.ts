import { NextResponse } from 'next/server';

import { rejectMemoryCandidate } from '@/lib/company-kernel/memory-promotion';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { reason?: string };
    if (!body.reason || !body.reason.trim()) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 });
    }
    const candidate = rejectMemoryCandidate({
      candidateId: id,
      reason: body.reason.trim(),
      rejectedBy: 'ceo',
    });
    return NextResponse.json({ candidate });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : message.startsWith('Cannot ') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
