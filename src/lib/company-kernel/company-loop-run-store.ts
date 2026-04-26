import { getGatewayDb } from '../storage/gateway-db';
import type {
  CompanyLoopDigest,
  CompanyLoopRun,
  CompanyLoopRunKind,
  CompanyLoopRunStatus,
} from './contracts';

export interface CompanyLoopRunListQuery {
  policyId?: string;
  kind?: CompanyLoopRunKind | CompanyLoopRunKind[];
  status?: CompanyLoopRunStatus | CompanyLoopRunStatus[];
  date?: string;
  limit?: number;
  offset?: number;
}

export interface CompanyLoopDigestListQuery {
  loopRunId?: string;
  date?: string;
  limit?: number;
  offset?: number;
}

type PayloadRow = { payload_json: string };

function normalizeArrayFilter<T extends string>(value?: T | T[]): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hydrateRun(row: PayloadRow): CompanyLoopRun {
  return JSON.parse(row.payload_json) as CompanyLoopRun;
}

function hydrateDigest(row: PayloadRow): CompanyLoopDigest {
  return JSON.parse(row.payload_json) as CompanyLoopDigest;
}

function buildRunWhere(query: CompanyLoopRunListQuery = {}): {
  whereSql: string;
  params: Record<string, unknown>;
} {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.policyId) {
    where.push('policy_id = @policy_id');
    params.policy_id = query.policyId;
  }
  if (query.date) {
    where.push('date = @date');
    params.date = query.date;
  }

  const kinds = normalizeArrayFilter(query.kind);
  if (kinds.length > 0) {
    const tokens = kinds.map((_, index) => `@kind_${index}`);
    where.push(`kind IN (${tokens.join(', ')})`);
    kinds.forEach((kind, index) => {
      params[`kind_${index}`] = kind;
    });
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

function buildDigestWhere(query: CompanyLoopDigestListQuery = {}): {
  whereSql: string;
  params: Record<string, unknown>;
} {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.loopRunId) {
    where.push('loop_run_id = @loop_run_id');
    params.loop_run_id = query.loopRunId;
  }
  if (query.date) {
    where.push('date = @date');
    params.date = query.date;
  }

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

export function upsertCompanyLoopRun(run: CompanyLoopRun): CompanyLoopRun {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO company_loop_runs(
      loop_run_id, policy_id, kind, status, date, started_at, finished_at, payload_json
    )
    VALUES (
      @loop_run_id, @policy_id, @kind, @status, @date, @started_at, @finished_at, @payload_json
    )
    ON CONFLICT(loop_run_id) DO UPDATE SET
      policy_id = excluded.policy_id,
      kind = excluded.kind,
      status = excluded.status,
      date = excluded.date,
      started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      payload_json = excluded.payload_json
  `).run({
    loop_run_id: run.id,
    policy_id: run.policyId,
    kind: run.kind,
    status: run.status,
    date: run.date,
    started_at: run.startedAt,
    finished_at: run.finishedAt || null,
    payload_json: JSON.stringify(run),
  });
  return run;
}

export function getCompanyLoopRun(id: string): CompanyLoopRun | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM company_loop_runs
    WHERE loop_run_id = ?
    LIMIT 1
  `).get(id) as PayloadRow | undefined;
  return row ? hydrateRun(row) : null;
}

export function countCompanyLoopRuns(query: CompanyLoopRunListQuery = {}): number {
  const db = getGatewayDb();
  const { whereSql, params } = buildRunWhere(query);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM company_loop_runs
    ${whereSql}
  `).get(params) as { count: number } | undefined;
  return row?.count || 0;
}

export function listCompanyLoopRuns(query: CompanyLoopRunListQuery = {}): CompanyLoopRun[] {
  const db = getGatewayDb();
  const { whereSql, params } = buildRunWhere(query);
  const paginationSql = query.limit ? ' LIMIT @limit OFFSET @offset' : '';
  if (query.limit) {
    params.limit = Math.max(1, Math.trunc(query.limit));
    params.offset = Math.max(0, Math.trunc(query.offset || 0));
  }

  const rows = db.prepare(`
    SELECT payload_json
    FROM company_loop_runs
    ${whereSql}
    ORDER BY datetime(started_at) DESC
    ${paginationSql}
  `).all(params) as PayloadRow[];
  return rows.map(hydrateRun);
}

export function patchCompanyLoopRun(
  id: string,
  patch: Partial<Omit<CompanyLoopRun, 'id' | 'policyId' | 'kind' | 'date' | 'timezone' | 'startedAt'>>,
): CompanyLoopRun | null {
  const existing = getCompanyLoopRun(id);
  if (!existing) return null;
  return upsertCompanyLoopRun({
    ...existing,
    ...patch,
  });
}

export function upsertCompanyLoopDigest(digest: CompanyLoopDigest): CompanyLoopDigest {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO company_loop_digests(
      digest_id, loop_run_id, date, created_at, payload_json
    )
    VALUES (
      @digest_id, @loop_run_id, @date, @created_at, @payload_json
    )
    ON CONFLICT(digest_id) DO UPDATE SET
      loop_run_id = excluded.loop_run_id,
      date = excluded.date,
      created_at = excluded.created_at,
      payload_json = excluded.payload_json
  `).run({
    digest_id: digest.id,
    loop_run_id: digest.loopRunId,
    date: digest.date,
    created_at: digest.createdAt,
    payload_json: JSON.stringify(digest),
  });
  return digest;
}

export function getCompanyLoopDigest(id: string): CompanyLoopDigest | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM company_loop_digests
    WHERE digest_id = ?
    LIMIT 1
  `).get(id) as PayloadRow | undefined;
  return row ? hydrateDigest(row) : null;
}

export function countCompanyLoopDigests(query: CompanyLoopDigestListQuery = {}): number {
  const db = getGatewayDb();
  const { whereSql, params } = buildDigestWhere(query);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM company_loop_digests
    ${whereSql}
  `).get(params) as { count: number } | undefined;
  return row?.count || 0;
}

export function listCompanyLoopDigests(query: CompanyLoopDigestListQuery = {}): CompanyLoopDigest[] {
  const db = getGatewayDb();
  const { whereSql, params } = buildDigestWhere(query);
  const paginationSql = query.limit ? ' LIMIT @limit OFFSET @offset' : '';
  if (query.limit) {
    params.limit = Math.max(1, Math.trunc(query.limit));
    params.offset = Math.max(0, Math.trunc(query.offset || 0));
  }

  const rows = db.prepare(`
    SELECT payload_json
    FROM company_loop_digests
    ${whereSql}
    ORDER BY datetime(created_at) DESC
    ${paginationSql}
  `).all(params) as PayloadRow[];
  return rows.map(hydrateDigest);
}
