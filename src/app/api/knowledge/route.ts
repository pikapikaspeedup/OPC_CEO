import { randomUUID } from 'crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import { NextResponse } from 'next/server';

import {
  buildKnowledgeItemFromAsset,
  getKnowledgeAsset,
  listKnowledgeAssets,
  upsertKnowledgeAsset,
} from '@/lib/knowledge';
import type { KnowledgeAsset, KnowledgeCategory, KnowledgeScope, KnowledgeStatus } from '@/lib/knowledge';

export const dynamic = 'force-dynamic';

const KNOWLEDGE_DIR = join(homedir(), '.gemini', 'antigravity', 'knowledge');

type KnowledgeResponseItem = ReturnType<typeof buildKnowledgeItemFromAsset> & {
  tags?: string[];
  scope?: KnowledgeScope;
  sourceType?: KnowledgeAsset['source']['type'];
  sourceRunId?: string;
  sourceArtifactPath?: string;
  confidence?: number;
  evidenceCount?: number;
  promotionLevel?: string;
  promotionSourceCandidateId?: string;
};

type KnowledgeReference = KnowledgeResponseItem['references'][number];

const KNOWLEDGE_REFERENCE_TYPES = new Set<KnowledgeReference['type']>(['workspace', 'run_id', 'category', 'scope', 'source']);
const KNOWLEDGE_CATEGORIES = new Set<KnowledgeCategory>([
  'decision',
  'pattern',
  'lesson',
  'domain-knowledge',
  'workflow-proposal',
  'skill-proposal',
]);
const KNOWLEDGE_STATUSES = new Set<KnowledgeStatus>(['active', 'stale', 'conflicted', 'proposal']);

function listArtifactFiles(artifactsDir: string, base = ''): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(artifactsDir, { withFileTypes: true })) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...listArtifactFiles(join(artifactsDir, entry.name), rel));
      } else if (entry.name.endsWith('.md')) {
        files.push(rel);
      }
    }
  } catch {
    // dir missing
  }
  return files;
}

function buildResponseFromAsset(asset: KnowledgeAsset): KnowledgeResponseItem {
  const base = buildKnowledgeItemFromAsset(asset);
  return {
    ...base,
    tags: asset.tags || [],
    scope: asset.scope,
    sourceType: asset.source.type,
    sourceRunId: asset.source.runId,
    sourceArtifactPath: asset.source.artifactPath,
    confidence: asset.confidence,
    evidenceCount: asset.evidence?.refs.length || 0,
    promotionLevel: asset.promotion?.level,
    promotionSourceCandidateId: asset.promotion?.sourceCandidateId,
  };
}

function buildResponseFromMirror(id: string): KnowledgeResponseItem | null {
  const knowledgeDir = join(KNOWLEDGE_DIR, id);
  const metaPath = join(knowledgeDir, 'metadata.json');
  const timestampsPath = join(knowledgeDir, 'timestamps.json');

  if (!existsSync(metaPath)) return null;

  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as Record<string, unknown>;
    let timestamps = { created: '', modified: '', accessed: '' };
    try {
      timestamps = JSON.parse(readFileSync(timestampsPath, 'utf-8')) as typeof timestamps;
    } catch {
      // optional
    }

    const references = Array.isArray(meta.references)
      ? meta.references.filter((reference): reference is KnowledgeReference => {
        if (!reference || typeof reference !== 'object') return false;
        const candidate = reference as { type?: unknown; value?: unknown };
        return KNOWLEDGE_REFERENCE_TYPES.has(candidate.type as KnowledgeReference['type']) && typeof candidate.value === 'string';
      })
      : [];
    const category = typeof meta.category === 'string' && KNOWLEDGE_CATEGORIES.has(meta.category as KnowledgeCategory)
      ? meta.category
      : 'domain-knowledge';
    const status = typeof meta.status === 'string' && KNOWLEDGE_STATUSES.has(meta.status as KnowledgeStatus)
      ? meta.status
      : 'active';
    const usageCount = typeof meta.usageCount === 'number' ? meta.usageCount : 0;

    return {
      id,
      title: typeof meta.title === 'string' && meta.title.trim() ? meta.title : id,
      summary: typeof meta.summary === 'string' ? meta.summary : '',
      references,
      timestamps,
      artifactFiles: listArtifactFiles(join(knowledgeDir, 'artifacts')),
      workspaceUri: typeof meta.workspaceUri === 'string' ? meta.workspaceUri : undefined,
      category,
      status,
      usageCount,
      lastAccessedAt: typeof meta.lastAccessedAt === 'string' ? meta.lastAccessedAt : undefined,
      tags: Array.isArray(meta.tags) ? meta.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      scope: meta.scope === 'organization' ? 'organization' : meta.scope === 'department' ? 'department' : undefined,
      sourceType: meta.sourceType === 'manual' || meta.sourceType === 'ceo' || meta.sourceType === 'system' || meta.sourceType === 'run'
        ? meta.sourceType
        : undefined,
      sourceRunId: typeof meta.sourceRunId === 'string' ? meta.sourceRunId : undefined,
      sourceArtifactPath: typeof meta.sourceArtifactPath === 'string' ? meta.sourceArtifactPath : undefined,
      confidence: typeof meta.confidence === 'number' ? meta.confidence : undefined,
      evidenceCount: typeof meta.evidenceCount === 'number' ? meta.evidenceCount : undefined,
      promotionLevel: typeof meta.promotionLevel === 'string' ? meta.promotionLevel : undefined,
      promotionSourceCandidateId: typeof meta.promotionSourceCandidateId === 'string' ? meta.promotionSourceCandidateId : undefined,
    };
  } catch {
    return null;
  }
}

function buildSearchHaystack(item: KnowledgeResponseItem): string {
  return [
    item.title,
    item.summary,
    item.category,
    item.workspaceUri,
    item.status,
    ...(item.tags || []),
    ...item.references.map((reference) => `${reference.type}:${reference.value}`),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function sortItems(items: KnowledgeResponseItem[], sort: string): KnowledgeResponseItem[] {
  const copy = [...items];

  if (sort === 'alpha') {
    copy.sort((a, b) => a.title.localeCompare(b.title));
    return copy;
  }
  if (sort === 'reuse') {
    copy.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
    return copy;
  }
  if (sort === 'created') {
    copy.sort((a, b) => new Date(b.timestamps.created || 0).getTime() - new Date(a.timestamps.created || 0).getTime());
    return copy;
  }
  if (sort === 'updated') {
    copy.sort((a, b) => new Date(b.timestamps.modified || 0).getTime() - new Date(a.timestamps.modified || 0).getTime());
    return copy;
  }

  copy.sort((a, b) => {
    const aTime = new Date(a.lastAccessedAt || a.timestamps.accessed || a.timestamps.modified || a.timestamps.created || 0).getTime();
    const bTime = new Date(b.lastAccessedAt || b.timestamps.accessed || b.timestamps.modified || b.timestamps.created || 0).getTime();
    return bTime - aTime;
  });
  return copy;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const workspaceFilter = url.searchParams.get('workspace') || undefined;
    const categoryFilter = url.searchParams.get('category') || undefined;
    const statusFilter = url.searchParams.get('status') || undefined;
    const scopeFilter = url.searchParams.get('scope') || undefined;
    const tagFilter = url.searchParams.get('tag') || undefined;
    const query = (url.searchParams.get('q') || '').trim().toLowerCase();
    const sort = url.searchParams.get('sort') || 'recent';
    const limit = Number(url.searchParams.get('limit') || 0);

    const ids = new Set<string>();
    try {
      for (const entry of readdirSync(KNOWLEDGE_DIR, { withFileTypes: true })) {
        if (entry.isDirectory()) ids.add(entry.name);
      }
    } catch {
      // directory missing
    }

    for (const asset of listKnowledgeAssets()) {
      ids.add(asset.id);
    }

    const items: KnowledgeResponseItem[] = [];
    for (const id of ids) {
      const storedAsset = getKnowledgeAsset(id);
      const item = storedAsset ? buildResponseFromAsset(storedAsset) : buildResponseFromMirror(id);
      if (item) items.push(item);
    }

    const filtered = items.filter((item) => {
      if (workspaceFilter && item.workspaceUri !== workspaceFilter) return false;
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      if (scopeFilter && item.scope !== scopeFilter) return false;
      if (tagFilter && !(item.tags || []).includes(tagFilter)) return false;
      if (query && !buildSearchHaystack(item).includes(query)) return false;
      return true;
    });

    const sorted = sortItems(filtered, sort);
    return NextResponse.json(limit > 0 ? sorted.slice(0, limit) : sorted);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as {
      title?: string;
      summary?: string;
      content?: string;
      workspaceUri?: string;
      category?: string;
      tags?: string[];
    };

    const now = new Date().toISOString();
    const id = `knowledge-${randomUUID()}`;
    const title = body.title?.trim() || '新建知识';
    const content = body.content?.trim() || `# ${title}\n\n补充这条知识的摘要、要点、正文和引用。`;
    const asset: KnowledgeAsset = {
      id,
      scope: 'department',
      workspaceUri: body.workspaceUri,
      category: (body.category as KnowledgeCategory) || 'domain-knowledge',
      title,
      content,
      source: {
        type: 'manual',
      },
      confidence: 1,
      tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0) : [],
      status: 'active',
      usageCount: 0,
      lastAccessedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    upsertKnowledgeAsset(asset);

    if (body.summary?.trim()) {
      const metaPath = join(KNOWLEDGE_DIR, id, 'metadata.json');
      if (existsSync(metaPath)) {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as Record<string, unknown>;
        meta.summary = body.summary.trim();
        writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
      }
    }

    const created = buildResponseFromAsset(asset);
    return NextResponse.json({
      ...created,
      summary: body.summary?.trim() || created.summary,
      artifacts: { 'content.md': content },
    }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
