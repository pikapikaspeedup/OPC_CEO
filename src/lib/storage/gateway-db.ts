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

export interface ConversationProjectionRecord extends LocalConversationRecord {
  updatedAt: string;
  lastActivityAt?: string;
  visibility: 'visible' | 'hidden';
  sourceKind: string;
  primaryRunId?: string;
  isLocalOnly: boolean;
  mtimeMs?: number;
}

export interface ConversationOwnerCacheRecord {
  conversationId: string;
  backendId: string;
  ownerKind: string;
  endpoint: string;
  workspace?: string;
  stepCount: number;
  lastSeenAt: string;
  expiresAt?: string;
  payload: Record<string, unknown>;
}

const DB_FILE = path.join(GATEWAY_HOME, 'storage.sqlite');
const SCHEMA_VERSION = 2;

export interface RunRecordFilter {
  status?: RunStatus;
  stageId?: string;
  reviewOutcome?: string;
  projectId?: string;
  executorKind?: string;
  schedulerJobId?: string;
}

export interface DbPaginationWindow {
  limit: number;
  offset: number;
}

const globalForGatewayDb = globalThis as unknown as {
  __AG_GATEWAY_DB__?: Database.Database;
};

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

function encodeConversationOwnerCache(record: ConversationOwnerCacheRecord): string {
  return JSON.stringify(record.payload || {});
}

function decodeConversationOwnerCache(row: {
  conversation_id: string;
  backend_id: string;
  owner_kind: string;
  endpoint: string;
  workspace: string | null;
  step_count: number;
  last_seen_at: string;
  expires_at: string | null;
  payload_json: string;
}): ConversationOwnerCacheRecord {
  return {
    conversationId: row.conversation_id,
    backendId: row.backend_id,
    ownerKind: row.owner_kind,
    endpoint: row.endpoint,
    workspace: row.workspace || undefined,
    stepCount: row.step_count,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at || undefined,
    payload: row.payload_json ? JSON.parse(row.payload_json) as Record<string, unknown> : {},
  };
}

function readConversationProjectionRow(row: {
  payload_json: string;
  visibility?: string | null;
}): ConversationProjectionRecord {
  const parsed = JSON.parse(row.payload_json) as ConversationProjectionRecord;
  return {
    ...parsed,
    visibility: (row.visibility as ConversationProjectionRecord['visibility']) || parsed.visibility || 'visible',
    isLocalOnly: Boolean(parsed.isLocalOnly),
  };
}

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

    CREATE TABLE IF NOT EXISTS conversations (
      conversation_id TEXT PRIMARY KEY,
      provider TEXT,
      workspace TEXT,
      title TEXT NOT NULL,
      step_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT NOT NULL,
      last_activity_at TEXT,
      visibility TEXT NOT NULL DEFAULT 'visible',
      source_kind TEXT NOT NULL,
      session_handle TEXT,
      primary_run_id TEXT,
      is_local_only INTEGER NOT NULL DEFAULT 0,
      mtime_ms INTEGER,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace);
    CREATE INDEX IF NOT EXISTS idx_conversations_visibility ON conversations(visibility);
    CREATE INDEX IF NOT EXISTS idx_conversations_last_activity_at ON conversations(last_activity_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_session_handle ON conversations(session_handle);
    CREATE INDEX IF NOT EXISTS idx_conversations_primary_run_id ON conversations(primary_run_id);

    CREATE TABLE IF NOT EXISTS run_conversation_links (
      link_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      conversation_id TEXT,
      session_handle TEXT,
      relation_kind TEXT NOT NULL,
      role_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_run_conversation_links_run_id ON run_conversation_links(run_id);
    CREATE INDEX IF NOT EXISTS idx_run_conversation_links_conversation_id ON run_conversation_links(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_run_conversation_links_session_handle ON run_conversation_links(session_handle);
    CREATE INDEX IF NOT EXISTS idx_run_conversation_links_relation_kind ON run_conversation_links(relation_kind);

    CREATE TABLE IF NOT EXISTS conversation_visibility (
      conversation_id TEXT PRIMARY KEY,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      hidden_reason TEXT,
      source_run_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_visibility_hidden ON conversation_visibility(is_hidden);
    CREATE INDEX IF NOT EXISTS idx_conversation_visibility_source_run_id ON conversation_visibility(source_run_id);

    CREATE TABLE IF NOT EXISTS conversation_owner_cache (
      conversation_id TEXT PRIMARY KEY,
      backend_id TEXT NOT NULL,
      owner_kind TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      workspace TEXT,
      step_count INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_owner_cache_expires_at ON conversation_owner_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_conversation_owner_cache_last_seen_at ON conversation_owner_cache(last_seen_at);

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

  ensureColumn(db, 'runs', 'updated_at', 'updated_at TEXT');
  ensureColumn(db, 'runs', 'session_handle', 'session_handle TEXT');
  ensureColumn(db, 'runs', 'child_conversation_id', 'child_conversation_id TEXT');
  ensureColumn(db, 'runs', 'review_outcome', 'review_outcome TEXT');
  ensureColumn(db, 'runs', 'scheduler_job_id', 'scheduler_job_id TEXT');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_runs_updated_at ON runs(updated_at);
    CREATE INDEX IF NOT EXISTS idx_runs_session_handle ON runs(session_handle);
    CREATE INDEX IF NOT EXISTS idx_runs_child_conversation_id ON runs(child_conversation_id);
    CREATE INDEX IF NOT EXISTS idx_runs_review_outcome ON runs(review_outcome);
    CREATE INDEX IF NOT EXISTS idx_runs_scheduler_job_id ON runs(scheduler_job_id);
  `);

  ensureColumn(db, 'projects', 'template_id', 'template_id TEXT');
  ensureColumn(db, 'projects', 'pipeline_status', 'pipeline_status TEXT');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_projects_template_id ON projects(template_id);
    CREATE INDEX IF NOT EXISTS idx_projects_pipeline_status ON projects(pipeline_status);
  `);

  db.exec(`
    UPDATE runs
    SET
      updated_at = COALESCE(updated_at, finished_at, started_at, created_at),
      session_handle = COALESCE(session_handle, json_extract(payload_json, '$.sessionProvenance.handle')),
      child_conversation_id = COALESCE(child_conversation_id, json_extract(payload_json, '$.childConversationId')),
      review_outcome = COALESCE(review_outcome, json_extract(payload_json, '$.reviewOutcome')),
      scheduler_job_id = COALESCE(scheduler_job_id, json_extract(payload_json, '$.triggerContext.schedulerJobId'))
  `);

  db.exec(`
    UPDATE projects
    SET
      template_id = COALESCE(template_id, json_extract(payload_json, '$.templateId'), json_extract(payload_json, '$.pipelineState.templateId')),
      pipeline_status = COALESCE(pipeline_status, json_extract(payload_json, '$.pipelineState.status'))
  `);

  db.exec(`
    INSERT OR IGNORE INTO conversations(
      conversation_id, provider, workspace, title, step_count, created_at,
      updated_at, last_activity_at, visibility, source_kind, session_handle,
      primary_run_id, is_local_only, mtime_ms, payload_json
    )
    SELECT
      conversation_id,
      json_extract(payload_json, '$.provider'),
      workspace,
      title,
      step_count,
      created_at,
      COALESCE(created_at, datetime('now')),
      created_at,
      'visible',
      CASE
        WHEN json_extract(payload_json, '$.provider') IS NOT NULL THEN 'local-provider'
        ELSE 'local-cache'
      END,
      json_extract(payload_json, '$.sessionHandle'),
      NULL,
      CASE
        WHEN json_extract(payload_json, '$.provider') IS NOT NULL THEN 1
        ELSE 0
      END,
      NULL,
      json_object(
        'id', conversation_id,
        'title', title,
        'workspace', COALESCE(workspace, ''),
        'stepCount', step_count,
        'createdAt', created_at,
        'provider', json_extract(payload_json, '$.provider'),
        'sessionHandle', json_extract(payload_json, '$.sessionHandle'),
        'updatedAt', COALESCE(created_at, datetime('now')),
        'lastActivityAt', created_at,
        'visibility', 'visible',
        'sourceKind', CASE
          WHEN json_extract(payload_json, '$.provider') IS NOT NULL THEN 'local-provider'
          ELSE 'local-cache'
        END,
        'isLocalOnly', CASE
          WHEN json_extract(payload_json, '$.provider') IS NOT NULL THEN 1
          ELSE 0
        END
      )
    FROM conversation_sessions
  `);

  db.exec(`DELETE FROM run_conversation_links`);
  db.exec(`
    INSERT OR REPLACE INTO run_conversation_links(link_id, run_id, conversation_id, session_handle, relation_kind, role_id, created_at)
    SELECT
      run_id || ':child:' || child_conversation_id,
      run_id,
      child_conversation_id,
      session_handle,
      'child',
      NULL,
      created_at
    FROM runs
    WHERE child_conversation_id IS NOT NULL
  `);
  db.exec(`
    INSERT OR REPLACE INTO run_conversation_links(link_id, run_id, conversation_id, session_handle, relation_kind, role_id, created_at)
    SELECT
      run_id || ':session:' || session_handle,
      run_id,
      NULL,
      session_handle,
      'session-handle',
      NULL,
      created_at
    FROM runs
    WHERE session_handle IS NOT NULL
  `);
  db.exec(`
    INSERT OR REPLACE INTO run_conversation_links(link_id, run_id, conversation_id, session_handle, relation_kind, role_id, created_at)
    SELECT
      runs.run_id || ':role:' || COALESCE(json_extract(role.value, '$.roleId'), 'unknown') || ':' || json_extract(role.value, '$.childConversationId'),
      runs.run_id,
      json_extract(role.value, '$.childConversationId'),
      runs.session_handle,
      'role',
      json_extract(role.value, '$.roleId'),
      runs.created_at
    FROM runs, json_each(runs.payload_json, '$.roles') AS role
    WHERE json_extract(role.value, '$.childConversationId') IS NOT NULL
  `);

  const visibilityUpdatedAt = new Date().toISOString();
  db.prepare(`DELETE FROM conversation_visibility WHERE hidden_reason = 'run-link'`).run();
  db.prepare(`
    INSERT OR REPLACE INTO conversation_visibility(conversation_id, is_hidden, hidden_reason, source_run_id, updated_at)
    SELECT
      conversation_id,
      1,
      'run-link',
      MIN(run_id),
      ?
    FROM run_conversation_links
    WHERE relation_kind IN ('child', 'role') AND conversation_id IS NOT NULL
    GROUP BY conversation_id
  `).run(visibilityUpdatedAt);

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
    INSERT INTO projects(project_id, workspace, status, parent_project_id, created_at, updated_at, template_id, pipeline_status, payload_json)
    VALUES (@project_id, @workspace, @status, @parent_project_id, @created_at, @updated_at, @template_id, @pipeline_status, @payload_json)
    ON CONFLICT(project_id) DO UPDATE SET
      workspace = excluded.workspace,
      status = excluded.status,
      parent_project_id = excluded.parent_project_id,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      template_id = excluded.template_id,
      pipeline_status = excluded.pipeline_status,
      payload_json = excluded.payload_json
  `).run({
    project_id: project.projectId,
    workspace: project.workspace || null,
    status: project.status,
    parent_project_id: project.parentProjectId || null,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
    template_id: project.templateId || project.pipelineState?.templateId || null,
    pipeline_status: project.pipelineState?.status || null,
    payload_json: JSON.stringify(project),
  });
}

export function deleteProjectRecord(projectId: string): void {
  const db = getGatewayDb();
  db.prepare(`DELETE FROM projects WHERE project_id = ?`).run(projectId);
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
  const updatedAt = run.finishedAt || run.startedAt || new Date().toISOString();
  db.prepare(`
    INSERT INTO runs(
      run_id, project_id, workspace, stage_id, pipeline_stage_id, pipeline_stage_index,
      status, provider, executor_kind, created_at, started_at, finished_at,
      updated_at, session_handle, child_conversation_id, review_outcome, scheduler_job_id, payload_json
    )
    VALUES (
      @run_id, @project_id, @workspace, @stage_id, @pipeline_stage_id, @pipeline_stage_index,
      @status, @provider, @executor_kind, @created_at, @started_at, @finished_at,
      @updated_at, @session_handle, @child_conversation_id, @review_outcome, @scheduler_job_id, @payload_json
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
      updated_at = excluded.updated_at,
      session_handle = excluded.session_handle,
      child_conversation_id = excluded.child_conversation_id,
      review_outcome = excluded.review_outcome,
      scheduler_job_id = excluded.scheduler_job_id,
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
    updated_at: updatedAt,
    session_handle: run.sessionProvenance?.handle || null,
    child_conversation_id: run.childConversationId || null,
    review_outcome: run.reviewOutcome || null,
    scheduler_job_id: run.triggerContext?.schedulerJobId || null,
    payload_json: JSON.stringify(run),
  });

  const linkInsert = db.prepare(`
    INSERT OR REPLACE INTO run_conversation_links(link_id, run_id, conversation_id, session_handle, relation_kind, role_id, created_at)
    VALUES (@link_id, @run_id, @conversation_id, @session_handle, @relation_kind, @role_id, @created_at)
  `);
  const clearLinks = db.prepare(`DELETE FROM run_conversation_links WHERE run_id = ?`);
  clearLinks.run(run.runId);

  const createdAt = run.createdAt;
  const sessionHandle = run.sessionProvenance?.handle || null;
  const addLink = (input: {
    conversationId?: string | null;
    sessionHandle?: string | null;
    relationKind: string;
    roleId?: string | null;
  }) => {
    if (!input.conversationId && !input.sessionHandle) {
      return;
    }
    const linkId = [
      run.runId,
      input.relationKind,
      input.roleId || '',
      input.conversationId || '',
      input.sessionHandle || '',
    ].join(':');
    linkInsert.run({
      link_id: linkId,
      run_id: run.runId,
      conversation_id: input.conversationId || null,
      session_handle: input.sessionHandle || null,
      relation_kind: input.relationKind,
      role_id: input.roleId || null,
      created_at: createdAt,
    });
  };

  addLink({ conversationId: run.activeConversationId || null, sessionHandle, relationKind: 'primary' });
  addLink({ conversationId: run.childConversationId || null, sessionHandle, relationKind: 'child' });
  addLink({ sessionHandle, relationKind: 'session-handle' });
  if (run.supervisorConversationId) {
    addLink({ conversationId: run.supervisorConversationId, sessionHandle, relationKind: 'supervisor' });
  }
  for (const role of run.roles || []) {
    addLink({
      conversationId: role.childConversationId || null,
      sessionHandle,
      relationKind: 'role',
      roleId: role.roleId,
    });
  }

  db.prepare(`DELETE FROM conversation_visibility WHERE hidden_reason = 'run-link'`).run();
  db.prepare(`
    INSERT OR REPLACE INTO conversation_visibility(conversation_id, is_hidden, hidden_reason, source_run_id, updated_at)
    SELECT
      conversation_id,
      1,
      'run-link',
      MIN(run_id),
      ?
    FROM run_conversation_links
    WHERE relation_kind IN ('child', 'role') AND conversation_id IS NOT NULL
    GROUP BY conversation_id
  `).run(new Date().toISOString());
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

function buildRunRecordFilterClause(filter?: RunRecordFilter): {
  whereSql: string;
  params: unknown[];
} {
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
    where.push('review_outcome = ?');
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
    where.push('scheduler_job_id = ?');
    params.push(filter.schedulerJobId);
  }

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

export function countRunRecordsByFilter(filter?: RunRecordFilter): number {
  const db = getGatewayDb();
  const { whereSql, params } = buildRunRecordFilterClause(filter);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM runs
    ${whereSql}
  `).get(...params) as { count: number } | undefined;

  return row?.count || 0;
}

export function listRunRecordsByFilter(
  filter?: RunRecordFilter,
  pagination?: DbPaginationWindow,
): AgentRunState[] {
  const db = getGatewayDb();
  const { whereSql, params } = buildRunRecordFilterClause(filter);
  const paginationSql = pagination ? ' LIMIT ? OFFSET ?' : '';
  const paginationParams = pagination ? [pagination.limit, pagination.offset] : [];

  const rows = db.prepare(`
    SELECT payload_json
    FROM runs
    ${whereSql}
    ORDER BY datetime(created_at) DESC
    ${paginationSql}
  `).all(...params, ...paginationParams) as Array<{ payload_json: string }>;

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

  if (conversationIds.length > 0) {
    const { clause, params: conversationParams } = buildInClause(conversationIds);
    where.push(`run_conversation_links.conversation_id IN (${clause})`);
    params.push(...conversationParams);
  }

  if (sessionHandles.length > 0) {
    const { clause, params: handleParams } = buildInClause(sessionHandles);
    where.push(`run_conversation_links.session_handle IN (${clause})`);
    params.push(...handleParams);
  }

  const linkRow = db.prepare(`
    SELECT runs.payload_json
    FROM run_conversation_links
    JOIN runs ON runs.run_id = run_conversation_links.run_id
    WHERE ${where.join(' OR ')}
    ORDER BY datetime(runs.created_at) DESC
    LIMIT 1
  `).get(...params) as { payload_json: string } | undefined;

  if (linkRow) {
    return JSON.parse(linkRow.payload_json) as AgentRunState;
  }

  const legacyWhere: string[] = [];
  const legacyParams: string[] = [];
  if (sessionHandles.length > 0) {
    const { clause, params: handleParams } = buildInClause(sessionHandles);
    legacyWhere.push(`session_handle IN (${clause})`);
    legacyParams.push(...handleParams);
  }
  if (conversationIds.length > 0) {
    const { clause, params: conversationParams } = buildInClause(conversationIds);
    legacyWhere.push(`child_conversation_id IN (${clause})`);
    legacyParams.push(...conversationParams);
  }

  const row = db.prepare(`
    SELECT payload_json
    FROM runs
    WHERE ${legacyWhere.join(' OR ')}
    ORDER BY datetime(created_at) DESC
    LIMIT 1
  `).get(...legacyParams) as { payload_json: string } | undefined;

  return row ? (JSON.parse(row.payload_json) as AgentRunState) : null;
}

export function listChildConversationIdsFromRuns(): string[] {
  const db = getGatewayDb();
  const rows = db.prepare(`
    SELECT conversation_id AS child_id
    FROM conversation_visibility
    WHERE is_hidden = 1
  `).all() as Array<{ child_id: string | null }>;

  return rows
    .map((row) => row.child_id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function normalizeConversationProjectionInput(
  input: Partial<ConversationProjectionRecord> & Pick<ConversationProjectionRecord, 'id'>,
  existing?: ConversationProjectionRecord | null,
): ConversationProjectionRecord {
  const now = new Date().toISOString();
  const mergedStepCount = Math.max(input.stepCount ?? 0, existing?.stepCount ?? 0);
  const createdAt = input.createdAt ?? existing?.createdAt;
  const updatedAt = input.updatedAt || existing?.updatedAt || now;
  const lastActivityAt = input.lastActivityAt
    || existing?.lastActivityAt
    || updatedAt
    || createdAt;
  const sessionHandle = input.sessionHandle !== undefined
    ? input.sessionHandle
    : existing?.sessionHandle;
  const provider = input.provider !== undefined
    ? input.provider
    : existing?.provider;

  return {
    id: input.id,
    title: input.title || existing?.title || `Conversation ${input.id.slice(0, 8)}`,
    workspace: input.workspace !== undefined ? input.workspace : (existing?.workspace || ''),
    stepCount: mergedStepCount,
    createdAt,
    provider,
    sessionHandle,
    updatedAt,
    lastActivityAt,
    visibility: input.visibility || existing?.visibility || 'visible',
    sourceKind: input.sourceKind || existing?.sourceKind || 'unknown',
    primaryRunId: input.primaryRunId !== undefined ? input.primaryRunId : existing?.primaryRunId,
    isLocalOnly: input.isLocalOnly ?? existing?.isLocalOnly ?? false,
    mtimeMs: input.mtimeMs ?? existing?.mtimeMs,
  };
}

export function upsertConversationProjection(
  input: Partial<ConversationProjectionRecord> & Pick<ConversationProjectionRecord, 'id'>,
): ConversationProjectionRecord {
  const db = getGatewayDb();
  const existing = getConversationProjectionById(input.id);
  const next = normalizeConversationProjectionInput(input, existing);
  const visibility = db.prepare(`
    SELECT is_hidden
    FROM conversation_visibility
    WHERE conversation_id = ?
    LIMIT 1
  `).get(next.id) as { is_hidden: number } | undefined;
  const effectiveVisibility: ConversationProjectionRecord['visibility'] =
    visibility?.is_hidden ? 'hidden' : next.visibility;

  const payload = {
    ...next,
    visibility: effectiveVisibility,
  };

  db.prepare(`
    INSERT INTO conversations(
      conversation_id, provider, workspace, title, step_count, created_at,
      updated_at, last_activity_at, visibility, source_kind, session_handle,
      primary_run_id, is_local_only, mtime_ms, payload_json
    )
    VALUES (
      @conversation_id, @provider, @workspace, @title, @step_count, @created_at,
      @updated_at, @last_activity_at, @visibility, @source_kind, @session_handle,
      @primary_run_id, @is_local_only, @mtime_ms, @payload_json
    )
    ON CONFLICT(conversation_id) DO UPDATE SET
      provider = excluded.provider,
      workspace = excluded.workspace,
      title = excluded.title,
      step_count = excluded.step_count,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      last_activity_at = excluded.last_activity_at,
      visibility = excluded.visibility,
      source_kind = excluded.source_kind,
      session_handle = excluded.session_handle,
      primary_run_id = excluded.primary_run_id,
      is_local_only = excluded.is_local_only,
      mtime_ms = excluded.mtime_ms,
      payload_json = excluded.payload_json
  `).run({
    conversation_id: payload.id,
    provider: payload.provider || null,
    workspace: payload.workspace || null,
    title: payload.title,
    step_count: payload.stepCount,
    created_at: payload.createdAt || null,
    updated_at: payload.updatedAt,
    last_activity_at: payload.lastActivityAt || null,
    visibility: payload.visibility,
    source_kind: payload.sourceKind,
    session_handle: payload.sessionHandle || null,
    primary_run_id: payload.primaryRunId || null,
    is_local_only: payload.isLocalOnly ? 1 : 0,
    mtime_ms: payload.mtimeMs ?? null,
    payload_json: JSON.stringify(payload),
  });

  return payload;
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

  upsertConversationProjection({
    id: record.id,
    title: record.title,
    workspace: record.workspace,
    stepCount: record.stepCount,
    createdAt: record.createdAt,
    provider: record.provider,
    sessionHandle: record.sessionHandle,
    updatedAt: new Date().toISOString(),
    lastActivityAt: record.createdAt || new Date().toISOString(),
    sourceKind: record.provider ? 'local-provider' : 'local-cache',
    isLocalOnly: Boolean(record.provider),
  });
}

export function listConversationRecords(): LocalConversationRecord[] {
  return listConversationProjections().map((record) => ({
    id: record.id,
    title: record.title,
    workspace: record.workspace,
    stepCount: record.stepCount,
    createdAt: record.createdAt,
    provider: record.provider,
    sessionHandle: record.sessionHandle,
  }));
}

export function getConversationRecordById(conversationId: string): LocalConversationRecord | null {
  const record = getConversationProjectionById(conversationId);
  if (!record) return null;
  return {
    id: record.id,
    title: record.title,
    workspace: record.workspace,
    stepCount: record.stepCount,
    createdAt: record.createdAt,
    provider: record.provider,
    sessionHandle: record.sessionHandle,
  };
}

export function findConversationRecordBySessionHandle(sessionHandle: string): LocalConversationRecord | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json, visibility
    FROM conversations
    WHERE session_handle = ?
    ORDER BY datetime(COALESCE(last_activity_at, updated_at, created_at, '1970-01-01T00:00:00.000Z')) DESC
    LIMIT 1
  `).get(sessionHandle) as { payload_json: string; visibility?: string | null } | undefined;

  if (!row) return null;
  const parsed = readConversationProjectionRow(row);
  return {
    id: parsed.id,
    title: parsed.title,
    workspace: parsed.workspace,
    stepCount: parsed.stepCount,
    createdAt: parsed.createdAt,
    provider: parsed.provider,
    sessionHandle: parsed.sessionHandle,
  };
}

export function getConversationProjectionById(conversationId: string): ConversationProjectionRecord | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT conversations.payload_json, conversation_visibility.is_hidden
    FROM conversations
    LEFT JOIN conversation_visibility ON conversation_visibility.conversation_id = conversations.conversation_id
    WHERE conversations.conversation_id = ?
    LIMIT 1
  `).get(conversationId) as { payload_json: string; is_hidden?: number } | undefined;

  if (!row) return null;
  const parsed = readConversationProjectionRow({ payload_json: row.payload_json });
  return {
    ...parsed,
    visibility: row.is_hidden ? 'hidden' : parsed.visibility,
  };
}

export function listConversationProjections(input?: {
  workspace?: string;
  includeHidden?: boolean;
}): ConversationProjectionRecord[] {
  const db = getGatewayDb();
  const rows = db.prepare(`
    SELECT conversations.payload_json, conversation_visibility.is_hidden
    FROM conversations
    LEFT JOIN conversation_visibility ON conversation_visibility.conversation_id = conversations.conversation_id
    ORDER BY datetime(COALESCE(conversations.last_activity_at, conversations.updated_at, conversations.created_at, '1970-01-01T00:00:00.000Z')) DESC
  `).all() as Array<{ payload_json: string; is_hidden?: number }>;

  return rows
    .map((row) => {
      const parsed = readConversationProjectionRow({ payload_json: row.payload_json });
      return {
        ...parsed,
        visibility: row.is_hidden ? 'hidden' : parsed.visibility,
      };
    })
    .filter((record) => input?.includeHidden ? true : record.visibility !== 'hidden')
    .filter((record) => {
      if (!input?.workspace) return true;
      if (!record.workspace) return false;
      return record.workspace.startsWith(input.workspace) || input.workspace.startsWith(record.workspace);
    });
}

export function upsertConversationOwnerCacheRecord(record: ConversationOwnerCacheRecord): void {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO conversation_owner_cache(
      conversation_id, backend_id, owner_kind, endpoint, workspace,
      step_count, last_seen_at, expires_at, payload_json
    )
    VALUES (
      @conversation_id, @backend_id, @owner_kind, @endpoint, @workspace,
      @step_count, @last_seen_at, @expires_at, @payload_json
    )
    ON CONFLICT(conversation_id) DO UPDATE SET
      backend_id = excluded.backend_id,
      owner_kind = excluded.owner_kind,
      endpoint = excluded.endpoint,
      workspace = excluded.workspace,
      step_count = excluded.step_count,
      last_seen_at = excluded.last_seen_at,
      expires_at = excluded.expires_at,
      payload_json = excluded.payload_json
  `).run({
    conversation_id: record.conversationId,
    backend_id: record.backendId,
    owner_kind: record.ownerKind,
    endpoint: record.endpoint,
    workspace: record.workspace || null,
    step_count: record.stepCount,
    last_seen_at: record.lastSeenAt,
    expires_at: record.expiresAt || null,
    payload_json: encodeConversationOwnerCache(record),
  });
}

export function getConversationOwnerCacheRecord(conversationId: string): ConversationOwnerCacheRecord | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT conversation_id, backend_id, owner_kind, endpoint, workspace, step_count, last_seen_at, expires_at, payload_json
    FROM conversation_owner_cache
    WHERE conversation_id = ?
      AND (expires_at IS NULL OR datetime(expires_at) >= datetime('now'))
    LIMIT 1
  `).get(conversationId) as Parameters<typeof decodeConversationOwnerCache>[0] | undefined;

  return row ? decodeConversationOwnerCache(row) : null;
}

export function pruneConversationOwnerCacheRecords(): void {
  const db = getGatewayDb();
  db.prepare(`
    DELETE FROM conversation_owner_cache
    WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')
  `).run();
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
