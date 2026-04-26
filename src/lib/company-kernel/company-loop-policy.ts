import { getGatewayDb } from '../storage/gateway-db';
import type {
  CompanyLoopPolicy,
  CompanyLoopPolicyScope,
} from './contracts';

export interface CompanyLoopPolicyListQuery {
  scope?: CompanyLoopPolicyScope;
  scopeId?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

type CompanyLoopPolicyRow = { payload_json: string };

export function companyLoopPolicyId(input: {
  scope: CompanyLoopPolicyScope;
  scopeId?: string;
}): string {
  return input.scopeId
    ? `company-loop-policy:${input.scope}:${input.scopeId}`
    : `company-loop-policy:${input.scope}:default`;
}

export function buildDefaultCompanyLoopPolicy(input: {
  scope?: CompanyLoopPolicyScope;
  scopeId?: string;
  now?: string;
} = {}): CompanyLoopPolicy {
  const now = input.now || new Date().toISOString();
  const scope = input.scope || 'organization';
  return {
    id: companyLoopPolicyId({ scope, scopeId: input.scopeId }),
    scope,
    ...(input.scopeId ? { scopeId: input.scopeId } : {}),
    enabled: true,
    timezone: 'Asia/Shanghai',
    dailyReviewHour: 20,
    weeklyReviewDay: 5,
    weeklyReviewHour: 20,
    maxAgendaPerDailyLoop: 5,
    maxAutonomousDispatchesPerLoop: 1,
    allowedAgendaActions: ['observe', 'dispatch', 'snooze', 'dismiss'],
    growthReviewEnabled: true,
    notificationChannels: ['web'],
    createdAt: now,
    updatedAt: now,
  };
}

function hydrateCompanyLoopPolicy(row: CompanyLoopPolicyRow): CompanyLoopPolicy {
  return JSON.parse(row.payload_json) as CompanyLoopPolicy;
}

function buildCompanyLoopPolicyWhere(query: CompanyLoopPolicyListQuery = {}): {
  whereSql: string;
  params: Record<string, unknown>;
} {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.scope) {
    where.push('scope = @scope');
    params.scope = query.scope;
  }
  if (query.scopeId !== undefined) {
    where.push('COALESCE(scope_id, \'\') = @scope_id');
    params.scope_id = query.scopeId || '';
  }
  if (query.enabled !== undefined) {
    where.push('enabled = @enabled');
    params.enabled = query.enabled ? 1 : 0;
  }

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

export function upsertCompanyLoopPolicy(policy: CompanyLoopPolicy): CompanyLoopPolicy {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO company_loop_policies(
      policy_id, scope, scope_id, enabled, updated_at, payload_json
    )
    VALUES (
      @policy_id, @scope, @scope_id, @enabled, @updated_at, @payload_json
    )
    ON CONFLICT(policy_id) DO UPDATE SET
      scope = excluded.scope,
      scope_id = excluded.scope_id,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run({
    policy_id: policy.id,
    scope: policy.scope,
    scope_id: policy.scopeId || null,
    enabled: policy.enabled ? 1 : 0,
    updated_at: policy.updatedAt,
    payload_json: JSON.stringify(policy),
  });
  return policy;
}

export function getCompanyLoopPolicy(id: string): CompanyLoopPolicy | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM company_loop_policies
    WHERE policy_id = ?
    LIMIT 1
  `).get(id) as CompanyLoopPolicyRow | undefined;
  return row ? hydrateCompanyLoopPolicy(row) : null;
}

export function findCompanyLoopPolicy(input: {
  scope: CompanyLoopPolicyScope;
  scopeId?: string;
}): CompanyLoopPolicy | null {
  return listCompanyLoopPolicies({
    scope: input.scope,
    scopeId: input.scopeId || '',
    limit: 1,
  })[0] || null;
}

export function getOrCreateCompanyLoopPolicy(input: {
  scope?: CompanyLoopPolicyScope;
  scopeId?: string;
} = {}): CompanyLoopPolicy {
  const scope = input.scope || 'organization';
  const id = companyLoopPolicyId({ scope, scopeId: input.scopeId });
  const existing = getCompanyLoopPolicy(id);
  if (existing) return existing;
  return upsertCompanyLoopPolicy(buildDefaultCompanyLoopPolicy({
    scope,
    ...(input.scopeId ? { scopeId: input.scopeId } : {}),
  }));
}

export function countCompanyLoopPolicies(query: CompanyLoopPolicyListQuery = {}): number {
  const db = getGatewayDb();
  const { whereSql, params } = buildCompanyLoopPolicyWhere(query);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM company_loop_policies
    ${whereSql}
  `).get(params) as { count: number } | undefined;
  return row?.count || 0;
}

export function listCompanyLoopPolicies(query: CompanyLoopPolicyListQuery = {}): CompanyLoopPolicy[] {
  const db = getGatewayDb();
  const { whereSql, params } = buildCompanyLoopPolicyWhere(query);
  const paginationSql = query.limit ? ' LIMIT @limit OFFSET @offset' : '';
  if (query.limit) {
    params.limit = Math.max(1, Math.trunc(query.limit));
    params.offset = Math.max(0, Math.trunc(query.offset || 0));
  }

  const rows = db.prepare(`
    SELECT payload_json
    FROM company_loop_policies
    ${whereSql}
    ORDER BY datetime(updated_at) DESC
    ${paginationSql}
  `).all(params) as CompanyLoopPolicyRow[];
  return rows.map(hydrateCompanyLoopPolicy);
}

export function patchCompanyLoopPolicy(
  id: string,
  patch: Partial<Omit<CompanyLoopPolicy, 'id' | 'createdAt'>>,
): CompanyLoopPolicy | null {
  const existing = getCompanyLoopPolicy(id);
  if (!existing) return null;
  return upsertCompanyLoopPolicy({
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}
