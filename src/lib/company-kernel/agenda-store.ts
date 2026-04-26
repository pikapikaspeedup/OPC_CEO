import { getGatewayDb } from '../storage/gateway-db';
import type {
  OperatingAgendaItem,
  OperatingAgendaPriority,
  OperatingAgendaStatus,
} from './contracts';

export interface OperatingAgendaListQuery {
  workspaceUri?: string;
  status?: OperatingAgendaStatus | OperatingAgendaStatus[];
  priority?: OperatingAgendaPriority | OperatingAgendaPriority[];
  minScore?: number;
  limit?: number;
  offset?: number;
}

type OperatingAgendaRow = { payload_json: string };

function normalizeArrayFilter<T extends string>(value?: T | T[]): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hydrateOperatingAgenda(row: OperatingAgendaRow): OperatingAgendaItem {
  return JSON.parse(row.payload_json) as OperatingAgendaItem;
}

function isClosedAgendaStatus(status: OperatingAgendaStatus): boolean {
  return status === 'completed' || status === 'dismissed' || status === 'dispatched';
}

function buildOperatingAgendaWhere(query: OperatingAgendaListQuery = {}): {
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

  const statuses = normalizeArrayFilter(query.status);
  if (statuses.length > 0) {
    const tokens = statuses.map((_, index) => `@status_${index}`);
    where.push(`status IN (${tokens.join(', ')})`);
    statuses.forEach((status, index) => {
      params[`status_${index}`] = status;
    });
  }

  const priorities = normalizeArrayFilter(query.priority);
  if (priorities.length > 0) {
    const tokens = priorities.map((_, index) => `@priority_${index}`);
    where.push(`priority IN (${tokens.join(', ')})`);
    priorities.forEach((priority, index) => {
      params[`priority_${index}`] = priority;
    });
  }

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

export function upsertOperatingAgendaItem(item: OperatingAgendaItem): OperatingAgendaItem {
  const db = getGatewayDb();
  const existing = getOperatingAgendaItem(item.id);
  const nextItem = existing && isClosedAgendaStatus(existing.status)
    ? {
      ...item,
      status: existing.status,
      budgetDecisionId: existing.budgetDecisionId,
      blockedReason: existing.blockedReason,
      dispatchedRunId: existing.dispatchedRunId,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    }
    : {
      ...item,
      createdAt: existing?.createdAt || item.createdAt,
    };

  db.prepare(`
    INSERT INTO operating_agenda(
      agenda_id, status, priority, score, workspace, created_at, updated_at, payload_json
    )
    VALUES (
      @agenda_id, @status, @priority, @score, @workspace, @created_at, @updated_at, @payload_json
    )
    ON CONFLICT(agenda_id) DO UPDATE SET
      status = excluded.status,
      priority = excluded.priority,
      score = excluded.score,
      workspace = excluded.workspace,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run({
    agenda_id: nextItem.id,
    status: nextItem.status,
    priority: nextItem.priority,
    score: nextItem.score,
    workspace: nextItem.workspaceUri || nextItem.targetDepartmentId || null,
    created_at: nextItem.createdAt,
    updated_at: nextItem.updatedAt,
    payload_json: JSON.stringify(nextItem),
  });
  return nextItem;
}

export function getOperatingAgendaItem(id: string): OperatingAgendaItem | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM operating_agenda
    WHERE agenda_id = ?
    LIMIT 1
  `).get(id) as OperatingAgendaRow | undefined;
  return row ? hydrateOperatingAgenda(row) : null;
}

export function countOperatingAgendaItems(query: OperatingAgendaListQuery = {}): number {
  const db = getGatewayDb();
  const { whereSql, params } = buildOperatingAgendaWhere(query);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM operating_agenda
    ${whereSql}
  `).get(params) as { count: number } | undefined;
  return row?.count || 0;
}

export function listOperatingAgendaItems(query: OperatingAgendaListQuery = {}): OperatingAgendaItem[] {
  const db = getGatewayDb();
  const { whereSql, params } = buildOperatingAgendaWhere(query);
  const paginationSql = query.limit ? ' LIMIT @limit OFFSET @offset' : '';
  if (query.limit) {
    params.limit = Math.max(1, Math.trunc(query.limit));
    params.offset = Math.max(0, Math.trunc(query.offset || 0));
  }

  const rows = db.prepare(`
    SELECT payload_json
    FROM operating_agenda
    ${whereSql}
    ORDER BY score DESC, datetime(updated_at) DESC
    ${paginationSql}
  `).all(params) as OperatingAgendaRow[];
  return rows.map(hydrateOperatingAgenda);
}

export function updateOperatingAgendaStatus(
  id: string,
  status: OperatingAgendaStatus,
  patch: Partial<OperatingAgendaItem> = {},
): OperatingAgendaItem | null {
  const existing = getOperatingAgendaItem(id);
  if (!existing) return null;
  const updated: OperatingAgendaItem = {
    ...existing,
    ...patch,
    status,
    updatedAt: new Date().toISOString(),
  };
  return upsertOperatingAgendaItem(updated);
}

export function snoozeOperatingAgendaItem(id: string, snoozedUntil: string): OperatingAgendaItem | null {
  return updateOperatingAgendaStatus(id, 'snoozed', { snoozedUntil });
}
