import { NextResponse } from 'next/server';

import { observeSystemImprovementProposal } from '@/lib/company-kernel/self-improvement-observer';
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

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    summary?: string;
    linkedRunIds?: string[];
    metadata?: Record<string, unknown>;
  };
  try {
    return NextResponse.json({
      proposal: observeSystemImprovementProposal({
        proposalId: id,
        summary: body.summary || 'Observation started.',
        linkedRunIds: body.linkedRunIds,
        metadata: body.metadata,
      }),
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 404 });
  }
}
