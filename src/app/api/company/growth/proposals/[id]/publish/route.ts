import { NextResponse } from 'next/server';

import { ensureGrowthProposalApprovalRequest } from '@/lib/company-kernel/growth-approval';
import { publishGrowthProposal } from '@/lib/company-kernel/growth-publisher';
import { getGrowthProposal } from '@/lib/company-kernel/growth-proposal-store';
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
  await req.json().catch(() => ({}));
  try {
    const proposal = publishGrowthProposal(id);
    if (!proposal) {
      return NextResponse.json({ error: 'Growth proposal not found' }, { status: 404 });
    }
    return NextResponse.json({ proposal });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('requires approval')) {
      const proposal = getGrowthProposal(id);
      if (proposal) {
        const updated = await ensureGrowthProposalApprovalRequest(proposal);
        return NextResponse.json({ error: message, proposal: updated }, { status: 409 });
      }
    }
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
