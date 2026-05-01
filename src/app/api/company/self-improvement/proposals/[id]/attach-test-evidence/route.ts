import { NextResponse } from 'next/server';

import { attachSystemImprovementTestEvidence } from '@/lib/company-kernel/self-improvement-store';
import { syncSystemImprovementProposalRuntimeState } from '@/lib/company-kernel/self-improvement-runtime-state';
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
    command?: string;
    status?: 'passed' | 'failed';
    outputSummary?: string;
  };
  if (!body.command || !body.status || !body.outputSummary) {
    return NextResponse.json({ error: 'command, status and outputSummary are required' }, { status: 400 });
  }
  const proposal = attachSystemImprovementTestEvidence(id, {
    command: body.command,
    status: body.status,
    outputSummary: body.outputSummary,
    createdAt: new Date().toISOString(),
  });
  if (!proposal) {
    return NextResponse.json({ error: 'System improvement proposal not found' }, { status: 404 });
  }
  const synced = await syncSystemImprovementProposalRuntimeState(proposal.id, { proposal });
  return NextResponse.json({ proposal: synced || proposal });
}
