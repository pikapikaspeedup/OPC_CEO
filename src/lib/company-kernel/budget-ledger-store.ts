import { getGatewayDb } from '../storage/gateway-db';
import type {
  BudgetLedgerDecision,
  BudgetLedgerEntry,
  BudgetScope,
} from './contracts';

export interface BudgetLedgerListQuery {
  scope?: BudgetScope;
  scopeId?: string;
  policyId?: string;
  decision?: BudgetLedgerDecision | BudgetLedgerDecision[];
  agendaItemId?: string;
  runId?: string;
  schedulerJobId?: string;
  proposalId?: string;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  offset?: number;
}

type BudgetLedgerRow = { payload_json: string };

function normalizeArrayFilter<T extends string>(value?: T | T[]): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hydrateBudgetLedgerEntry(row: BudgetLedgerRow): BudgetLedgerEntry {
  return JSON.parse(row.payload_json) as BudgetLedgerEntry;
}

function buildBudgetLedgerWhere(query: BudgetLedgerListQuery = {}): {
  whereSql: string;
  params: Record<string, unknown>;
} {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.scope) {
    where.push('scope = @scope');
    params.scope = query.scope;
  }
  if (query.scopeId) {
    where.push('scope_id = @scope_id');
    params.scope_id = query.scopeId;
  }
  if (query.policyId) {
    where.push('policy_id = @policy_id');
    params.policy_id = query.policyId;
  }
  if (query.agendaItemId) {
    where.push('agenda_item_id = @agenda_item_id');
    params.agenda_item_id = query.agendaItemId;
  }
  if (query.runId) {
    where.push('run_id = @run_id');
    params.run_id = query.runId;
  }
  if (query.schedulerJobId) {
    where.push('scheduler_job_id = @scheduler_job_id');
    params.scheduler_job_id = query.schedulerJobId;
  }
  if (query.proposalId) {
    where.push('proposal_id = @proposal_id');
    params.proposal_id = query.proposalId;
  }
  if (query.createdAfter) {
    where.push('datetime(created_at) >= datetime(@created_after)');
    params.created_after = query.createdAfter;
  }
  if (query.createdBefore) {
    where.push('datetime(created_at) <= datetime(@created_before)');
    params.created_before = query.createdBefore;
  }

  const decisions = normalizeArrayFilter(query.decision);
  if (decisions.length > 0) {
    const tokens = decisions.map((_, index) => `@decision_${index}`);
    where.push(`decision IN (${tokens.join(', ')})`);
    decisions.forEach((decision, index) => {
      params[`decision_${index}`] = decision;
    });
  }

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

export function upsertBudgetLedgerEntry(entry: BudgetLedgerEntry): BudgetLedgerEntry {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO budget_ledger(
      ledger_id, scope, scope_id, policy_id, decision, agenda_item_id,
      run_id, scheduler_job_id, proposal_id, created_at, payload_json
    )
    VALUES (
      @ledger_id, @scope, @scope_id, @policy_id, @decision, @agenda_item_id,
      @run_id, @scheduler_job_id, @proposal_id, @created_at, @payload_json
    )
    ON CONFLICT(ledger_id) DO UPDATE SET
      scope = excluded.scope,
      scope_id = excluded.scope_id,
      policy_id = excluded.policy_id,
      decision = excluded.decision,
      agenda_item_id = excluded.agenda_item_id,
      run_id = excluded.run_id,
      scheduler_job_id = excluded.scheduler_job_id,
      proposal_id = excluded.proposal_id,
      created_at = excluded.created_at,
      payload_json = excluded.payload_json
  `).run({
    ledger_id: entry.id,
    scope: entry.scope,
    scope_id: entry.scopeId || null,
    policy_id: entry.policyId || null,
    decision: entry.decision,
    agenda_item_id: entry.agendaItemId || null,
    run_id: entry.runId || null,
    scheduler_job_id: entry.schedulerJobId || null,
    proposal_id: entry.proposalId || null,
    created_at: entry.createdAt,
    payload_json: JSON.stringify(entry),
  });
  return entry;
}

export function getBudgetLedgerEntry(id: string): BudgetLedgerEntry | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM budget_ledger
    WHERE ledger_id = ?
    LIMIT 1
  `).get(id) as BudgetLedgerRow | undefined;
  return row ? hydrateBudgetLedgerEntry(row) : null;
}

export function countBudgetLedgerEntries(query: BudgetLedgerListQuery = {}): number {
  const db = getGatewayDb();
  const { whereSql, params } = buildBudgetLedgerWhere(query);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM budget_ledger
    ${whereSql}
  `).get(params) as { count: number } | undefined;
  return row?.count || 0;
}

export function listBudgetLedgerEntries(query: BudgetLedgerListQuery = {}): BudgetLedgerEntry[] {
  const db = getGatewayDb();
  const { whereSql, params } = buildBudgetLedgerWhere(query);
  const paginationSql = query.limit ? ' LIMIT @limit OFFSET @offset' : '';
  if (query.limit) {
    params.limit = Math.max(1, Math.trunc(query.limit));
    params.offset = Math.max(0, Math.trunc(query.offset || 0));
  }

  const rows = db.prepare(`
    SELECT payload_json
    FROM budget_ledger
    ${whereSql}
    ORDER BY datetime(created_at) DESC
    ${paginationSql}
  `).all(params) as BudgetLedgerRow[];
  return rows.map(hydrateBudgetLedgerEntry);
}

export function summarizeBudgetLedger(entries: BudgetLedgerEntry[]): {
  tokens: number;
  minutes: number;
  dispatches: number;
} {
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

  return entries.reduce((total, entry) => {
    const key = [
      entry.policyId || '',
      entry.runId || '',
      entry.agendaItemId || '',
      entry.schedulerJobId || '',
      entry.proposalId || '',
    ].join(':');
    if (
      entry.decision === 'released'
      || entry.decision === 'blocked'
      || entry.decision === 'skipped'
      || (entry.decision === 'reserved' && terminalKeys.has(key))
    ) {
      return total;
    }
    return {
      tokens: total.tokens + entry.tokens,
      minutes: total.minutes + entry.minutes,
      dispatches: total.dispatches + entry.dispatches,
    };
  }, { tokens: 0, minutes: 0, dispatches: 0 });
}
