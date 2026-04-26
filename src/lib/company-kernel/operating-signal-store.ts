import { getGatewayDb } from '../storage/gateway-db';
import type {
  OperatingSignal,
  OperatingSignalKind,
  OperatingSignalSource,
  OperatingSignalStatus,
} from './contracts';

export interface OperatingSignalListQuery {
  workspaceUri?: string;
  source?: OperatingSignalSource | OperatingSignalSource[];
  kind?: OperatingSignalKind | OperatingSignalKind[];
  status?: OperatingSignalStatus | OperatingSignalStatus[];
  minScore?: number;
  limit?: number;
  offset?: number;
}

type OperatingSignalRow = { payload_json: string };

function normalizeArrayFilter<T extends string>(value?: T | T[]): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hydrateOperatingSignal(row: OperatingSignalRow): OperatingSignal {
  return JSON.parse(row.payload_json) as OperatingSignal;
}

function buildOperatingSignalWhere(query: OperatingSignalListQuery = {}): {
  whereSql: string;
  params: Record<string, unknown>;
} {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.workspaceUri) {
    where.push('workspace = @workspace');
    params.workspace = query.workspaceUri;
  }
  if (query.minScore !== undefined) {
    where.push('score >= @min_score');
    params.min_score = query.minScore;
  }

  const sources = normalizeArrayFilter(query.source);
  if (sources.length > 0) {
    const tokens = sources.map((_, index) => `@source_${index}`);
    where.push(`source IN (${tokens.join(', ')})`);
    sources.forEach((source, index) => {
      params[`source_${index}`] = source;
    });
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

export function findOperatingSignalByDedupeKey(dedupeKey: string): OperatingSignal | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM operating_signals
    WHERE dedupe_key = ?
    LIMIT 1
  `).get(dedupeKey) as OperatingSignalRow | undefined;
  return row ? hydrateOperatingSignal(row) : null;
}

export function upsertOperatingSignal(signal: OperatingSignal): OperatingSignal {
  const db = getGatewayDb();
  const existing = findOperatingSignalByDedupeKey(signal.dedupeKey);
  const nextSignal: OperatingSignal = existing
    ? {
      ...signal,
      id: existing.id,
      status: existing.status === 'dismissed' ? 'dismissed' : signal.status,
      createdAt: existing.createdAt,
    }
    : signal;

  db.prepare(`
    INSERT INTO operating_signals(
      signal_id, source, kind, workspace, dedupe_key, status, score,
      created_at, updated_at, payload_json
    )
    VALUES (
      @signal_id, @source, @kind, @workspace, @dedupe_key, @status, @score,
      @created_at, @updated_at, @payload_json
    )
    ON CONFLICT(signal_id) DO UPDATE SET
      source = excluded.source,
      kind = excluded.kind,
      workspace = excluded.workspace,
      dedupe_key = excluded.dedupe_key,
      status = excluded.status,
      score = excluded.score,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run({
    signal_id: nextSignal.id,
    source: nextSignal.source,
    kind: nextSignal.kind,
    workspace: nextSignal.workspaceUri || null,
    dedupe_key: nextSignal.dedupeKey,
    status: nextSignal.status,
    score: nextSignal.score,
    created_at: nextSignal.createdAt,
    updated_at: nextSignal.updatedAt,
    payload_json: JSON.stringify(nextSignal),
  });
  return nextSignal;
}

export function getOperatingSignal(id: string): OperatingSignal | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM operating_signals
    WHERE signal_id = ?
    LIMIT 1
  `).get(id) as OperatingSignalRow | undefined;
  return row ? hydrateOperatingSignal(row) : null;
}

export function countOperatingSignals(query: OperatingSignalListQuery = {}): number {
  const db = getGatewayDb();
  const { whereSql, params } = buildOperatingSignalWhere(query);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM operating_signals
    ${whereSql}
  `).get(params) as { count: number } | undefined;
  return row?.count || 0;
}

export function listOperatingSignals(query: OperatingSignalListQuery = {}): OperatingSignal[] {
  const db = getGatewayDb();
  const { whereSql, params } = buildOperatingSignalWhere(query);
  const paginationSql = query.limit ? ' LIMIT @limit OFFSET @offset' : '';
  if (query.limit) {
    params.limit = Math.max(1, Math.trunc(query.limit));
    params.offset = Math.max(0, Math.trunc(query.offset || 0));
  }

  const rows = db.prepare(`
    SELECT payload_json
    FROM operating_signals
    ${whereSql}
    ORDER BY score DESC, datetime(updated_at) DESC
    ${paginationSql}
  `).all(params) as OperatingSignalRow[];
  return rows.map(hydrateOperatingSignal);
}

export function updateOperatingSignalStatus(
  id: string,
  status: OperatingSignalStatus,
  patch: Partial<OperatingSignal> = {},
): OperatingSignal | null {
  const existing = getOperatingSignal(id);
  if (!existing) return null;
  const updated: OperatingSignal = {
    ...existing,
    ...patch,
    status,
    updatedAt: new Date().toISOString(),
  };
  return upsertOperatingSignal(updated);
}
