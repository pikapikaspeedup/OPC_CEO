import { NextResponse } from 'next/server';
import { triggerScheduledJob } from '@/lib/agents/scheduler';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(_req);
  }

  try {
    const { id } = await params;
    const result = await triggerScheduledJob(id);
    return NextResponse.json(result);
  } catch (err: any) {
    const status = /not found/i.test(err.message) ? 404 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
