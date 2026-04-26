import { getGatewayDb } from '../storage/gateway-db';
import type {
  SystemImprovementProposal,
  SystemImprovementProposalStatus,
  SystemImprovementRisk,
  SystemImprovementSeverity,
  SystemImprovementSignal,
  SystemImprovementSignalSource,
  SystemImprovementTestEvidence,
} from './contracts';

export interface SystemImprovementSignalListQuery {
  source?: SystemImprovementSignalSource | SystemImprovementSignalSource[];
  severity?: SystemImprovementSeverity | SystemImprovementSeverity[];
  limit?: number;
  offset?: number;
}

export interface SystemImprovementProposalListQuery {
  status?: SystemImprovementProposalStatus | SystemImprovementProposalStatus[];
  risk?: SystemImprovementRisk | SystemImprovementRisk[];
  limit?: number;
  offset?: number;
}

type PayloadRow = { payload_json: string };

function normalizeArrayFilter<T extends string>(value?: T | T[]): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hydrateSignal(row: PayloadRow): SystemImprovementSignal {
  return JSON.parse(row.payload_json) as SystemImprovementSignal;
}

function hydrateProposal(row: PayloadRow): SystemImprovementProposal {
  return JSON.parse(row.payload_json) as SystemImprovementProposal;
}

function buildSignalWhere(query: SystemImprovementSignalListQuery = {}): {
  whereSql: string;
  params: Record<string, unknown>;
} {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  const sources = normalizeArrayFilter(query.source);
  if (sources.length > 0) {
    const tokens = sources.map((_, index) => `@source_${index}`);
    where.push(`source IN (${tokens.join(', ')})`);
    sources.forEach((source, index) => {
      params[`source_${index}`] = source;
    });
  }
  const severities = normalizeArrayFilter(query.severity);
  if (severities.length > 0) {
    const tokens = severities.map((_, index) => `@severity_${index}`);
    where.push(`severity IN (${tokens.join(', ')})`);
    severities.forEach((severity, index) => {
      params[`severity_${index}`] = severity;
    });
  }
  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

function buildProposalWhere(query: SystemImprovementProposalListQuery = {}): {
  whereSql: string;
  params: Record<string, unknown>;
} {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
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

export function upsertSystemImprovementSignal(signal: SystemImprovementSignal): SystemImprovementSignal {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO system_improvement_signals(
      signal_id, source, severity, created_at, payload_json
    )
    VALUES (
      @signal_id, @source, @severity, @created_at, @payload_json
    )
    ON CONFLICT(signal_id) DO UPDATE SET
      source = excluded.source,
      severity = excluded.severity,
      created_at = excluded.created_at,
      payload_json = excluded.payload_json
  `).run({
    signal_id: signal.id,
    source: signal.source,
    severity: signal.severity,
    created_at: signal.createdAt,
    payload_json: JSON.stringify(signal),
  });
  return signal;
}

export function getSystemImprovementSignal(id: string): SystemImprovementSignal | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM system_improvement_signals
    WHERE signal_id = ?
    LIMIT 1
  `).get(id) as PayloadRow | undefined;
  return row ? hydrateSignal(row) : null;
}

export function countSystemImprovementSignals(query: SystemImprovementSignalListQuery = {}): number {
  const db = getGatewayDb();
  const { whereSql, params } = buildSignalWhere(query);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM system_improvement_signals
    ${whereSql}
  `).get(params) as { count: number } | undefined;
  return row?.count || 0;
}

export function listSystemImprovementSignals(query: SystemImprovementSignalListQuery = {}): SystemImprovementSignal[] {
  const db = getGatewayDb();
  const { whereSql, params } = buildSignalWhere(query);
  const paginationSql = query.limit ? ' LIMIT @limit OFFSET @offset' : '';
  if (query.limit) {
    params.limit = Math.max(1, Math.trunc(query.limit));
    params.offset = Math.max(0, Math.trunc(query.offset || 0));
  }
  const rows = db.prepare(`
    SELECT payload_json
    FROM system_improvement_signals
    ${whereSql}
    ORDER BY datetime(created_at) DESC
    ${paginationSql}
  `).all(params) as PayloadRow[];
  return rows.map(hydrateSignal);
}

export function upsertSystemImprovementProposal(proposal: SystemImprovementProposal): SystemImprovementProposal {
  const db = getGatewayDb();
  db.prepare(`
    INSERT INTO system_improvement_proposals(
      proposal_id, status, risk, created_at, updated_at, payload_json
    )
    VALUES (
      @proposal_id, @status, @risk, @created_at, @updated_at, @payload_json
    )
    ON CONFLICT(proposal_id) DO UPDATE SET
      status = excluded.status,
      risk = excluded.risk,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run({
    proposal_id: proposal.id,
    status: proposal.status,
    risk: proposal.risk,
    created_at: proposal.createdAt,
    updated_at: proposal.updatedAt,
    payload_json: JSON.stringify(proposal),
  });
  return proposal;
}

export function getSystemImprovementProposal(id: string): SystemImprovementProposal | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM system_improvement_proposals
    WHERE proposal_id = ?
    LIMIT 1
  `).get(id) as PayloadRow | undefined;
  return row ? hydrateProposal(row) : null;
}

export function countSystemImprovementProposals(query: SystemImprovementProposalListQuery = {}): number {
  const db = getGatewayDb();
  const { whereSql, params } = buildProposalWhere(query);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM system_improvement_proposals
    ${whereSql}
  `).get(params) as { count: number } | undefined;
  return row?.count || 0;
}

export function listSystemImprovementProposals(query: SystemImprovementProposalListQuery = {}): SystemImprovementProposal[] {
  const db = getGatewayDb();
  const { whereSql, params } = buildProposalWhere(query);
  const paginationSql = query.limit ? ' LIMIT @limit OFFSET @offset' : '';
  if (query.limit) {
    params.limit = Math.max(1, Math.trunc(query.limit));
    params.offset = Math.max(0, Math.trunc(query.offset || 0));
  }
  const rows = db.prepare(`
    SELECT payload_json
    FROM system_improvement_proposals
    ${whereSql}
    ORDER BY datetime(updated_at) DESC
    ${paginationSql}
  `).all(params) as PayloadRow[];
  return rows.map(hydrateProposal);
}

export function patchSystemImprovementProposal(
  id: string,
  patch: Partial<Omit<SystemImprovementProposal, 'id' | 'createdAt'>>,
): SystemImprovementProposal | null {
  const existing = getSystemImprovementProposal(id);
  if (!existing) return null;
  return upsertSystemImprovementProposal({
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

function isTerminalSystemImprovementStatus(status: SystemImprovementProposalStatus): boolean {
  return status === 'published'
    || status === 'rejected'
    || status === 'rolled-back'
    || status === 'observing';
}

function requiresApprovedSystemImprovementEvidence(proposal: SystemImprovementProposal): boolean {
  return proposal.risk === 'high' || proposal.risk === 'critical';
}

function hasApprovedSystemImprovementEvidence(proposal: SystemImprovementProposal): boolean {
  return proposal.status === 'approved'
    || proposal.metadata?.approvalStatus === 'approved'
    || typeof proposal.metadata?.approvedAt === 'string';
}

function nextStatusAfterTestEvidence(input: {
  proposal: SystemImprovementProposal;
  latestEvidenceStatus?: SystemImprovementTestEvidence['status'];
}): SystemImprovementProposalStatus {
  if (isTerminalSystemImprovementStatus(input.proposal.status)) {
    return input.proposal.status;
  }
  if (input.latestEvidenceStatus === 'failed') return 'testing';
  if (input.latestEvidenceStatus !== 'passed') return 'testing';
  if (requiresApprovedSystemImprovementEvidence(input.proposal) && !hasApprovedSystemImprovementEvidence(input.proposal)) {
    return input.proposal.status === 'approval-required' ? 'approval-required' : 'testing';
  }
  return 'ready-to-merge';
}

export function attachSystemImprovementTestEvidence(
  id: string,
  evidence: SystemImprovementTestEvidence,
): SystemImprovementProposal | null {
  const existing = getSystemImprovementProposal(id);
  if (!existing) return null;
  const nextEvidence = [...existing.testEvidence, evidence];
  const latestEvidenceStatus = nextEvidence[nextEvidence.length - 1]?.status;
  return patchSystemImprovementProposal(id, {
    testEvidence: nextEvidence,
    status: nextStatusAfterTestEvidence({
      proposal: existing,
      latestEvidenceStatus,
    }),
  });
}
