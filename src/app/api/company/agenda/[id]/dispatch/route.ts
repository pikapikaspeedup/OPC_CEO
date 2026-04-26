import { NextResponse } from 'next/server';

import {
  getOperatingAgendaItem,
  updateOperatingAgendaStatus,
} from '@/lib/company-kernel/agenda-store';
import {
  attachRunToBudgetReservation,
  reserveBudgetForAgendaItem,
} from '@/lib/company-kernel/budget-gate';
import type { BudgetScope } from '@/lib/company-kernel/contracts';
import { createRun } from '@/lib/agents/run-registry';
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
    scope?: BudgetScope;
    scopeId?: string;
    schedulerJobId?: string;
    proposalId?: string;
    prompt?: string;
    model?: string;
  };
  const item = getOperatingAgendaItem(id);
  if (!item) {
    return NextResponse.json({ error: 'Operating agenda item not found' }, { status: 404 });
  }

  const workspace = item.targetDepartmentId || item.workspaceUri;
  if (!workspace) {
    const blocked = updateOperatingAgendaStatus(item.id, 'blocked', {
      blockedReason: 'Agenda item has no target workspace for dispatch',
    });
    return NextResponse.json({
      error: 'Agenda item has no target workspace for dispatch',
      item: blocked,
    }, { status: 409 });
  }

  const { decision, ledger } = reserveBudgetForAgendaItem(item, body);
  if (!decision.allowed) {
    const blocked = updateOperatingAgendaStatus(item.id, 'blocked', {
      budgetDecisionId: decision.id,
      blockedReason: decision.reasons.join('; ') || 'Budget gate blocked dispatch',
    });
    return NextResponse.json({ decision, ledger, item: blocked }, { status: 409 });
  }

  const run = createRun({
    stageId: 'company-agenda-dispatch',
    workspace,
    prompt: body.prompt || [
      item.title,
      '',
      item.reason,
      '',
      'Evidence refs:',
      ...item.evidenceRefs.map((ref) => `- ${ref.label}: ${ref.id}`),
    ].join('\n'),
    ...(body.model ? { model: body.model } : {}),
    executorKind: 'prompt',
    executionTarget: {
      kind: 'prompt',
      ...(item.suggestedWorkflowRef ? { promptAssetRefs: [item.suggestedWorkflowRef] } : {}),
    },
    triggerContext: {
      source: 'api',
      intentSummary: `Company agenda dispatch: ${item.title}`,
      ...(body.schedulerJobId ? { schedulerJobId: body.schedulerJobId } : {}),
    },
  });
  const attachedLedger = attachRunToBudgetReservation(ledger, run.runId);
  const updated = updateOperatingAgendaStatus(item.id, 'dispatched', {
    budgetDecisionId: decision.id,
    dispatchedRunId: run.runId,
  });
  return NextResponse.json({ decision, ledger: attachedLedger, item: updated, run }, { status: 201 });
}
