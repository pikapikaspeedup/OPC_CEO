import { randomUUID } from 'crypto';

import { listRunCapsules } from './run-capsule-store';
import { getGatewayDb } from '../storage/gateway-db';
import type { GrowthObservation, GrowthProposal } from './contracts';
import { patchGrowthProposal } from './growth-proposal-store';

export interface GrowthObservationListQuery {
  proposalId?: string;
  limit?: number;
  offset?: number;
}

type GrowthObservationRow = { payload_json: string };

function hydrateGrowthObservation(row: GrowthObservationRow): GrowthObservation {
  return JSON.parse(row.payload_json) as GrowthObservation;
}

export function upsertGrowthObservation(observation: GrowthObservation): GrowthObservation {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO growth_observations(
      observation_id, proposal_id, published_asset_ref, observed_at, payload_json
    )
    VALUES (
      @observation_id, @proposal_id, @published_asset_ref, @observed_at, @payload_json
    )
    ON CONFLICT(observation_id) DO UPDATE SET
      proposal_id = excluded.proposal_id,
      published_asset_ref = excluded.published_asset_ref,
      observed_at = excluded.observed_at,
      payload_json = excluded.payload_json
  `).run({
    observation_id: observation.id,
    proposal_id: observation.proposalId,
    published_asset_ref: observation.publishedAssetRef || null,
    observed_at: observation.observedAt,
    payload_json: JSON.stringify(observation),
  });
  return observation;
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

function normalizeTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 12);
}

export function observeGrowthProposal(proposal: GrowthProposal): GrowthObservation {
  const tokens = new Set(normalizeTokens(`${proposal.title} ${proposal.summary} ${proposal.targetName}`));
  const capsules = listRunCapsules({
    ...(proposal.workspaceUri ? { workspaceUri: proposal.workspaceUri } : {}),
    limit: 100,
  });
  const matched = capsules.filter((capsule) => {
    const haystack = `${capsule.goal} ${capsule.prompt} ${capsule.reusableSteps.join(' ')} ${capsule.decisions.join(' ')}`.toLowerCase();
    let hits = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) hits++;
    }
    return hits >= Math.min(2, tokens.size);
  });
  const successful = matched.filter((capsule) => capsule.status === 'completed');
  const regressionSignals = matched
    .filter((capsule) => capsule.status !== 'completed')
    .map((capsule) => `${capsule.runId}:${capsule.status}`)
    .slice(0, 10);
  const estimatedTokenSaving = matched.reduce((total, capsule) => {
    const tokens = capsule.tokenUsage?.totalTokens || 0;
    return total + Math.max(0, Math.round(tokens * 0.08));
  }, 0);
  const observation: GrowthObservation = {
    id: `growth-observation-${randomUUID()}`,
    proposalId: proposal.id,
    ...(proposal.publishedAssetRef ? { publishedAssetRef: proposal.publishedAssetRef } : {}),
    observedAt: new Date().toISOString(),
    hitCount: matched.length,
    matchedRunIds: matched.map((capsule) => capsule.runId),
    successRate: matched.length > 0 ? successful.length / matched.length : null,
    estimatedTokenSaving,
    regressionSignals,
    summary: matched.length > 0
      ? `Matched ${matched.length} runs after publication.`
      : 'No matching runs observed yet.',
  };
  upsertGrowthObservation(observation);
  patchGrowthProposal(proposal.id, { status: 'observing' });
  return observation;
}
