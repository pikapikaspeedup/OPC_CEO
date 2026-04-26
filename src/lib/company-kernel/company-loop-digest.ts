import { randomUUID } from 'crypto';

import type {
  BudgetLedgerEntry,
  CompanyLoopDigest,
  CompanyLoopRun,
  GrowthProposal,
  OperatingAgendaItem,
} from './contracts';

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildCompanyLoopDigest(input: {
  run: CompanyLoopRun;
  selectedAgenda: OperatingAgendaItem[];
  skipped: Array<{ item: OperatingAgendaItem; reason: string }>;
  budgetLedger: BudgetLedgerEntry[];
  generatedProposals: GrowthProposal[];
}): CompanyLoopDigest {
  const decisionsNeeded = input.selectedAgenda
    .filter((item) => item.recommendedAction === 'approve' || item.recommendedAction === 'ask_user')
    .map((item) => item.title);
  const risksBlocked = input.skipped
    .filter((entry) => entry.reason.includes('risk') || entry.reason.includes('Budget') || entry.reason.includes('blocked'))
    .map((entry) => `${entry.item.title}: ${entry.reason}`);
  const departmentHighlights = input.selectedAgenda
    .filter((item) => item.targetDepartmentId || item.workspaceUri)
    .slice(0, 5)
    .map((item) => `${item.targetDepartmentId || item.workspaceUri}: ${item.title}`);
  const capabilityGrowth = input.generatedProposals.map((proposal) => `${proposal.kind}: ${proposal.title}`);
  const budgetSummary = input.budgetLedger.map((entry) => [
    entry.scope,
    entry.scopeId || 'default',
    entry.decision,
    `${entry.tokens} tokens`,
    entry.reason || '',
  ].filter(Boolean).join(' · '));
  const dispatchCount = input.run.dispatchedRunIds.length;
  const skippedCount = input.skipped.length;
  const selectedCount = input.selectedAgenda.length;

  return {
    id: `company-loop-digest-${randomUUID()}`,
    loopRunId: input.run.id,
    date: input.run.date,
    title: `${input.run.date} ${input.run.kind}`,
    operatingSummary: [
      `Selected ${selectedCount} agenda items.`,
      `Dispatched ${dispatchCount}.`,
      `Skipped ${skippedCount}.`,
      input.generatedProposals.length > 0 ? `Generated ${input.generatedProposals.length} growth proposals.` : '',
    ].filter(Boolean).join(' '),
    decisionsNeeded,
    risksBlocked,
    departmentHighlights,
    capabilityGrowth,
    budgetSummary,
    linkedAgendaIds: uniqueStrings(input.selectedAgenda.map((item) => item.id)),
    linkedRunIds: uniqueStrings(input.run.dispatchedRunIds),
    linkedProposalIds: uniqueStrings(input.generatedProposals.map((proposal) => proposal.id)),
    createdAt: new Date().toISOString(),
  };
}
