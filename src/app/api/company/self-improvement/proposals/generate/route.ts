import { NextResponse } from 'next/server';

import { generateSystemImprovementProposal } from '@/lib/company-kernel/self-improvement-planner';
import { ensureSystemImprovementApprovalRequest } from '@/lib/company-kernel/self-improvement-approval';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const body = await req.json().catch(() => ({})) as Parameters<typeof generateSystemImprovementProposal>[0];
  if (!Array.isArray(body.signalIds) || body.signalIds.length === 0) {
    return NextResponse.json({ error: 'signalIds is required' }, { status: 400 });
  }
  try {
    const proposal = generateSystemImprovementProposal(body);
    const withApproval = proposal.status === 'approval-required'
      ? await ensureSystemImprovementApprovalRequest(proposal.id)
      : proposal;
    return NextResponse.json({ proposal: withApproval }, { status: 201 });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 400 });
  }
}
