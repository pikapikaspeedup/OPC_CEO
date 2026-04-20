import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

import { GATEWAY_HOME } from '../agents/gateway-home';
import type { ProjectDefinition } from '../agents/project-types';
import type { AgentRunState, ArtifactRef, RunStatus } from '../agents/group-types';
import type { ScheduledJob } from '../agents/scheduler-types';
import type { LocalProviderId } from '../local-provider-conversations';
import type { Deliverable } from '../types';

export interface LocalConversationRecord {
  id: string;
  title: string;
  workspace: string;
  stepCount: number;
  createdAt?: string;
  provider?: LocalProviderId;
  sessionHandle?: string;
}

const DB_FILE = path.join(GATEWAY_HOME, 'storage.sqlite');
const SCHEMA_VERSION = 1;

export interface RunRecordFilter {
  status?: RunStatus;
  stageId?: string;
  reviewOutcome?: string;
  projectId?: string;
  executorKind?: string;
  schedulerJobId?: string;
}

const globalForGatewayDb = globalThis as unknown as {
  __AG_GATEWAY_DB__?: Database.Database;
};

function initSchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      workspace TEXT,
      status TEXT NOT NULL,
      parent_project_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace);
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    CREATE INDEX IF NOT EXISTS idx_projects_parent_project_id ON projects(parent_project_id);

    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      project_id TEXT,
      workspace TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      pipeline_stage_id TEXT,
      pipeline_stage_index INTEGER,
      status TEXT NOT NULL,
      provider TEXT,
      executor_kind TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_runs_project_id ON runs(project_id);
    CREATE INDEX IF NOT EXISTS idx_runs_workspace ON runs(workspace);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_provider ON runs(provider);
    CREATE INDEX IF NOT EXISTS idx_runs_executor_kind ON runs(executor_kind);
    CREATE INDEX IF NOT EXISTS idx_runs_pipeline_stage_id ON runs(pipeline_stage_id);

    CREATE TABLE IF NOT EXISTS conversation_sessions (
      conversation_id TEXT PRIMARY KEY,
      workspace TEXT,
      title TEXT NOT NULL,
      step_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_sessions_workspace ON conversation_sessions(workspace);

    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      job_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      department_workspace_uri TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_type ON scheduled_jobs(type);
    CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_enabled ON scheduled_jobs(enabled);
    CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_department_workspace_uri ON scheduled_jobs(department_workspace_uri);

    CREATE TABLE IF NOT EXISTS deliverables (
      deliverable_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      source_run_id TEXT,
      artifact_path TEXT,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_deliverables_project_id ON deliverables(project_id);
    CREATE INDEX IF NOT EXISTS idx_deliverables_stage_id ON deliverables(stage_id);
    CREATE INDEX IF NOT EXISTS idx_deliverables_source_run_id ON deliverables(source_run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_deliverables_unique_auto
      ON deliverables(project_id, source_run_id, artifact_path)
      WHERE source_run_id IS NOT NULL AND artifact_path IS NOT NULL;

    CREATE TABLE IF NOT EXISTS knowledge_assets (
      knowledge_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      workspace TEXT,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_assets_workspace ON knowledge_assets(workspace);
    CREATE INDEX IF NOT EXISTS idx_knowledge_assets_category ON knowledge_assets(category);
    CREATE INDEX IF NOT EXISTS idx_knowledge_assets_status ON knowledge_assets(status);
    CREATE INDEX IF NOT EXISTS idx_knowledge_assets_updated_at ON knowledge_assets(updated_at);

    CREATE TABLE IF NOT EXISTS evolution_proposals (
      proposal_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      workspace TEXT,
      status TEXT NOT NULL,
      target_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_evolution_proposals_kind ON evolution_proposals(kind);
    CREATE INDEX IF NOT EXISTS idx_evolution_proposals_workspace ON evolution_proposals(workspace);
    CREATE INDEX IF NOT EXISTS idx_evolution_proposals_status ON evolution_proposals(status);
    CREATE INDEX IF NOT EXISTS idx_evolution_proposals_target_name ON evolution_proposals(target_name);
    CREATE INDEX IF NOT EXISTS idx_evolution_proposals_updated_at ON evolution_proposals(updated_at);
  `);

  db.prepare(`
    INSERT INTO storage_meta(key, value)
    VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(SCHEMA_VERSION));
}

export function getGatewayDb(): Database.Database {
  if (globalForGatewayDb.__AG_GATEWAY_DB__) {
    return globalForGatewayDb.__AG_GATEWAY_DB__;
  }

  if (!existsSync(GATEWAY_HOME)) {
    mkdirSync(GATEWAY_HOME, { recursive: true });
  }

  const db = new Database(DB_FILE);
  initSchema(db);
  globalForGatewayDb.__AG_GATEWAY_DB__ = db;
  return db;
}

export function upsertProjectRecord(project: ProjectDefinition): void {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO projects(project_id, workspace, status, parent_project_id, created_at, updated_at, payload_json)
    VALUES (@project_id, @workspace, @status, @parent_project_id, @created_at, @updated_at, @payload_json)
    ON CONFLICT(project_id) DO UPDATE SET
      workspace = excluded.workspace,
      status = excluded.status,
      parent_project_id = excluded.parent_project_id,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run({
    project_id: project.projectId,
    workspace: project.workspace || null,
    status: project.status,
    parent_project_id: project.parentProjectId || null,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
    payload_json: JSON.stringify(project),
  });
}

export function listProjectRecords(): ProjectDefinition[] {
  const db = getGatewayDb();
  const rows = db.prepare(`
    SELECT payload_json
    FROM projects
    ORDER BY datetime(created_at) DESC
  `).all() as Array<{ payload_json: string }>;

  return rows.map((row) => JSON.parse(row.payload_json) as ProjectDefinition);
}

export function getProjectRecord(projectId: string): ProjectDefinition | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM projects
    WHERE project_id = ?
    LIMIT 1
  `).get(projectId) as { payload_json: string } | undefined;

  return row ? (JSON.parse(row.payload_json) as ProjectDefinition) : null;
}

export function upsertRunRecord(run: AgentRunState): void {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO runs(
      run_id, project_id, workspace, stage_id, pipeline_stage_id, pipeline_stage_index,
      status, provider, executor_kind, created_at, started_at, finished_at, payload_json
    )
    VALUES (
      @run_id, @project_id, @workspace, @stage_id, @pipeline_stage_id, @pipeline_stage_index,
      @status, @provider, @executor_kind, @created_at, @started_at, @finished_at, @payload_json
    )
    ON CONFLICT(run_id) DO UPDATE SET
      project_id = excluded.project_id,
      workspace = excluded.workspace,
      stage_id = excluded.stage_id,
      pipeline_stage_id = excluded.pipeline_stage_id,
      pipeline_stage_index = excluded.pipeline_stage_index,
      status = excluded.status,
      provider = excluded.provider,
      executor_kind = excluded.executor_kind,
      created_at = excluded.created_at,
      started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      payload_json = excluded.payload_json
  `).run({
    run_id: run.runId,
    project_id: run.projectId || null,
    workspace: run.workspace,
    stage_id: run.stageId,
    pipeline_stage_id: run.pipelineStageId || null,
    pipeline_stage_index: run.pipelineStageIndex ?? null,
    status: run.status,
    provider: run.provider || null,
    executor_kind: run.executorKind || null,
    created_at: run.createdAt,
    started_at: run.startedAt || null,
    finished_at: run.finishedAt || null,
    payload_json: JSON.stringify(run),
  });
}

export function listRunRecords(): AgentRunState[] {
  const db = getGatewayDb();
  const rows = db.prepare(`
    SELECT payload_json
    FROM runs
    ORDER BY datetime(created_at) DESC
  `).all() as Array<{ payload_json: string }>;

  return rows.map((row) => JSON.parse(row.payload_json) as AgentRunState);
}

export function getRunRecord(runId: string): AgentRunState | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM runs
    WHERE run_id = ?
    LIMIT 1
  `).get(runId) as { payload_json: string } | undefined;

  return row ? (JSON.parse(row.payload_json) as AgentRunState) : null;
}

export function listRunRecordsByIds(runIds: string[]): AgentRunState[] {
  if (runIds.length === 0) {
    return [];
  }

  const db = getGatewayDb();
  const placeholders = runIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT payload_json
    FROM runs
    WHERE run_id IN (${placeholders})
  `).all(...runIds) as Array<{ payload_json: string }>;

  return rows.map((row) => JSON.parse(row.payload_json) as AgentRunState);
}

export function listRunRecordsByFilter(filter?: RunRecordFilter): AgentRunState[] {
  const db = getGatewayDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter?.status) {
    where.push('status = ?');
    params.push(filter.status);
  }

  if (filter?.stageId) {
    where.push('(pipeline_stage_id = ? OR stage_id = ?)');
    params.push(filter.stageId, filter.stageId);
  }

  if (filter?.reviewOutcome) {
    where.push(`json_extract(payload_json, '$.reviewOutcome') = ?`);
    params.push(filter.reviewOutcome);
  }

  if (filter?.projectId) {
    where.push('project_id = ?');
    params.push(filter.projectId);
  }

  if (filter?.executorKind) {
    where.push('executor_kind = ?');
    params.push(filter.executorKind);
  }

  if (filter?.schedulerJobId) {
    where.push(`json_extract(payload_json, '$.triggerContext.schedulerJobId') = ?`);
    params.push(filter.schedulerJobId);
  }

  const rows = db.prepare(`
    SELECT payload_json
    FROM runs
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY datetime(created_at) DESC
  `).all(...params) as Array<{ payload_json: string }>;

  return rows.map((row) => JSON.parse(row.payload_json) as AgentRunState);
}

export function listRunRecordsByProject(projectId: string): AgentRunState[] {
  const db = getGatewayDb();
  const rows = db.prepare(`
    SELECT payload_json
    FROM runs
    WHERE project_id = ?
    ORDER BY datetime(created_at) DESC
  `).all(projectId) as Array<{ payload_json: string }>;

  return rows.map((row) => JSON.parse(row.payload_json) as AgentRunState);
}

function buildInClause(values: string[]): { clause: string; params: string[] } {
  return {
    clause: values.map(() => '?').join(', '),
    params: values,
  };
}

export function findRunRecordByConversationRef(input: {
  conversationIds?: string[];
  sessionHandles?: string[];
}): AgentRunState | null {
  const conversationIds = Array.from(new Set((input.conversationIds || []).filter(Boolean)));
  const sessionHandles = Array.from(new Set((input.sessionHandles || []).filter(Boolean)));
  if (conversationIds.length === 0 && sessionHandles.length === 0) {
    return null;
  }

  const db = getGatewayDb();
  const where: string[] = [];
  const params: string[] = [];

  if (sessionHandles.length > 0) {
    const { clause, params: handleParams } = buildInClause(sessionHandles);
    where.push(`json_extract(payload_json, '$.sessionProvenance.handle') IN (${clause})`);
    params.push(...handleParams);
  }

  if (conversationIds.length > 0) {
    const { clause, params: conversationParams } = buildInClause(conversationIds);
    where.push(`json_extract(payload_json, '$.childConversationId') IN (${clause})`);
    params.push(...conversationParams);

    where.push(`
      EXISTS (
        SELECT 1
        FROM json_each(runs.payload_json, '$.roles') AS role
        WHERE json_extract(role.value, '$.childConversationId') IN (${clause})
      )
    `);
    params.push(...conversationParams);
  }

  const row = db.prepare(`
    SELECT payload_json
    FROM runs
    WHERE ${where.join(' OR ')}
    ORDER BY datetime(created_at) DESC
    LIMIT 1
  `).get(...params) as { payload_json: string } | undefined;

  return row ? (JSON.parse(row.payload_json) as AgentRunState) : null;
}

export function listChildConversationIdsFromRuns(): string[] {
  const db = getGatewayDb();
  const rows = db.prepare(`
    SELECT child_id
    FROM (
      SELECT json_extract(payload_json, '$.childConversationId') AS child_id
      FROM runs
      WHERE json_extract(payload_json, '$.childConversationId') IS NOT NULL

      UNION

      SELECT json_extract(role.value, '$.childConversationId') AS child_id
      FROM runs, json_each(runs.payload_json, '$.roles') AS role
      WHERE json_extract(role.value, '$.childConversationId') IS NOT NULL
    )
  `).all() as Array<{ child_id: string | null }>;

  return rows
    .map((row) => row.child_id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}

export function upsertConversationRecord(record: LocalConversationRecord): void {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO conversation_sessions(conversation_id, workspace, title, step_count, created_at, payload_json)
    VALUES (@conversation_id, @workspace, @title, @step_count, @created_at, @payload_json)
    ON CONFLICT(conversation_id) DO UPDATE SET
      workspace = excluded.workspace,
      title = excluded.title,
      step_count = excluded.step_count,
      created_at = excluded.created_at,
      payload_json = excluded.payload_json
  `).run({
    conversation_id: record.id,
    workspace: record.workspace || null,
    title: record.title,
    step_count: record.stepCount,
    created_at: record.createdAt || null,
    payload_json: JSON.stringify(record),
  });
}

export function listConversationRecords(): LocalConversationRecord[] {
  const db = getGatewayDb();
  const rows = db.prepare(`
    SELECT payload_json
    FROM conversation_sessions
    ORDER BY datetime(COALESCE(created_at, '1970-01-01T00:00:00.000Z')) DESC
  `).all() as Array<{ payload_json: string }>;

  return rows.map((row) => JSON.parse(row.payload_json) as LocalConversationRecord);
}

export function getConversationRecordById(conversationId: string): LocalConversationRecord | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM conversation_sessions
    WHERE conversation_id = ?
    LIMIT 1
  `).get(conversationId) as { payload_json: string } | undefined;

  return row ? (JSON.parse(row.payload_json) as LocalConversationRecord) : null;
}

export function findConversationRecordBySessionHandle(sessionHandle: string): LocalConversationRecord | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM conversation_sessions
    WHERE json_extract(payload_json, '$.sessionHandle') = ?
    ORDER BY datetime(COALESCE(created_at, '1970-01-01T00:00:00.000Z')) DESC
    LIMIT 1
  `).get(sessionHandle) as { payload_json: string } | undefined;

  return row ? (JSON.parse(row.payload_json) as LocalConversationRecord) : null;
}

export function upsertScheduledJobRecord(job: ScheduledJob): void {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO scheduled_jobs(job_id, type, enabled, created_at, department_workspace_uri, payload_json)
    VALUES (@job_id, @type, @enabled, @created_at, @department_workspace_uri, @payload_json)
    ON CONFLICT(job_id) DO UPDATE SET
      type = excluded.type,
      enabled = excluded.enabled,
      created_at = excluded.created_at,
      department_workspace_uri = excluded.department_workspace_uri,
      payload_json = excluded.payload_json
  `).run({
    job_id: job.jobId,
    type: job.type,
    enabled: job.enabled ? 1 : 0,
    created_at: job.createdAt,
    department_workspace_uri: job.departmentWorkspaceUri || null,
    payload_json: JSON.stringify(job),
  });
}

export function listScheduledJobRecords(): ScheduledJob[] {
  const db = getGatewayDb();
  const rows = db.prepare(`
    SELECT payload_json
    FROM scheduled_jobs
    ORDER BY datetime(created_at) ASC
  `).all() as Array<{ payload_json: string }>;

  return rows.map((row) => JSON.parse(row.payload_json) as ScheduledJob);
}

export function getGatewayDbPath(): string {
  return DB_FILE;
}

function deriveDeliverableType(artifact: ArtifactRef): Deliverable['type'] {
  if (artifact.kind.startsWith('review')) return 'review';
  if (artifact.format === 'json') return 'data';
  if (artifact.kind.startsWith('delivery') || artifact.kind.startsWith('architecture') || artifact.kind.startsWith('product')) {
    return 'document';
  }
  return 'document';
}

export function upsertDeliverableRecord(deliverable: Deliverable & { sourceRunId?: string }): void {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO deliverables(deliverable_id, project_id, stage_id, source_run_id, artifact_path, created_at, payload_json)
    VALUES (@deliverable_id, @project_id, @stage_id, @source_run_id, @artifact_path, @created_at, @payload_json)
    ON CONFLICT(deliverable_id) DO UPDATE SET
      project_id = excluded.project_id,
      stage_id = excluded.stage_id,
      source_run_id = excluded.source_run_id,
      artifact_path = excluded.artifact_path,
      created_at = excluded.created_at,
      payload_json = excluded.payload_json
  `).run({
    deliverable_id: deliverable.id,
    project_id: deliverable.projectId,
    stage_id: deliverable.stageId,
    source_run_id: deliverable.sourceRunId || null,
    artifact_path: deliverable.artifactPath || null,
    created_at: deliverable.createdAt,
    payload_json: JSON.stringify(deliverable),
  });
}

export function listDeliverableRecordsByProject(projectId: string): Deliverable[] {
  const db = getGatewayDb();
  const rows = db.prepare(`
    SELECT payload_json
    FROM deliverables
    WHERE project_id = ?
    ORDER BY datetime(created_at) DESC
  `).all(projectId) as Array<{ payload_json: string }>;

  return rows.map((row) => JSON.parse(row.payload_json) as Deliverable);
}

export function syncRunArtifactsToDeliverables(run: AgentRunState): void {
  if (!run.projectId || !run.resultEnvelope?.outputArtifacts?.length) return;

  for (const artifact of run.resultEnvelope.outputArtifacts) {
    const deliverable: Deliverable & { sourceRunId?: string } = {
      id: `${run.runId}:${artifact.path}`,
      projectId: run.projectId,
      stageId: run.pipelineStageId || run.stageId,
      type: deriveDeliverableType(artifact),
      title: artifact.title,
      artifactPath: artifact.path,
      createdAt: run.finishedAt || run.createdAt,
      quality: {},
      sourceRunId: run.runId,
    };
    upsertDeliverableRecord(deliverable);
  }
}

export function syncProjectRunArtifactsToDeliverables(projectId: string): void {
  const runs = listRunRecordsByProject(projectId);
  for (const run of runs) {
    syncRunArtifactsToDeliverables(run);
  }
}
