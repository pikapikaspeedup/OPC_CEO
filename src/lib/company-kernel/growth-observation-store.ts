import { getGatewayDb } from '../storage/gateway-db';
import type { GrowthObservation } from './contracts';

export interface GrowthObservationListQuery {
  proposalId?: string;
  limit?: number;
  offset?: number;
}

type GrowthObservationRow = { payload_json: string };

function hydrateGrowthObservation(row: GrowthObservationRow): GrowthObservation {
  return JSON.parse(row.payload_json) as GrowthObservation;
}

export function listGrowthObservations(query: GrowthObservationListQuery = {}): GrowthObservation[] {
  const db = getGatewayDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (query.proposalId) {
    where.push('proposal_id = @proposal_id');
    params.proposal_id = query.proposalId;
  }
  const paginationSql = query.limit ? ' LIMIT @limit OFFSET @offset' : '';
  if (query.limit) {
    params.limit = Math.max(1, Math.trunc(query.limit));
    params.offset = Math.max(0, Math.trunc(query.offset || 0));
  }
  const rows = db.prepare(`
    SELECT payload_json
    FROM growth_observations
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY datetime(observed_at) DESC
    ${paginationSql}
  `).all(params) as GrowthObservationRow[];
  return rows.map(hydrateGrowthObservation);
}
