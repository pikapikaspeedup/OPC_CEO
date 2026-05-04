import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

import { createLogger } from '../logger';
import { getGatewayDb } from '../storage/gateway-db';
import type {
  KnowledgeAsset,
  KnowledgeListQuery,
  KnowledgeReference,
  KnowledgeStatus,
} from './contracts';
import { buildKnowledgeSummary } from './contracts';

const log = createLogger('KnowledgeStore');
const KNOWLEDGE_DIR = path.join(homedir(), '.gemini', 'antigravity', 'knowledge');

type KnowledgeRow = {
  payload_json: string;
};

function ensureKnowledgeDir(): void {
  if (!existsSync(KNOWLEDGE_DIR)) {
    mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  }
}

function normalizeArrayFilter<T extends string>(value?: T | T[]): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hydrateKnowledgeAsset(row: KnowledgeRow): KnowledgeAsset {
  const asset = JSON.parse(row.payload_json) as KnowledgeAsset;
  const updatedAt = new Date(asset.updatedAt).getTime();
  const stale = asset.status === 'active'
    && Number.isFinite(updatedAt)
    && (Date.now() - updatedAt > 30 * 24 * 60 * 60 * 1000);
  return {
    ...asset,
    status: stale ? 'stale' : (asset.status || 'active'),
    tags: asset.tags || [],
    usageCount: asset.usageCount || 0,
  };
}

function buildReferences(asset: KnowledgeAsset): KnowledgeReference[] {
  const refs: KnowledgeReference[] = [
    { type: 'category', value: asset.category },
    { type: 'scope', value: asset.scope },
    { type: 'source', value: asset.source.type },
  ];

  if (asset.workspaceUri) {
    refs.push({ type: 'workspace', value: asset.workspaceUri });
  }
  if (asset.source.runId) {
    refs.push({ type: 'run_id', value: asset.source.runId });
  }

  return refs;
}

function writeKnowledgeMirror(
  asset: KnowledgeAsset,
  artifacts?: Record<string, string>,
): void {
  ensureKnowledgeDir();
  const knowledgeDir = path.join(KNOWLEDGE_DIR, asset.id);
  const artifactsDir = path.join(knowledgeDir, 'artifacts');
  const timestampsPath = path.join(knowledgeDir, 'timestamps.json');

  mkdirSync(knowledgeDir, { recursive: true });
  rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(artifactsDir, { recursive: true });

  const artifactPayloads = artifacts && Object.keys(artifacts).length > 0
    ? artifacts
    : { 'content.md': asset.content };

  for (const [artifactPath, content] of Object.entries(artifactPayloads)) {
    const filePath = path.join(artifactsDir, artifactPath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
  }

  const metadata = {
    title: asset.title,
    summary: buildKnowledgeSummary(asset.content),
    references: buildReferences(asset),
    workspaceUri: asset.workspaceUri,
    category: asset.category,
    status: asset.status || 'active',
    scope: asset.scope,
    usageCount: asset.usageCount || 0,
    lastAccessedAt: asset.lastAccessedAt || asset.updatedAt,
    tags: asset.tags || [],
    sourceType: asset.source.type,
    sourceRunId: asset.source.runId,
    sourceArtifactPath: asset.source.artifactPath,
    confidence: asset.confidence,
    evidenceCount: asset.evidence?.refs.length || 0,
    promotionLevel: asset.promotion?.level,
    promotionSourceCandidateId: asset.promotion?.sourceCandidateId,
  };
  writeFileSync(path.join(knowledgeDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

  let timestamps = {
    created: asset.createdAt,
    modified: asset.updatedAt,
    accessed: asset.updatedAt,
  };
  if (existsSync(timestampsPath)) {
    try {
      const existing = JSON.parse(readFileSync(timestampsPath, 'utf-8')) as typeof timestamps;
      timestamps = {
        created: existing.created || asset.createdAt,
        modified: asset.updatedAt,
        accessed: existing.accessed || asset.updatedAt,
      };
    } catch {
      // ignore malformed timestamp file and rewrite it
    }
  }
  writeFileSync(timestampsPath, JSON.stringify(timestamps, null, 2), 'utf-8');
}

function touchKnowledgeMirror(id: string, patch: { modified?: string; accessed?: string }): void {
  const timestampsPath = path.join(KNOWLEDGE_DIR, id, 'timestamps.json');
  if (!existsSync(timestampsPath)) return;

  try {
    const existing = JSON.parse(readFileSync(timestampsPath, 'utf-8')) as {
      created?: string;
      modified?: string;
      accessed?: string;
    };
    writeFileSync(
      timestampsPath,
      JSON.stringify({
        created: existing.created || patch.modified || patch.accessed || new Date().toISOString(),
        modified: patch.modified || existing.modified || existing.created || new Date().toISOString(),
        accessed: patch.accessed || existing.accessed || existing.modified || new Date().toISOString(),
      }, null, 2),
      'utf-8',
    );
  } catch {
    // ignore
  }
}

function updateMirrorMetadata(asset: KnowledgeAsset): void {
  const metadataPath = path.join(KNOWLEDGE_DIR, asset.id, 'metadata.json');
  if (!existsSync(metadataPath)) {
    writeKnowledgeMirror(asset);
    return;
  }
  const metadata = {
    title: asset.title,
    summary: buildKnowledgeSummary(asset.content),
    references: buildReferences(asset),
    workspaceUri: asset.workspaceUri,
    category: asset.category,
    status: asset.status || 'active',
    scope: asset.scope,
    usageCount: asset.usageCount || 0,
    lastAccessedAt: asset.lastAccessedAt || asset.updatedAt,
    tags: asset.tags || [],
    sourceType: asset.source.type,
    sourceRunId: asset.source.runId,
    sourceArtifactPath: asset.source.artifactPath,
    confidence: asset.confidence,
    evidenceCount: asset.evidence?.refs.length || 0,
    promotionLevel: asset.promotion?.level,
    promotionSourceCandidateId: asset.promotion?.sourceCandidateId,
  };
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

export function upsertKnowledgeAsset(
  asset: KnowledgeAsset,
  options?: { artifacts?: Record<string, string> },
): KnowledgeAsset {
  const db = getGatewayDb();
  const normalized: KnowledgeAsset = {
    ...asset,
    status: asset.status || 'active',
    tags: asset.tags || [],
    usageCount: asset.usageCount || 0,
    lastAccessedAt: asset.lastAccessedAt || asset.updatedAt,
  };

  db.prepare(`
    INSERT INTO knowledge_assets(
      knowledge_id, scope, workspace, category, status, created_at, updated_at, payload_json
    )
    VALUES (
      @knowledge_id, @scope, @workspace, @category, @status, @created_at, @updated_at, @payload_json
    )
    ON CONFLICT(knowledge_id) DO UPDATE SET
      scope = excluded.scope,
      workspace = excluded.workspace,
      category = excluded.category,
      status = excluded.status,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run({
    knowledge_id: normalized.id,
    scope: normalized.scope,
    workspace: normalized.workspaceUri || null,
    category: normalized.category,
    status: normalized.status,
    created_at: normalized.createdAt,
    updated_at: normalized.updatedAt,
    payload_json: JSON.stringify(normalized),
  });

  writeKnowledgeMirror(normalized, options?.artifacts);
  return normalized;
}

export function getKnowledgeAsset(id: string): KnowledgeAsset | null {
  const db = getGatewayDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM knowledge_assets
    WHERE knowledge_id = ?
  `).get(id) as KnowledgeRow | undefined;

  return row ? hydrateKnowledgeAsset(row) : null;
}

export function listKnowledgeAssets(query: KnowledgeListQuery = {}): KnowledgeAsset[] {
  const db = getGatewayDb();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.workspaceUri) {
    conditions.push('workspace = @workspace');
    params.workspace = query.workspaceUri;
  }
  if (query.scope) {
    conditions.push('scope = @scope');
    params.scope = query.scope;
  }

  const categories = normalizeArrayFilter(query.category);
  if (categories.length > 0) {
    const tokens = categories.map((_, index) => `@category_${index}`);
    conditions.push(`category IN (${tokens.join(', ')})`);
    categories.forEach((category, index) => {
      params[`category_${index}`] = category;
    });
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT payload_json
    FROM knowledge_assets
    ${where}
    ORDER BY datetime(updated_at) DESC
  `).all(params) as KnowledgeRow[];
  const hydrated = rows.map(hydrateKnowledgeAsset);
  const statuses = normalizeArrayFilter(query.status);
  const filtered = statuses.length > 0
    ? hydrated.filter((asset) => statuses.includes(asset.status || 'active'))
    : hydrated;
  return query.limit && query.limit > 0
    ? filtered.slice(0, Math.trunc(query.limit))
    : filtered;
}

export function listRecentKnowledgeAssets(limit = 20, workspaceUri?: string): KnowledgeAsset[] {
  return listKnowledgeAssets({
    ...(workspaceUri ? { workspaceUri } : {}),
    limit,
  });
}

export function updateKnowledgeAssetMetadata(
  id: string,
  patch: { title?: string; content?: string; status?: KnowledgeStatus },
): KnowledgeAsset | null {
  const asset = getKnowledgeAsset(id);
  if (!asset) return null;

  const updated: KnowledgeAsset = {
    ...asset,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    usageCount: asset.usageCount || 0,
    lastAccessedAt: asset.lastAccessedAt || asset.updatedAt,
    updatedAt: new Date().toISOString(),
  };

  upsertKnowledgeAsset(updated, patch.content !== undefined ? { artifacts: { 'content.md': patch.content } } : undefined);
  updateMirrorMetadata(updated);
  touchKnowledgeMirror(id, { modified: updated.updatedAt });
  return updated;
}

export function updateKnowledgeAssetArtifact(
  id: string,
  artifactPath: string,
  content: string,
): KnowledgeAsset | null {
  const asset = getKnowledgeAsset(id);
  if (!asset) return null;

  const artifactFilePath = path.join(KNOWLEDGE_DIR, id, 'artifacts', artifactPath);
  mkdirSync(path.dirname(artifactFilePath), { recursive: true });
  writeFileSync(artifactFilePath, content, 'utf-8');

  const shouldSyncPrimaryContent = artifactPath === 'content.md';
  const updated = shouldSyncPrimaryContent
    ? updateKnowledgeAssetMetadata(id, { content })
    : updateKnowledgeAssetMetadata(id, {});

  touchKnowledgeMirror(id, { modified: new Date().toISOString() });
  return updated;
}

export function recordKnowledgeAssetAccess(ids: string[]): void {
  for (const id of ids) {
    const asset = getKnowledgeAsset(id);
    if (!asset) continue;
    upsertKnowledgeAsset({
      ...asset,
      usageCount: (asset.usageCount || 0) + 1,
      lastAccessedAt: new Date().toISOString(),
      updatedAt: asset.updatedAt,
    }, { artifacts: { 'content.md': asset.content } });
    touchKnowledgeMirror(id, { accessed: new Date().toISOString() });
  }
}

export function deleteKnowledgeAsset(id: string): void {
  const db = getGatewayDb();
  db.prepare(`
    DELETE FROM knowledge_assets
    WHERE knowledge_id = ?
  `).run(id);

  rmSync(path.join(KNOWLEDGE_DIR, id), { recursive: true, force: true });
}

export function listLegacyFilesystemKnowledgeIds(): string[] {
  if (!existsSync(KNOWLEDGE_DIR)) return [];
  return readdirSync(KNOWLEDGE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

export function buildKnowledgeItemFromAsset(asset: KnowledgeAsset): {
  id: string;
  title: string;
  summary: string;
  references: KnowledgeReference[];
  timestamps: { created: string; modified: string; accessed: string };
  artifactFiles: string[];
  workspaceUri?: string;
  category: string;
  status: string;
  usageCount: number;
  lastAccessedAt?: string;
} {
  return {
    id: asset.id,
    title: asset.title,
    summary: buildKnowledgeSummary(asset.content),
    references: buildReferences(asset),
    timestamps: {
      created: asset.createdAt,
      modified: asset.updatedAt,
      accessed: asset.lastAccessedAt || asset.updatedAt,
    },
    artifactFiles: ['content.md'],
    workspaceUri: asset.workspaceUri,
    category: asset.category,
    status: asset.status || 'active',
    usageCount: asset.usageCount || 0,
    lastAccessedAt: asset.lastAccessedAt,
  };
}

export function logKnowledgePersistence(runId: string, count: number): void {
  log.info({ runId: runId.slice(0, 8), assets: count }, 'Knowledge assets persisted');
}
