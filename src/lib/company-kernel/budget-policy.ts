import { getGatewayDb } from '../storage/gateway-db';
import type {
  BudgetPeriod,
  BudgetScope,
  OperatingBudgetPolicy,
} from './contracts';

export interface BudgetPolicyListQuery {
  scope?: BudgetScope;
  scopeId?: string;
  period?: BudgetPeriod;
  limit?: number;
  offset?: number;
}

type BudgetPolicyRow = { payload_json: string };

function hydrateBudgetPolicy(row: BudgetPolicyRow): OperatingBudgetPolicy {
  return JSON.parse(row.payload_json) as OperatingBudgetPolicy;
}

export function budgetPolicyId(input: {
  scope: BudgetScope;
  scopeId?: string;
  period?: BudgetPeriod;
}): string {
  return `budget:${input.scope}:${input.scopeId || 'default'}:${input.period || 'day'}`;
}

export function buildDefaultBudgetPolicy(input?: {
  scope?: BudgetScope;
  scopeId?: string;
  period?: BudgetPeriod;
}): OperatingBudgetPolicy {
  const scope = input?.scope || 'organization';
  const period = input?.period || 'day';
  const now = new Date().toISOString();
  const multiplier = scope === 'organization' ? 1 : 0.25;
  return {
    id: budgetPolicyId({ scope, scopeId: input?.scopeId, period }),
    scope,
    ...(input?.scopeId ? { scopeId: input.scopeId } : {}),
    period,
    maxTokens: Math.round(1_000_000 * multiplier),
    maxMinutes: Math.round(480 * multiplier),
    maxDispatches: Math.max(5, Math.round(80 * multiplier)),
    maxConcurrentRuns: scope === 'organization' ? 12 : 3,
    cooldownMinutesByKind: {},
    failureBudget: {
      maxConsecutiveFailures: 3,
      coolDownMinutes: 30,
    },
    warningThreshold: 0.8,
    hardStop: true,
    createdAt: now,
    updatedAt: now,
    metadata: {
      source: 'company-kernel-default',
    },
  };
}

function buildBudgetPolicyWhere(query: BudgetPolicyListQuery = {}): {
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
  if (query.period) {
    where.push('period = @period');
    params.period = query.period;
  }
  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

export function upsertBudgetPolicy(policy: OperatingBudgetPolicy): OperatingBudgetPolicy {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO budget_policies(
      policy_id, scope, scope_id, period, created_at, updated_at, payload_json
    )
    VALUES (
      @policy_id, @scope, @scope_id, @period, @created_at, @updated_at, @payload_json
    )
    ON CONFLICT(policy_id) DO UPDATE SET
      scope = excluded.scope,
      scope_id = excluded.scope_id,
      period = excluded.period,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run({
    policy_id: policy.id,
    scope: policy.scope,
    scope_id: policy.scopeId || null,
    period: policy.period,
    created_at: policy.createdAt,
    updated_at: policy.updatedAt,
    payload_json: JSON.stringify(policy),
  });
  return policy;
}

export function getBudgetPolicy(id: string): OperatingBudgetPolicy | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM budget_policies
    WHERE policy_id = ?
    LIMIT 1
  `).get(id) as BudgetPolicyRow | undefined;
  return row ? hydrateBudgetPolicy(row) : null;
}

export function getOrCreateBudgetPolicy(input?: {
  scope?: BudgetScope;
  scopeId?: string;
  period?: BudgetPeriod;
}): OperatingBudgetPolicy {
  const scope = input?.scope || 'organization';
  const period = input?.period || 'day';
  const id = budgetPolicyId({
    scope,
    scopeId: input?.scopeId,
    period,
  });
  const existing = getBudgetPolicy(id);
  if (existing) return existing;

  if (scope === 'department' && input?.scopeId) {
    const defaultDepartmentPolicy = getBudgetPolicy(budgetPolicyId({
      scope: 'department',
      period,
    }));
    if (defaultDepartmentPolicy) {
      const now = new Date().toISOString();
      return upsertBudgetPolicy({
        ...defaultDepartmentPolicy,
        id,
        scope,
        scopeId: input.scopeId,
        createdAt: now,
        updatedAt: now,
        metadata: {
          ...(defaultDepartmentPolicy.metadata || {}),
          inheritedFrom: defaultDepartmentPolicy.id,
          inheritedAt: now,
        },
      });
    }
  }

  return upsertBudgetPolicy(buildDefaultBudgetPolicy(input));
}

export function countBudgetPolicies(query: BudgetPolicyListQuery = {}): number {
  const db = getGatewayDb();
  const { whereSql, params } = buildBudgetPolicyWhere(query);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM budget_policies
    ${whereSql}
  `).get(params) as { count: number } | undefined;
  return row?.count || 0;
}

export function listBudgetPolicies(query: BudgetPolicyListQuery = {}): OperatingBudgetPolicy[] {
  const db = getGatewayDb();
  const { whereSql, params } = buildBudgetPolicyWhere(query);
  const paginationSql = query.limit ? ' LIMIT @limit OFFSET @offset' : '';
  if (query.limit) {
    params.limit = Math.max(1, Math.trunc(query.limit));
    params.offset = Math.max(0, Math.trunc(query.offset || 0));
  }
  const rows = db.prepare(`
    SELECT payload_json
    FROM budget_policies
    ${whereSql}
    ORDER BY datetime(updated_at) DESC
    ${paginationSql}
  `).all(params) as BudgetPolicyRow[];
  return rows.map(hydrateBudgetPolicy);
}
