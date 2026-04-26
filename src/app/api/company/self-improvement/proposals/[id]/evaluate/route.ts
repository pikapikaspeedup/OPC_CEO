import { NextResponse } from 'next/server';

import { ensureSystemImprovementApprovalRequest } from '@/lib/company-kernel/self-improvement-approval';
import { evaluateSystemImprovementRisk } from '@/lib/company-kernel/self-improvement-risk';
import {
  getSystemImprovementProposal,
  patchSystemImprovementProposal,
} from '@/lib/company-kernel/self-improvement-store';
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
  const proposal = getSystemImprovementProposal(id);
  if (!proposal) {
    return NextResponse.json({ error: 'System improvement proposal not found' }, { status: 404 });
  }

  const risk = evaluateSystemImprovementRisk({
    affectedFiles: proposal.affectedFiles,
    affectedAreas: [],
  });
  const status = proposal.evidenceRefs.length === 0
    ? 'needs-evidence'
    : risk.risk === 'high' || risk.risk === 'critical'
      ? 'approval-required'
      : proposal.status === 'rejected'
        ? 'rejected'
        : 'draft';
  const updated = patchSystemImprovementProposal(id, {
    risk: risk.risk,
    protectedAreas: risk.protectedAreas,
    status,
    metadata: {
      ...(proposal.metadata || {}),
      riskReasons: risk.reasons,
      evaluatedAt: new Date().toISOString(),
    },
  }) || proposal;
  const finalProposal = updated.status === 'approval-required'
    ? await ensureSystemImprovementApprovalRequest(updated.id)
    : updated;
  return NextResponse.json({ proposal: finalProposal });
}
