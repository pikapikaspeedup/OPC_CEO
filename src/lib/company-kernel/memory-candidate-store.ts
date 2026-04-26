import { getGatewayDb } from '../storage/gateway-db';
import type { MemoryCandidate, MemoryCandidateKind, MemoryCandidateStatus } from './contracts';

export interface MemoryCandidateListQuery {
  workspaceUri?: string;
  sourceRunId?: string;
  sourceCapsuleId?: string;
  kind?: MemoryCandidateKind | MemoryCandidateKind[];
  status?: MemoryCandidateStatus | MemoryCandidateStatus[];
  minScore?: number;
  limit?: number;
  offset?: number;
}

type MemoryCandidateRow = { payload_json: string };

function isClosedStatus(status: MemoryCandidateStatus): boolean {
  return status === 'auto-promoted'
    || status === 'promoted'
    || status === 'rejected'
    || status === 'archived';
}

function normalizeArrayFilter<T extends string>(value?: T | T[]): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hydrateMemoryCandidate(row: MemoryCandidateRow): MemoryCandidate {
  return JSON.parse(row.payload_json) as MemoryCandidate;
}

function buildMemoryCandidateWhere(query: MemoryCandidateListQuery = {}): {
  whereSql: string;
  params: Record<string, unknown>;
} {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.workspaceUri) {
    where.push('workspace = @workspace');
    params.workspace = query.workspaceUri;
  }
  if (query.sourceRunId) {
    where.push('source_run_id = @source_run_id');
    params.source_run_id = query.sourceRunId;
  }
  if (query.sourceCapsuleId) {
    where.push('source_capsule_id = @source_capsule_id');
    params.source_capsule_id = query.sourceCapsuleId;
  }
  if (query.minScore !== undefined) {
    where.push('score >= @min_score');
    params.min_score = query.minScore;
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

export function upsertMemoryCandidate(candidate: MemoryCandidate): MemoryCandidate {
  const db = getGatewayDb();
  const existing = getMemoryCandidate(candidate.id);
  const nextCandidate = existing && isClosedStatus(existing.status)
    ? {
      ...candidate,
      status: existing.status,
      promotedKnowledgeId: existing.promotedKnowledgeId,
      rejectedReason: existing.rejectedReason,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    }
    : candidate;

  db.prepare(`
    INSERT INTO memory_candidates(
      candidate_id, workspace, source_run_id, source_capsule_id, kind,
      status, score, created_at, updated_at, payload_json
    )
    VALUES (
      @candidate_id, @workspace, @source_run_id, @source_capsule_id, @kind,
      @status, @score, @created_at, @updated_at, @payload_json
    )
    ON CONFLICT(candidate_id) DO UPDATE SET
      workspace = excluded.workspace,
      source_run_id = excluded.source_run_id,
      source_capsule_id = excluded.source_capsule_id,
      kind = excluded.kind,
      status = excluded.status,
      score = excluded.score,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run({
    candidate_id: nextCandidate.id,
    workspace: nextCandidate.workspaceUri || null,
    source_run_id: nextCandidate.sourceRunId,
    source_capsule_id: nextCandidate.sourceCapsuleId,
    kind: nextCandidate.kind,
    status: nextCandidate.status,
    score: nextCandidate.score.total,
    created_at: nextCandidate.createdAt,
    updated_at: nextCandidate.updatedAt,
    payload_json: JSON.stringify(nextCandidate),
  });
  return nextCandidate;
}

export function getMemoryCandidate(id: string): MemoryCandidate | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM memory_candidates
    WHERE candidate_id = ?
    LIMIT 1
  `).get(id) as MemoryCandidateRow | undefined;
  return row ? hydrateMemoryCandidate(row) : null;
}

export function countMemoryCandidates(query: MemoryCandidateListQuery = {}): number {
  const db = getGatewayDb();
  const { whereSql, params } = buildMemoryCandidateWhere(query);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM memory_candidates
    ${whereSql}
  `).get(params) as { count: number } | undefined;
  return row?.count || 0;
}

export function listMemoryCandidates(query: MemoryCandidateListQuery = {}): MemoryCandidate[] {
  const db = getGatewayDb();
  const { whereSql, params } = buildMemoryCandidateWhere(query);
  const paginationSql = query.limit ? ' LIMIT @limit OFFSET @offset' : '';
  if (query.limit) {
    params.limit = Math.max(1, Math.trunc(query.limit));
    params.offset = Math.max(0, Math.trunc(query.offset || 0));
  }

  const rows = db.prepare(`
    SELECT payload_json
    FROM memory_candidates
    ${whereSql}
    ORDER BY score DESC, datetime(updated_at) DESC
    ${paginationSql}
  `).all(params) as MemoryCandidateRow[];
  return rows.map(hydrateMemoryCandidate);
}

export function updateMemoryCandidateStatus(
  id: string,
  status: MemoryCandidateStatus,
  patch: Partial<MemoryCandidate> = {},
): MemoryCandidate | null {
  const existing = getMemoryCandidate(id);
  if (!existing) return null;
  const updated: MemoryCandidate = {
    ...existing,
    ...patch,
    status,
    updatedAt: new Date().toISOString(),
  };
  return upsertMemoryCandidate(updated);
}
