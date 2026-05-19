import { getGatewayDb } from '../storage/gateway-db';
import type {
  GrowthProposal,
  GrowthProposalKind,
  GrowthProposalRisk,
  GrowthProposalStatus,
} from './contracts';

export interface GrowthProposalListQuery {
  workspaceUri?: string;
  kind?: GrowthProposalKind | GrowthProposalKind[];
  status?: GrowthProposalStatus | GrowthProposalStatus[];
  risk?: GrowthProposalRisk | GrowthProposalRisk[];
  targetName?: string;
  minScore?: number;
  limit?: number;
  offset?: number;
}

type GrowthProposalRow = { payload_json: string };

function normalizeArrayFilter<T extends string>(value?: T | T[]): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hydrateGrowthProposal(row: GrowthProposalRow): GrowthProposal {
  return JSON.parse(row.payload_json) as GrowthProposal;
}

function buildGrowthProposalWhere(query: GrowthProposalListQuery = {}): {
  whereSql: string;
  params: Record<string, unknown>;
} {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.workspaceUri) {
    where.push('workspace = @workspace');
    params.workspace = query.workspaceUri;
  }
  if (query.targetName) {
    where.push('target_name = @target_name');
    params.target_name = query.targetName;
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

  const risks = normalizeArrayFilter(query.risk);
  if (risks.length > 0) {
    const tokens = risks.map((_, index) => `@risk_${index}`);
    where.push(`risk IN (${tokens.join(', ')})`);
    risks.forEach((risk, index) => {
      params[`risk_${index}`] = risk;
    });
  }

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

export function getGrowthProposal(id: string): GrowthProposal | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM growth_proposals
    WHERE proposal_id = ?
    LIMIT 1
  `).get(id) as GrowthProposalRow | undefined;
  return row ? hydrateGrowthProposal(row) : null;
}

export function countGrowthProposals(query: GrowthProposalListQuery = {}): number {
  const db = getGatewayDb();
  const { whereSql, params } = buildGrowthProposalWhere(query);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM growth_proposals
    ${whereSql}
  `).get(params) as { count: number } | undefined;
  return row?.count || 0;
}

export function listGrowthProposals(query: GrowthProposalListQuery = {}): GrowthProposal[] {
  const db = getGatewayDb();
  const { whereSql, params } = buildGrowthProposalWhere(query);
  const paginationSql = query.limit ? ' LIMIT @limit OFFSET @offset' : '';
  if (query.limit) {
    params.limit = Math.max(1, Math.trunc(query.limit));
    params.offset = Math.max(0, Math.trunc(query.offset || 0));
  }

  const rows = db.prepare(`
    SELECT payload_json
    FROM growth_proposals
    ${whereSql}
    ORDER BY score DESC, datetime(updated_at) DESC
    ${paginationSql}
  `).all(params) as GrowthProposalRow[];
  return rows.map(hydrateGrowthProposal);
}
