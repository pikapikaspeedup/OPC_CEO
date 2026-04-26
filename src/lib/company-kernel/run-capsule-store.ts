import { getGatewayDb } from '../storage/gateway-db';
import type { AgentRunState, RunStatus } from '../agents/group-types';
import type { EvidenceRef, RunCapsule, WorkingCheckpointKind } from './contracts';
import { buildRunCapsuleFromRun } from './run-capsule';
import { buildWorkingCheckpoint, mergeCheckpoints } from './working-checkpoint';

export interface RunCapsuleListQuery {
  workspaceUri?: string;
  projectId?: string;
  status?: RunStatus | RunStatus[];
  providerId?: string;
  limit?: number;
  offset?: number;
}

type RunCapsuleRow = { payload_json: string };

function occurredAtForCheckpoint(run: AgentRunState, kind: WorkingCheckpointKind): string {
  if (kind === 'run-created') return run.createdAt;
  if (kind === 'run-started') return run.startedAt || run.createdAt;
  if (kind === 'conversation-attached') {
    return run.sessionProvenance?.recordedAt || run.startedAt || run.createdAt;
  }
  if (
    kind === 'artifact-discovered'
    || kind === 'result-discovered'
    || kind === 'verification-discovered'
    || kind === 'run-completed'
    || kind === 'run-blocked'
    || kind === 'run-failed'
    || kind === 'run-cancelled'
  ) {
    return run.finishedAt || run.startedAt || run.createdAt;
  }
  return run.finishedAt || run.startedAt || run.createdAt;
}

function normalizeArrayFilter<T extends string>(value?: T | T[]): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function buildRunCapsuleWhere(query: RunCapsuleListQuery = {}): {
  whereSql: string;
  params: Record<string, unknown>;
} {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.workspaceUri) {
    where.push('workspace = @workspace');
    params.workspace = query.workspaceUri;
  }
  if (query.projectId) {
    where.push('project_id = @project_id');
    params.project_id = query.projectId;
  }
  if (query.providerId) {
    where.push('provider = @provider');
    params.provider = query.providerId;
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

function hydrateRunCapsule(row: RunCapsuleRow): RunCapsule {
  return JSON.parse(row.payload_json) as RunCapsule;
}

export function upsertRunCapsule(capsule: RunCapsule): RunCapsule {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO run_capsules(
      capsule_id, run_id, workspace, project_id, status, provider,
      created_at, updated_at, finished_at, payload_json
    )
    VALUES (
      @capsule_id, @run_id, @workspace, @project_id, @status, @provider,
      @created_at, @updated_at, @finished_at, @payload_json
    )
    ON CONFLICT(run_id) DO UPDATE SET
      capsule_id = excluded.capsule_id,
      workspace = excluded.workspace,
      project_id = excluded.project_id,
      status = excluded.status,
      provider = excluded.provider,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      finished_at = excluded.finished_at,
      payload_json = excluded.payload_json
  `).run({
    capsule_id: capsule.capsuleId,
    run_id: capsule.runId,
    workspace: capsule.workspaceUri,
    project_id: capsule.projectId || null,
    status: capsule.status,
    provider: capsule.providerId || null,
    created_at: capsule.createdAt,
    updated_at: capsule.updatedAt,
    finished_at: capsule.finishedAt || null,
    payload_json: JSON.stringify(capsule),
  });
  return capsule;
}

export function getRunCapsuleByRunId(runId: string): RunCapsule | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM run_capsules
    WHERE run_id = ?
    LIMIT 1
  `).get(runId) as RunCapsuleRow | undefined;
  return row ? hydrateRunCapsule(row) : null;
}

export function getRunCapsule(id: string): RunCapsule | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM run_capsules
    WHERE capsule_id = ? OR run_id = ?
    LIMIT 1
  `).get(id, id) as RunCapsuleRow | undefined;
  return row ? hydrateRunCapsule(row) : null;
}

export function countRunCapsules(query: RunCapsuleListQuery = {}): number {
  const db = getGatewayDb();
  const { whereSql, params } = buildRunCapsuleWhere(query);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM run_capsules
    ${whereSql}
  `).get(params) as { count: number } | undefined;
  return row?.count || 0;
}

export function listRunCapsules(query: RunCapsuleListQuery = {}): RunCapsule[] {
  const db = getGatewayDb();
  const { whereSql, params } = buildRunCapsuleWhere(query);
  const paginationSql = query.limit ? ' LIMIT @limit OFFSET @offset' : '';
  if (query.limit) {
    params.limit = Math.max(1, Math.trunc(query.limit));
    params.offset = Math.max(0, Math.trunc(query.offset || 0));
  }

  const rows = db.prepare(`
    SELECT payload_json
    FROM run_capsules
    ${whereSql}
    ORDER BY datetime(updated_at) DESC
    ${paginationSql}
  `).all(params) as RunCapsuleRow[];
  return rows.map(hydrateRunCapsule);
}

export function rebuildRunCapsuleFromRun(run: AgentRunState): RunCapsule {
  const existing = getRunCapsuleByRunId(run.runId);
  return upsertRunCapsule(buildRunCapsuleFromRun(run, existing));
}

export function appendWorkingCheckpoint(input: {
  run: AgentRunState;
  kind: WorkingCheckpointKind;
  summary: string;
  evidenceRefs?: EvidenceRef[];
  metadata?: Record<string, unknown>;
}): RunCapsule {
  const existing = getRunCapsuleByRunId(input.run.runId);
  const base = buildRunCapsuleFromRun(input.run, existing);
  const checkpoint = buildWorkingCheckpoint({
    runId: input.run.runId,
    kind: input.kind,
    summary: input.summary,
    occurredAt: occurredAtForCheckpoint(input.run, input.kind),
    ...(input.evidenceRefs ? { evidenceRefs: input.evidenceRefs } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });

  return upsertRunCapsule({
    ...base,
    checkpoints: mergeCheckpoints(base.checkpoints, [checkpoint]),
    updatedAt: new Date().toISOString(),
  });
}
