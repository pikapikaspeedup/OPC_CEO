import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

import { createLogger } from '../logger';
import { getGatewayDb } from '../storage/gateway-db';
import type {
  EvolutionProposal,
  EvolutionProposalKind,
  EvolutionProposalListQuery,
  EvolutionProposalStatus,
} from './contracts';

const log = createLogger('EvolutionStore');
const EVOLUTION_DIR = path.join(homedir(), '.gemini', 'antigravity', 'evolution');

type ProposalRow = {
  payload_json: string;
};

function ensureEvolutionDir(): void {
  if (!existsSync(EVOLUTION_DIR)) {
    mkdirSync(EVOLUTION_DIR, { recursive: true });
  }
}

function persistProposalMirror(proposal: EvolutionProposal): void {
  try {
    ensureEvolutionDir();
    writeFileSync(
      path.join(EVOLUTION_DIR, `${proposal.id}.json`),
      JSON.stringify(proposal, null, 2),
      'utf-8',
    );
  } catch (err: unknown) {
    log.warn({ proposalId: proposal.id, err: err instanceof Error ? err.message : String(err) }, 'Failed to persist evolution proposal mirror');
  }
}

function normalizeArrayFilter<T extends string>(value?: T | T[]): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hydrateProposal(row: ProposalRow): EvolutionProposal {
  return JSON.parse(row.payload_json) as EvolutionProposal;
}

export function upsertEvolutionProposal(proposal: EvolutionProposal): EvolutionProposal {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO evolution_proposals(
      proposal_id, kind, workspace, status, target_name, created_at, updated_at, payload_json
    )
    VALUES (
      @proposal_id, @kind, @workspace, @status, @target_name, @created_at, @updated_at, @payload_json
    )
    ON CONFLICT(proposal_id) DO UPDATE SET
      kind = excluded.kind,
      workspace = excluded.workspace,
      status = excluded.status,
      target_name = excluded.target_name,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run({
    proposal_id: proposal.id,
    kind: proposal.kind,
    workspace: proposal.workspaceUri || null,
    status: proposal.status,
    target_name: proposal.targetName,
    created_at: proposal.createdAt,
    updated_at: proposal.updatedAt,
    payload_json: JSON.stringify(proposal),
  });

  persistProposalMirror(proposal);
  return proposal;
}

export function getEvolutionProposal(id: string): EvolutionProposal | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM evolution_proposals
    WHERE proposal_id = ?
  `).get(id) as ProposalRow | undefined;

  return row ? hydrateProposal(row) : null;
}

export function listEvolutionProposals(query: EvolutionProposalListQuery = {}): EvolutionProposal[] {
  const db = getGatewayDb();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.workspaceUri) {
    conditions.push('workspace = @workspace');
    params.workspace = query.workspaceUri;
  }

  const kinds = normalizeArrayFilter(query.kind);
  if (kinds.length > 0) {
    const tokens = kinds.map((_, index) => `@kind_${index}`);
    conditions.push(`kind IN (${tokens.join(', ')})`);
    kinds.forEach((kind, index) => {
      params[`kind_${index}`] = kind;
    });
  }

  const statuses = normalizeArrayFilter(query.status);
  if (statuses.length > 0) {
    const tokens = statuses.map((_, index) => `@status_${index}`);
    conditions.push(`status IN (${tokens.join(', ')})`);
    statuses.forEach((status, index) => {
      params[`status_${index}`] = status;
    });
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = query.limit && query.limit > 0 ? `LIMIT ${Math.trunc(query.limit)}` : '';
  const rows = db.prepare(`
    SELECT payload_json
    FROM evolution_proposals
    ${where}
    ORDER BY datetime(updated_at) DESC
    ${limit}
  `).all(params) as ProposalRow[];

  return rows.map(hydrateProposal);
}

export function findEvolutionProposalByTarget(input: {
  kind: EvolutionProposalKind;
  targetName: string;
  workspaceUri?: string;
}): EvolutionProposal | null {
  const matches = listEvolutionProposals({
    ...(input.workspaceUri ? { workspaceUri: input.workspaceUri } : {}),
    kind: input.kind,
  });
  return matches.find((proposal) => proposal.targetName === input.targetName) || null;
}

export function patchEvolutionProposal(
  id: string,
  patch: Partial<Omit<EvolutionProposal, 'id' | 'createdAt'>>,
): EvolutionProposal | null {
  const proposal = getEvolutionProposal(id);
  if (!proposal) return null;

  const updated: EvolutionProposal = {
    ...proposal,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  return upsertEvolutionProposal(updated);
}

export function loadPersistedEvolutionProposalMirrors(): number {
  if (!existsSync(EVOLUTION_DIR)) return 0;

  let count = 0;
  for (const file of readdirSync(EVOLUTION_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const proposal = JSON.parse(
        readFileSync(path.join(EVOLUTION_DIR, file), 'utf-8'),
      ) as EvolutionProposal;
      if (!proposal.id) continue;
      upsertEvolutionProposal(proposal);
      count++;
    } catch {
      // ignore malformed mirrors
    }
  }

  return count;
}

export function listProposalCountsByStatus(): Record<EvolutionProposalStatus, number> {
  const summary: Record<EvolutionProposalStatus, number> = {
    draft: 0,
    evaluated: 0,
    'pending-approval': 0,
    published: 0,
    rejected: 0,
  };

  for (const proposal of listEvolutionProposals()) {
    summary[proposal.status] = (summary[proposal.status] || 0) + 1;
  }

  return summary;
}
