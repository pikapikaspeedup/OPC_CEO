import { randomUUID } from 'crypto';

import { createRun } from '../agents/run-registry';
import { listOperatingAgendaItems, updateOperatingAgendaStatus } from './agenda-store';
import { attachRunToBudgetReservation, recordBudgetForOperation, reserveBudgetForAgendaItem } from './budget-gate';
import { buildCompanyLoopDigest } from './company-loop-digest';
import { getOrCreateCompanyLoopPolicy, getCompanyLoopPolicy } from './company-loop-policy';
import {
  getCompanyLoopRun,
  upsertCompanyLoopDigest,
  upsertCompanyLoopRun,
} from './company-loop-run-store';
import { notifyCompanyLoopDigest } from './company-loop-notifier';
import { selectCompanyLoopAgenda } from './company-loop-selector';
import { generateGrowthProposals } from './crystallizer';
import type {
  BudgetLedgerEntry,
  CompanyLoopPolicy,
  CompanyLoopRun,
  CompanyLoopRunKind,
  GrowthProposal,
  OperatingAgendaItem,
} from './contracts';

export interface RunCompanyLoopInput {
  policyId?: string;
  kind?: CompanyLoopRunKind;
  date?: string;
  timezone?: string;
  source?: 'api' | 'scheduler' | 'test';
}

export interface RunCompanyLoopResult {
  run: CompanyLoopRun;
  digestId?: string;
  selectedAgenda: OperatingAgendaItem[];
  skipped: Array<{ item: OperatingAgendaItem; reason: string }>;
  budgetLedger: BudgetLedgerEntry[];
  generatedProposals: GrowthProposal[];
}

function formatDateForTimezone(timezone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function buildInitialRun(input: {
  policy: CompanyLoopPolicy;
  kind: CompanyLoopRunKind;
  date: string;
  timezone: string;
}): CompanyLoopRun {
  const now = new Date().toISOString();
  return {
    id: `company-loop-run-${randomUUID()}`,
    policyId: input.policy.id,
    kind: input.kind,
    status: 'running',
    date: input.date,
    timezone: input.timezone,
    selectedAgendaIds: [],
    dispatchedRunIds: [],
    generatedProposalIds: [],
    notificationIds: [],
    budgetLedgerIds: [],
    summary: 'Company loop is running.',
    startedAt: now,
    metadata: {
      policyScope: input.policy.scope,
      ...(input.policy.scopeId ? { policyScopeId: input.policy.scopeId } : {}),
    },
  };
}

function agendaDispatchPrompt(item: OperatingAgendaItem): string {
  return [
    item.title,
    '',
    item.reason,
    '',
    'This run was selected by the autonomous company loop. Respect budget, evidence, and result-envelope requirements.',
    '',
    'Evidence refs:',
    ...item.evidenceRefs.map((ref) => `- ${ref.label}: ${ref.id}`),
  ].join('\n');
}

function dispatchAgendaFromLoop(input: {
  item: OperatingAgendaItem;
  source: 'api' | 'scheduler' | 'test';
}): {
  runId?: string;
  ledger?: BudgetLedgerEntry;
  skippedReason?: string;
} {
  const workspace = input.item.targetDepartmentId || input.item.workspaceUri;
  if (!workspace) {
    updateOperatingAgendaStatus(input.item.id, 'blocked', {
      blockedReason: 'Agenda item has no target workspace for loop dispatch',
    });
    return { skippedReason: 'no-target-workspace' };
  }

  const budget = reserveBudgetForAgendaItem(input.item, {
    operationKind: 'agenda.dispatch',
    reason: 'Autonomous company loop dispatch',
    blockedDecision: 'skipped',
  });
  if (!budget.decision.allowed) {
    updateOperatingAgendaStatus(input.item.id, 'blocked', {
      budgetDecisionId: budget.decision.id,
      blockedReason: budget.decision.reasons.join('; ') || 'Budget gate blocked loop dispatch',
    });
    return {
      ledger: budget.ledger,
      skippedReason: budget.decision.reasons.join('; ') || 'budget-blocked',
    };
  }

  const run = createRun({
    stageId: 'company-loop-dispatch',
    workspace,
    prompt: agendaDispatchPrompt(input.item),
    executorKind: 'prompt',
    executionTarget: {
      kind: 'prompt',
      ...(input.item.suggestedWorkflowRef ? { promptAssetRefs: [input.item.suggestedWorkflowRef] } : {}),
    },
    triggerContext: {
      source: input.source === 'scheduler' ? 'scheduler' : 'api',
      intentSummary: `Company loop dispatch: ${input.item.title}`,
    },
  });
  const attachedLedger = attachRunToBudgetReservation(budget.ledger, run.runId);
  updateOperatingAgendaStatus(input.item.id, 'dispatched', {
    budgetDecisionId: budget.decision.id,
    dispatchedRunId: run.runId,
  });
  return {
    runId: run.runId,
    ledger: attachedLedger,
  };
}

function maybeGenerateGrowthProposals(input: {
  policy: CompanyLoopPolicy;
  kind: CompanyLoopRunKind;
}): {
  proposals: GrowthProposal[];
  ledger?: BudgetLedgerEntry;
  skippedReason?: string;
} {
  if (!input.policy.growthReviewEnabled) return { proposals: [] };
  if (input.kind !== 'growth-review' && input.kind !== 'weekly-review') return { proposals: [] };

  const budget = recordBudgetForOperation({
    scope: 'growth-proposal',
    scopeId: input.policy.scopeId || 'global',
    estimatedCost: { tokens: 2_250, minutes: 1 },
    dispatches: 1,
    reason: 'Company loop growth proposal review',
    operationKind: 'growth.generate',
    blockedDecision: 'skipped',
  });
  if (!budget.decision.allowed) {
    return {
      proposals: [],
      ledger: budget.ledger,
      skippedReason: budget.decision.reasons.join('; ') || 'growth-budget-blocked',
    };
  }

  return {
    proposals: generateGrowthProposals({
      ...(input.policy.scope === 'department' && input.policy.scopeId ? { workspaceUri: input.policy.scopeId } : {}),
      limit: 3,
    }),
    ledger: budget.ledger,
  };
}

function serializeSkippedAgenda(entries: Array<{ item: OperatingAgendaItem; reason: string }>): Array<Record<string, unknown>> {
  return entries.map((entry) => ({
    id: entry.item.id,
    title: entry.item.title,
    reason: entry.reason,
    status: entry.item.status,
    priority: entry.item.priority,
    recommendedAction: entry.item.recommendedAction,
    signalIds: entry.item.signalIds,
    evidenceRefs: entry.item.evidenceRefs,
    estimatedCost: entry.item.estimatedCost,
    ...(entry.item.targetDepartmentId ? { targetDepartmentId: entry.item.targetDepartmentId } : {}),
    ...(entry.item.workspaceUri ? { workspaceUri: entry.item.workspaceUri } : {}),
    ...(entry.item.budgetDecisionId ? { budgetDecisionId: entry.item.budgetDecisionId } : {}),
    ...(entry.item.dispatchedRunId ? { dispatchedRunId: entry.item.dispatchedRunId } : {}),
    ...(entry.item.blockedReason ? { blockedReason: entry.item.blockedReason } : {}),
    ...(entry.item.metadata ? { metadata: entry.item.metadata } : {}),
  }));
}

export function runCompanyLoop(input: RunCompanyLoopInput = {}): RunCompanyLoopResult {
  const policy = input.policyId
    ? getCompanyLoopPolicy(input.policyId)
    : getOrCreateCompanyLoopPolicy();
  if (!policy) {
    throw new Error(`Company loop policy not found: ${input.policyId}`);
  }

  const timezone = input.timezone || policy.timezone;
  const kind = input.kind || 'daily-review';
  const date = input.date || formatDateForTimezone(timezone);
  const source = input.source || 'api';
  const started = buildInitialRun({ policy, kind, date, timezone });
  upsertCompanyLoopRun(started);

  if (!policy.enabled) {
    const skippedRun = upsertCompanyLoopRun({
      ...started,
      status: 'skipped',
      summary: 'Company loop policy is disabled.',
      skipReason: 'policy-disabled',
      finishedAt: new Date().toISOString(),
    });
    return {
      run: skippedRun,
      selectedAgenda: [],
      skipped: [],
      budgetLedger: [],
      generatedProposals: [],
    };
  }

  try {
    const agenda = listOperatingAgendaItems({
      status: ['ready', 'triaged'],
      limit: 100,
    });
    const selection = selectCompanyLoopAgenda({ policy, agenda });
    const skipped = [...selection.skipped, ...selection.digestOnly];
    const budgetLedger: BudgetLedgerEntry[] = [];
    const dispatchedRunIds: string[] = [];

    for (const item of selection.dispatchCandidates) {
      const dispatch = dispatchAgendaFromLoop({ item, source });
      if (dispatch.ledger) budgetLedger.push(dispatch.ledger);
      if (dispatch.runId) {
        dispatchedRunIds.push(dispatch.runId);
      } else if (dispatch.skippedReason) {
        skipped.push({ item, reason: dispatch.skippedReason });
      }
    }

    const growth = maybeGenerateGrowthProposals({ policy, kind });
    if (growth.ledger) budgetLedger.push(growth.ledger);
    if (growth.skippedReason) {
      skipped.push({
        item: {
          id: `growth-review:${started.id}`,
          signalIds: [],
          title: 'Growth proposal review',
          recommendedAction: 'observe',
          priority: 'p2',
          score: 0,
          status: 'blocked',
          reason: growth.skippedReason,
          evidenceRefs: [],
          estimatedCost: { tokens: 0, minutes: 0 },
          createdAt: started.startedAt,
          updatedAt: started.startedAt,
        },
        reason: growth.skippedReason,
      });
    }

    const completedRun: CompanyLoopRun = {
      ...started,
      status: 'completed',
      selectedAgendaIds: selection.selected.map((item) => item.id),
      dispatchedRunIds,
      generatedProposalIds: growth.proposals.map((proposal) => proposal.id),
      budgetLedgerIds: budgetLedger.map((entry) => entry.id),
      summary: [
        `Selected ${selection.selected.length} agenda items.`,
        `Dispatched ${dispatchedRunIds.length}.`,
        `Skipped ${skipped.length}.`,
        growth.proposals.length > 0 ? `Generated ${growth.proposals.length} proposals.` : '',
      ].filter(Boolean).join(' '),
      finishedAt: new Date().toISOString(),
      metadata: {
        ...(started.metadata || {}),
        skippedAgenda: serializeSkippedAgenda(skipped),
        skippedCount: skipped.length,
        digestOnly: selection.digestOnly.map((entry) => ({ id: entry.item.id, reason: entry.reason })),
      },
    };

    const digest = buildCompanyLoopDigest({
      run: completedRun,
      selectedAgenda: selection.selected,
      skipped,
      budgetLedger,
      generatedProposals: growth.proposals,
    });
    const storedDigest = upsertCompanyLoopDigest(digest);
    const notificationIds = notifyCompanyLoopDigest({
      digest: storedDigest,
      channels: policy.notificationChannels,
    });
    const finalRun = upsertCompanyLoopRun({
      ...completedRun,
      notificationIds,
      metadata: {
        ...(completedRun.metadata || {}),
        digestId: storedDigest.id,
      },
    });

    return {
      run: finalRun,
      digestId: storedDigest.id,
      selectedAgenda: selection.selected,
      skipped,
      budgetLedger,
      generatedProposals: growth.proposals,
    };
  } catch (err) {
    const failedRun = upsertCompanyLoopRun({
      ...started,
      status: 'failed',
      summary: 'Company loop failed.',
      error: err instanceof Error ? err.message : String(err),
      finishedAt: new Date().toISOString(),
    });
    return {
      run: failedRun,
      selectedAgenda: [],
      skipped: [],
      budgetLedger: [],
      generatedProposals: [],
    };
  }
}

export function retryCompanyLoopRun(id: string): RunCompanyLoopResult {
  const existing = getCompanyLoopRun(id);
  if (!existing) {
    throw new Error(`Company loop run not found: ${id}`);
  }
  if (existing.status !== 'failed' && existing.status !== 'skipped') {
    throw new Error(`Only failed or skipped company loop runs can be retried: ${existing.status}`);
  }
  return runCompanyLoop({
    policyId: existing.policyId,
    kind: existing.kind,
    date: existing.date,
    timezone: existing.timezone,
    source: 'api',
  });
}
