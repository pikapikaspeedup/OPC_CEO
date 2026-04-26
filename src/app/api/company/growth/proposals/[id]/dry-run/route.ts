import { NextResponse } from 'next/server';

import { runGrowthProposalScriptDryRun } from '@/lib/company-kernel/growth-script-dry-run';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<unknown> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const rawParams = await params as { id?: string };
  const id = rawParams.id || '';
  try {
    const proposal = runGrowthProposalScriptDryRun(id);
    if (!proposal) {
      return NextResponse.json({ error: 'Growth proposal not found' }, { status: 404 });
    }
    const dryRun = proposal.metadata?.scriptDryRun as { status?: string } | undefined;
    return NextResponse.json({ proposal, dryRun }, { status: dryRun?.status === 'failed' ? 409 : 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
