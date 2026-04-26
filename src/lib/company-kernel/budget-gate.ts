import { randomUUID } from 'crypto';

import type {
  BudgetGateDecision,
  BudgetLedgerEntry,
  BudgetScope,
  EstimatedOperatingCost,
  OperatingAgendaItem,
} from './contracts';
import {
  getOrCreateBudgetPolicy,
} from './budget-policy';
import {
  listBudgetLedgerEntries,
  summarizeBudgetLedger,
  upsertBudgetLedgerEntry,
} from './budget-ledger-store';
import {
  getOrCreateCircuitBreaker,
  isCircuitOpen,
} from './circuit-breaker';

export interface BudgetGateInput {
  scope?: BudgetScope;
  scopeId?: string;
  schedulerJobId?: string;
  proposalId?: string;
  runId?: string;
  operationKind?: string;
}

export interface BudgetGateOperationInput {
  scope: BudgetScope;
  scopeId?: string;
  estimatedCost: EstimatedOperatingCost;
  dispatches?: number;
  schedulerJobId?: string;
  proposalId?: string;
  reason?: string;
  operationKind?: string;
  blockedDecision?: Extract<BudgetLedgerEntry['decision'], 'blocked' | 'skipped'>;
}

function periodStart(period: 'day' | 'week' | 'month', now = new Date()): string {
  const date = new Date(now);
  if (period === 'month') {
    date.setUTCDate(1);
  }
  if (period === 'week') {
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
  }
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function resolveBudgetScope(item: OperatingAgendaItem, input?: BudgetGateInput): {
  scope: BudgetScope;
  scopeId?: string;
} {
  if (input?.scope) {
    return {
      scope: input.scope,
      ...(input.scopeId ? { scopeId: input.scopeId } : {}),
    };
  }
  const departmentId = item.targetDepartmentId || item.workspaceUri;
  if (departmentId) {
    return {
      scope: 'department',
      scopeId: departmentId,
    };
  }
  return { scope: 'organization' };
}

export function checkBudgetForAgendaItem(
  item: OperatingAgendaItem,
  input?: BudgetGateInput,
): BudgetGateDecision {
  const scope = resolveBudgetScope(item, input);
  return checkBudgetForScope({
    scope: scope.scope,
    scopeId: scope.scopeId,
    requested: {
      tokens: item.estimatedCost.tokens,
      minutes: item.estimatedCost.minutes,
      dispatches: item.recommendedAction === 'dispatch' ? 1 : 0,
    },
    schedulerJobId: input?.schedulerJobId,
    proposalId: input?.proposalId,
    operationKind: input?.operationKind || `agenda.${item.recommendedAction}`,
  });
}

function checkBudgetForScope(input: {
  scope: BudgetScope;
  scopeId?: string;
  requested: EstimatedOperatingCost & { dispatches: number };
  schedulerJobId?: string;
  proposalId?: string;
  operationKind?: string;
}): BudgetGateDecision {
  const scope = {
    scope: input.scope,
    ...(input.scopeId ? { scopeId: input.scopeId } : {}),
  };
  const policy = getOrCreateBudgetPolicy(scope);
  const since = periodStart(policy.period);
  const entries = listBudgetLedgerEntries({
    policyId: policy.id,
    createdAfter: since,
    decision: ['reserved', 'committed', 'released'],
  });
  const usage = summarizeBudgetLedger(entries);
  const requested = input.requested;
  const operationKind = input.operationKind?.trim();
  const circuitBreakers = [
    ...(scope.scopeId ? [getOrCreateCircuitBreaker({
      scope: scope.scope,
      scopeId: scope.scopeId,
    })] : []),
    ...(input.schedulerJobId ? [getOrCreateCircuitBreaker({
      scope: 'scheduler-job',
      scopeId: input.schedulerJobId,
    })] : []),
    ...(input.proposalId ? [getOrCreateCircuitBreaker({
      scope: 'growth-proposal',
      scopeId: input.proposalId,
    })] : []),
  ];
  const openBreakers = circuitBreakers.filter(isCircuitOpen);

  const nextUsage = {
    tokens: usage.tokens + requested.tokens,
    minutes: usage.minutes + requested.minutes,
    dispatches: usage.dispatches + requested.dispatches,
  };
  const reasons: string[] = [];
  if (openBreakers.length > 0) {
    reasons.push(`Circuit breaker open: ${openBreakers.map((breaker) => breaker.id).join(', ')}`);
  }
  let cooldownBlocked = false;
  if (operationKind) {
    const cooldownMinutes = policy.cooldownMinutesByKind?.[operationKind] || 0;
    if (cooldownMinutes > 0) {
      const latestSameKind = entries
        .filter((entry) => entry.metadata?.operationKind === operationKind)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      if (latestSameKind) {
        const elapsedMs = Date.now() - new Date(latestSameKind.createdAt).getTime();
        const cooldownMs = cooldownMinutes * 60 * 1000;
        if (elapsedMs < cooldownMs) {
          cooldownBlocked = true;
          const remainingMinutes = Math.max(1, Math.ceil((cooldownMs - elapsedMs) / 60_000));
          reasons.push(`Cooldown not elapsed for ${operationKind}: ${remainingMinutes}m remaining`);
        }
      }
    }
  }
  if (nextUsage.tokens > policy.maxTokens) reasons.push(`Token budget exceeded: ${nextUsage.tokens}/${policy.maxTokens}`);
  if (nextUsage.minutes > policy.maxMinutes) reasons.push(`Time budget exceeded: ${nextUsage.minutes}/${policy.maxMinutes}`);
  if (nextUsage.dispatches > policy.maxDispatches) reasons.push(`Dispatch budget exceeded: ${nextUsage.dispatches}/${policy.maxDispatches}`);
  const terminalKeys = new Set(
    entries
      .filter((entry) => entry.decision === 'committed' || entry.decision === 'released')
      .map((entry) => [
        entry.policyId || '',
        entry.runId || '',
        entry.agendaItemId || '',
        entry.schedulerJobId || '',
        entry.proposalId || '',
      ].join(':')),
  );
  const activeReservations = entries.filter((entry) => {
    if (entry.decision !== 'reserved') return false;
    const key = [
      entry.policyId || '',
      entry.runId || '',
      entry.agendaItemId || '',
      entry.schedulerJobId || '',
      entry.proposalId || '',
    ].join(':');
    return !terminalKeys.has(key);
  }).length;
  if (policy.maxConcurrentRuns && activeReservations >= policy.maxConcurrentRuns) {
    reasons.push(`Concurrent run budget exceeded: ${activeReservations}/${policy.maxConcurrentRuns}`);
  }

  const tokenRatio = policy.maxTokens > 0 ? nextUsage.tokens / policy.maxTokens : 0;
  const minuteRatio = policy.maxMinutes > 0 ? nextUsage.minutes / policy.maxMinutes : 0;
  const dispatchRatio = policy.maxDispatches > 0 ? nextUsage.dispatches / policy.maxDispatches : 0;
  const nearLimit = Math.max(tokenRatio, minuteRatio, dispatchRatio) >= policy.warningThreshold;
  if (nearLimit && reasons.length === 0) {
    reasons.push(`Budget is near warning threshold ${policy.warningThreshold}.`);
  }

  const blocked = cooldownBlocked
    || openBreakers.length > 0
    || (policy.hardStop && reasons.some((reason) => reason.includes('exceeded')));
  return {
    id: `budget-gate-${randomUUID()}`,
    allowed: !blocked,
    decision: blocked ? 'block' : nearLimit ? 'warn' : 'allow',
    reasons,
    policy,
    usage,
    requested,
    circuitBreakers,
    createdAt: new Date().toISOString(),
  };
}

export function checkBudgetForOperation(input: BudgetGateOperationInput): BudgetGateDecision {
  return checkBudgetForScope({
    scope: input.scope,
    scopeId: input.scopeId,
    requested: {
      tokens: Math.max(0, Math.trunc(input.estimatedCost.tokens)),
      minutes: Math.max(0, Math.trunc(input.estimatedCost.minutes)),
      dispatches: Math.max(0, Math.trunc(input.dispatches ?? 0)),
    },
    schedulerJobId: input.schedulerJobId,
    proposalId: input.proposalId,
    operationKind: input.operationKind,
  });
}

export function recordBudgetForOperation(input: BudgetGateOperationInput): {
  decision: BudgetGateDecision;
  ledger: BudgetLedgerEntry;
} {
  const decision = checkBudgetForOperation(input);
  const ledger: BudgetLedgerEntry = {
    id: `budget-ledger-${randomUUID()}`,
    scope: decision.policy.scope,
    ...(decision.policy.scopeId ? { scopeId: decision.policy.scopeId } : {}),
    policyId: decision.policy.id,
    decision: decision.allowed ? 'committed' : input.blockedDecision || 'blocked',
    ...(input.schedulerJobId ? { schedulerJobId: input.schedulerJobId } : {}),
    ...(input.proposalId ? { proposalId: input.proposalId } : {}),
    tokens: decision.requested.tokens,
    minutes: decision.requested.minutes,
    dispatches: decision.requested.dispatches,
    reason: input.reason || decision.reasons.join('; ') || decision.decision,
    createdAt: new Date().toISOString(),
    metadata: {
      gateDecisionId: decision.id,
      gateDecision: decision.decision,
      ...(input.operationKind ? { operationKind: input.operationKind } : {}),
    },
  };
  return {
    decision,
    ledger: upsertBudgetLedgerEntry(ledger),
  };
}

export function reserveBudgetForOperation(input: BudgetGateOperationInput): {
  decision: BudgetGateDecision;
  ledger: BudgetLedgerEntry;
} {
  const decision = checkBudgetForOperation(input);
  const ledger: BudgetLedgerEntry = {
    id: `budget-ledger-${randomUUID()}`,
    scope: decision.policy.scope,
    ...(decision.policy.scopeId ? { scopeId: decision.policy.scopeId } : {}),
    policyId: decision.policy.id,
    decision: decision.allowed ? 'reserved' : input.blockedDecision || 'blocked',
    ...(input.schedulerJobId ? { schedulerJobId: input.schedulerJobId } : {}),
    ...(input.proposalId ? { proposalId: input.proposalId } : {}),
    tokens: decision.requested.tokens,
    minutes: decision.requested.minutes,
    dispatches: decision.requested.dispatches,
    reason: input.reason || decision.reasons.join('; ') || decision.decision,
    createdAt: new Date().toISOString(),
    metadata: {
      gateDecisionId: decision.id,
      gateDecision: decision.decision,
      ...(input.operationKind ? { operationKind: input.operationKind } : {}),
    },
  };
  return {
    decision,
    ledger: upsertBudgetLedgerEntry(ledger),
  };
}

export function reserveBudgetForAgendaItem(
  item: OperatingAgendaItem,
  input?: BudgetGateInput & {
    reason?: string;
    blockedDecision?: Extract<BudgetLedgerEntry['decision'], 'blocked' | 'skipped'>;
  },
): {
  decision: BudgetGateDecision;
  ledger: BudgetLedgerEntry;
} {
  const decision = checkBudgetForAgendaItem(item, input);
  const now = new Date().toISOString();
  const ledger: BudgetLedgerEntry = {
    id: `budget-ledger-${randomUUID()}`,
    scope: decision.policy.scope,
    ...(decision.policy.scopeId ? { scopeId: decision.policy.scopeId } : {}),
    policyId: decision.policy.id,
    decision: decision.allowed ? 'reserved' : input?.blockedDecision || 'blocked',
    agendaItemId: item.id,
    ...(input?.runId ? { runId: input.runId } : {}),
    ...(input?.schedulerJobId ? { schedulerJobId: input.schedulerJobId } : {}),
    ...(input?.proposalId ? { proposalId: input.proposalId } : {}),
    tokens: decision.requested.tokens,
    minutes: decision.requested.minutes,
    dispatches: decision.requested.dispatches,
    reason: input?.reason || decision.reasons.join('; ') || decision.decision,
    createdAt: now,
    metadata: {
      gateDecisionId: decision.id,
      gateDecision: decision.decision,
      operationKind: input?.operationKind || `agenda.${item.recommendedAction}`,
    },
  };
  return {
    decision,
    ledger: upsertBudgetLedgerEntry(ledger),
  };
}

export function attachRunToBudgetReservation(
  ledger: BudgetLedgerEntry,
  runId: string,
): BudgetLedgerEntry {
  return upsertBudgetLedgerEntry({
    ...ledger,
    runId,
    metadata: {
      ...(ledger.metadata || {}),
      runAttachedAt: new Date().toISOString(),
    },
  });
}

export function commitBudgetForRun(input: {
  agendaItemId?: string;
  runId: string;
  policyId?: string;
  scope?: BudgetScope;
  scopeId?: string;
  tokens?: number;
  minutes?: number;
  schedulerJobId?: string;
  proposalId?: string;
  reason?: string;
  dispatches?: number;
}): BudgetLedgerEntry {
  const scope = input.scope || (input.scopeId ? 'department' : 'organization');
  const policy = input.policyId
    ? undefined
    : getOrCreateBudgetPolicy({ scope, ...(input.scopeId ? { scopeId: input.scopeId } : {}) });
  return upsertBudgetLedgerEntry({
    id: `budget-ledger-${randomUUID()}`,
    scope,
    ...(input.scopeId ? { scopeId: input.scopeId } : {}),
    policyId: input.policyId || policy?.id,
    decision: 'committed',
    ...(input.agendaItemId ? { agendaItemId: input.agendaItemId } : {}),
    runId: input.runId,
    ...(input.schedulerJobId ? { schedulerJobId: input.schedulerJobId } : {}),
    ...(input.proposalId ? { proposalId: input.proposalId } : {}),
    tokens: Math.max(0, Math.trunc(input.tokens || 0)),
    minutes: Math.max(0, Math.trunc(input.minutes || 0)),
    dispatches: Math.max(0, Math.trunc(input.dispatches ?? 1)),
    reason: input.reason || 'run committed',
    createdAt: new Date().toISOString(),
  });
}

export function releaseBudgetForRun(input: {
  agendaItemId?: string;
  runId?: string;
  policyId?: string;
  scope?: BudgetScope;
  scopeId?: string;
  schedulerJobId?: string;
  proposalId?: string;
  reason?: string;
}): BudgetLedgerEntry {
  const scope = input.scope || (input.scopeId ? 'department' : 'organization');
  const policy = input.policyId
    ? undefined
    : getOrCreateBudgetPolicy({ scope, ...(input.scopeId ? { scopeId: input.scopeId } : {}) });
  return upsertBudgetLedgerEntry({
    id: `budget-ledger-${randomUUID()}`,
    scope,
    ...(input.scopeId ? { scopeId: input.scopeId } : {}),
    policyId: input.policyId || policy?.id,
    decision: 'released',
    ...(input.agendaItemId ? { agendaItemId: input.agendaItemId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.schedulerJobId ? { schedulerJobId: input.schedulerJobId } : {}),
    ...(input.proposalId ? { proposalId: input.proposalId } : {}),
    tokens: 0,
    minutes: 0,
    dispatches: 0,
    reason: input.reason || 'budget released',
    createdAt: new Date().toISOString(),
  });
}

export function finalizeBudgetForTerminalRun(input: {
  runId: string;
  status: string;
  tokens?: number;
  minutes?: number;
  reason?: string;
}): BudgetLedgerEntry[] {
  const reservations = listBudgetLedgerEntries({
    runId: input.runId,
    decision: 'reserved',
    limit: 50,
  });
  const finalized: BudgetLedgerEntry[] = [];
  for (const reservation of reservations) {
    const common = {
      agendaItemId: reservation.agendaItemId,
      runId: input.runId,
      policyId: reservation.policyId,
      scope: reservation.scope,
      scopeId: reservation.scopeId,
      schedulerJobId: reservation.schedulerJobId,
      proposalId: reservation.proposalId,
    };
    if (input.status === 'completed') {
      finalized.push(commitBudgetForRun({
        ...common,
        tokens: input.tokens ?? reservation.tokens,
        minutes: input.minutes ?? reservation.minutes,
        dispatches: reservation.dispatches,
        reason: input.reason || 'run completed',
      }));
    } else {
      finalized.push(releaseBudgetForRun({
        ...common,
        reason: input.reason || `run ${input.status}`,
      }));
    }
  }
  return finalized;
}
