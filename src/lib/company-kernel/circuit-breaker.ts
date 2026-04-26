import { getGatewayDb } from '../storage/gateway-db';
import type {
  BudgetScope,
  CircuitBreaker,
  CircuitBreakerStatus,
} from './contracts';
import { getOrCreateBudgetPolicy } from './budget-policy';

export interface CircuitBreakerListQuery {
  scope?: BudgetScope | 'provider' | 'workflow';
  scopeId?: string;
  status?: CircuitBreakerStatus | CircuitBreakerStatus[];
  limit?: number;
  offset?: number;
}

type CircuitBreakerRow = { payload_json: string };

function normalizeArrayFilter<T extends string>(value?: T | T[]): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hydrateCircuitBreaker(row: CircuitBreakerRow): CircuitBreaker {
  return JSON.parse(row.payload_json) as CircuitBreaker;
}

function addMinutesIso(baseIso: string, minutes: number): string {
  return new Date(new Date(baseIso).getTime() + Math.max(0, minutes) * 60 * 1000).toISOString();
}

export function circuitBreakerId(input: {
  scope: CircuitBreaker['scope'];
  scopeId: string;
}): string {
  return `breaker:${input.scope}:${input.scopeId}`;
}

export function buildCircuitBreaker(input: {
  scope: CircuitBreaker['scope'];
  scopeId: string;
  threshold?: number;
  coolDownMinutes?: number;
}): CircuitBreaker {
  return {
    id: circuitBreakerId(input),
    scope: input.scope,
    scopeId: input.scopeId,
    status: 'closed',
    failureCount: 0,
    threshold: input.threshold || 3,
    coolDownMinutes: input.coolDownMinutes || 30,
    updatedAt: new Date().toISOString(),
  };
}

function buildCircuitBreakerWhere(query: CircuitBreakerListQuery = {}): {
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
  const statuses = normalizeArrayFilter(query.status);
  if (statuses.length > 0) {
    const tokens = statuses.map((_, index) => `@status_${index}`);
    where.push(`status IN (${tokens.join(', ')})`);
    statuses.forEach((status, index) => {
      params[`status_${index}`] = status;
    });
  }
  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

export function upsertCircuitBreaker(breaker: CircuitBreaker): CircuitBreaker {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO circuit_breakers(
      breaker_id, scope, scope_id, status, updated_at, payload_json
    )
    VALUES (
      @breaker_id, @scope, @scope_id, @status, @updated_at, @payload_json
    )
    ON CONFLICT(breaker_id) DO UPDATE SET
      scope = excluded.scope,
      scope_id = excluded.scope_id,
      status = excluded.status,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run({
    breaker_id: breaker.id,
    scope: breaker.scope,
    scope_id: breaker.scopeId,
    status: breaker.status,
    updated_at: breaker.updatedAt,
    payload_json: JSON.stringify(breaker),
  });
  return breaker;
}

export function getCircuitBreaker(id: string): CircuitBreaker | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM circuit_breakers
    WHERE breaker_id = ?
    LIMIT 1
  `).get(id) as CircuitBreakerRow | undefined;
  return row ? refreshCircuitBreakerState(hydrateCircuitBreaker(row)) : null;
}

export function getOrCreateCircuitBreaker(input: {
  scope: CircuitBreaker['scope'];
  scopeId: string;
  threshold?: number;
  coolDownMinutes?: number;
}): CircuitBreaker {
  const id = circuitBreakerId(input);
  return getCircuitBreaker(id) || upsertCircuitBreaker(buildCircuitBreaker(input));
}

export function listCircuitBreakers(query: CircuitBreakerListQuery = {}): CircuitBreaker[] {
  refreshStoredCircuitBreakers();
  const db = getGatewayDb();
  const { whereSql, params } = buildCircuitBreakerWhere(query);
  const paginationSql = query.limit ? ' LIMIT @limit OFFSET @offset' : '';
  if (query.limit) {
    params.limit = Math.max(1, Math.trunc(query.limit));
    params.offset = Math.max(0, Math.trunc(query.offset || 0));
  }
  const rows = db.prepare(`
    SELECT payload_json
    FROM circuit_breakers
    ${whereSql}
    ORDER BY datetime(updated_at) DESC
    ${paginationSql}
  `).all(params) as CircuitBreakerRow[];
  return rows.map(hydrateCircuitBreaker);
}

export function countCircuitBreakers(query: CircuitBreakerListQuery = {}): number {
  refreshStoredCircuitBreakers();
  const db = getGatewayDb();
  const { whereSql, params } = buildCircuitBreakerWhere(query);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM circuit_breakers
    ${whereSql}
  `).get(params) as { count: number } | undefined;
  return row?.count || 0;
}

function coolDownElapsed(breaker: CircuitBreaker): boolean {
  const recoverAt = breaker.recoverAt || (breaker.openedAt ? addMinutesIso(breaker.openedAt, breaker.coolDownMinutes) : undefined);
  if (!recoverAt) return true;
  return Date.now() >= new Date(recoverAt).getTime();
}

export function isCircuitOpen(breaker: CircuitBreaker): boolean {
  if (breaker.status !== 'open') return false;
  return !coolDownElapsed(breaker);
}

export function refreshCircuitBreakerState(breaker: CircuitBreaker): CircuitBreaker {
  if (breaker.status !== 'open') return breaker;

  const openedAt = breaker.openedAt || breaker.updatedAt;
  const recoverAt = breaker.recoverAt || addMinutesIso(openedAt, breaker.coolDownMinutes);
  if (Date.now() < new Date(recoverAt).getTime()) {
    if (breaker.recoverAt) return breaker;
    return upsertCircuitBreaker({
      ...breaker,
      openedAt,
      recoverAt,
      updatedAt: new Date().toISOString(),
    });
  }

  return upsertCircuitBreaker({
    ...breaker,
    status: 'half-open',
    openedAt,
    recoverAt,
    reason: breaker.reason || 'Circuit breaker cooldown elapsed; probing half-open.',
    updatedAt: new Date().toISOString(),
  });
}

function refreshStoredCircuitBreakers(): void {
  const db = getGatewayDb();
  const rows = db.prepare(`
    SELECT payload_json
    FROM circuit_breakers
    WHERE status = 'open'
  `).all() as CircuitBreakerRow[];
  for (const row of rows) {
    refreshCircuitBreakerState(hydrateCircuitBreaker(row));
  }
}

export function recordCircuitFailure(input: {
  scope: CircuitBreaker['scope'];
  scopeId: string;
  reason: string;
  threshold?: number;
  coolDownMinutes?: number;
}): CircuitBreaker {
  const existing = getOrCreateCircuitBreaker(input);
  const now = new Date().toISOString();
  const threshold = input.threshold || existing.threshold;
  const coolDownMinutes = input.coolDownMinutes || existing.coolDownMinutes;
  const failureCount = existing.status === 'half-open'
    ? threshold
    : existing.failureCount + 1;
  const status: CircuitBreakerStatus = failureCount >= threshold ? 'open' : existing.status;
  return upsertCircuitBreaker({
    ...existing,
    failureCount,
    threshold,
    coolDownMinutes,
    status,
    lastFailureAt: now,
    ...(status === 'open'
      ? {
          openedAt: now,
          recoverAt: addMinutesIso(now, coolDownMinutes),
        }
      : {}),
    reason: input.reason,
    updatedAt: now,
  });
}

export function resetCircuitBreaker(id: string): CircuitBreaker | null {
  const existing = getCircuitBreaker(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  return upsertCircuitBreaker({
    ...existing,
    status: 'closed',
    failureCount: 0,
    resetAt: now,
    openedAt: undefined,
    recoverAt: undefined,
    reason: undefined,
    updatedAt: now,
  });
}

type RunBreakerInput = {
  runId: string;
  status: string;
  workspace?: string;
  provider?: string;
  resolvedWorkflowRef?: string;
  triggerContext?: {
    schedulerJobId?: string;
  };
  lastError?: string;
};

function failureBudgetFor(scope: BudgetScope, scopeId?: string): {
  threshold?: number;
  coolDownMinutes?: number;
} {
  const policy = getOrCreateBudgetPolicy({
    scope,
    ...(scopeId ? { scopeId } : {}),
  });
  return {
    threshold: policy.failureBudget?.maxConsecutiveFailures,
    coolDownMinutes: policy.failureBudget?.coolDownMinutes,
  };
}

function resetIfPresent(input: {
  scope: CircuitBreaker['scope'];
  scopeId?: string;
}): void {
  if (!input.scopeId) return;
  resetCircuitBreaker(circuitBreakerId({
    scope: input.scope,
    scopeId: input.scopeId,
  }));
}

function recordFailure(input: {
  scope: CircuitBreaker['scope'];
  scopeId?: string;
  reason: string;
  threshold?: number;
  coolDownMinutes?: number;
}): void {
  if (!input.scopeId) return;
  recordCircuitFailure({
    scope: input.scope,
    scopeId: input.scopeId,
    reason: input.reason,
    ...(input.threshold ? { threshold: input.threshold } : {}),
    ...(input.coolDownMinutes ? { coolDownMinutes: input.coolDownMinutes } : {}),
  });
}

export function recordRunTerminalForCircuitBreakers(run: RunBreakerInput): void {
  const failed = run.status === 'failed' || run.status === 'timeout' || run.status === 'blocked';
  const completed = run.status === 'completed';
  if (!failed && !completed) return;

  const departmentBudget = run.workspace ? failureBudgetFor('department', run.workspace) : {};
  const schedulerBudget = run.triggerContext?.schedulerJobId
    ? failureBudgetFor('scheduler-job', run.triggerContext.schedulerJobId)
    : {};
  const reason = run.lastError || `run ${run.status}: ${run.runId}`;
  const breakers = [
    {
      scope: 'department' as const,
      scopeId: run.workspace,
      ...departmentBudget,
    },
    {
      scope: 'scheduler-job' as const,
      scopeId: run.triggerContext?.schedulerJobId,
      ...schedulerBudget,
    },
    {
      scope: 'provider' as const,
      scopeId: run.provider,
    },
    {
      scope: 'workflow' as const,
      scopeId: run.resolvedWorkflowRef,
    },
  ];

  for (const breaker of breakers) {
    if (failed) {
      recordFailure({
        ...breaker,
        reason,
      });
    } else {
      resetIfPresent(breaker);
    }
  }
}
