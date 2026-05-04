import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import { NextResponse } from 'next/server';

import {
  buildKnowledgeItemFromAsset,
  deleteKnowledgeAsset,
  getKnowledgeAsset,
  recordKnowledgeAssetAccess,
  updateKnowledgeAssetMetadata,
  upsertKnowledgeAsset,
} from '@/lib/knowledge';

export const dynamic = 'force-dynamic';

const KNOWLEDGE_DIR = join(homedir(), '.gemini', 'antigravity', 'knowledge');

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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const knowledgeDir = join(KNOWLEDGE_DIR, id);
  const metaPath = join(knowledgeDir, 'metadata.json');
  const storedAsset = getKnowledgeAsset(id);

  if (!storedAsset && !existsSync(metaPath)) {
    return NextResponse.json({ error: 'Knowledge item not found' }, { status: 404 });
  }

  try {
    if (storedAsset && !existsSync(metaPath)) {
      upsertKnowledgeAsset(storedAsset);
    }

    const meta = existsSync(metaPath)
      ? JSON.parse(readFileSync(metaPath, 'utf-8')) as Record<string, unknown>
      : {};
    let timestamps = { created: '', modified: '', accessed: '' };
    try {
      timestamps = JSON.parse(readFileSync(join(knowledgeDir, 'timestamps.json'), 'utf-8')) as typeof timestamps;
    } catch {
      // optional
    }

    const artifactsDir = join(knowledgeDir, 'artifacts');
    const artifactFiles = listArtifactFiles(artifactsDir);
    const artifacts: Record<string, string> = {};
    for (const file of artifactFiles) {
      try {
        artifacts[file] = readFileSync(join(artifactsDir, file), 'utf-8');
      } catch {
        // skip unreadable
      }
    }

    if (storedAsset) {
      recordKnowledgeAssetAccess([id]);
    }

    const base = storedAsset ? buildKnowledgeItemFromAsset(storedAsset) : {
      id,
      title: typeof meta.title === 'string' ? meta.title : id,
      summary: typeof meta.summary === 'string' ? meta.summary : '',
      references: Array.isArray(meta.references) ? meta.references as Array<{ type: string; value: string }> : [],
      timestamps,
      artifactFiles,
      workspaceUri: typeof meta.workspaceUri === 'string' ? meta.workspaceUri : undefined,
      category: typeof meta.category === 'string' ? meta.category : undefined,
      status: typeof meta.status === 'string' ? meta.status : undefined,
      usageCount: typeof meta.usageCount === 'number' ? meta.usageCount : undefined,
      lastAccessedAt: typeof meta.lastAccessedAt === 'string' ? meta.lastAccessedAt : undefined,
    };

    return NextResponse.json({
      ...base,
      summary: typeof meta.summary === 'string' ? meta.summary : base.summary,
      references: Array.isArray(meta.references) ? meta.references : base.references,
      timestamps: {
        created: timestamps.created || base.timestamps.created,
        modified: timestamps.modified || base.timestamps.modified,
        accessed: timestamps.accessed || base.timestamps.accessed,
      },
      artifactFiles,
      artifacts,
      tags: storedAsset?.tags || (Array.isArray(meta.tags) ? meta.tags.filter((tag): tag is string => typeof tag === 'string') : []),
      scope: storedAsset?.scope || (meta.scope === 'organization' ? 'organization' : meta.scope === 'department' ? 'department' : undefined),
      sourceType: storedAsset?.source.type || (meta.sourceType === 'manual' || meta.sourceType === 'ceo' || meta.sourceType === 'system' || meta.sourceType === 'run'
        ? meta.sourceType
        : undefined),
      sourceRunId: storedAsset?.source.runId || (typeof meta.sourceRunId === 'string' ? meta.sourceRunId : undefined),
      sourceArtifactPath: storedAsset?.source.artifactPath || (typeof meta.sourceArtifactPath === 'string' ? meta.sourceArtifactPath : undefined),
      confidence: storedAsset?.confidence || (typeof meta.confidence === 'number' ? meta.confidence : undefined),
      evidenceCount: storedAsset?.evidence?.refs.length || (typeof meta.evidenceCount === 'number' ? meta.evidenceCount : undefined),
      promotionLevel: storedAsset?.promotion?.level || (typeof meta.promotionLevel === 'string' ? meta.promotionLevel : undefined),
      promotionSourceCandidateId: storedAsset?.promotion?.sourceCandidateId || (typeof meta.promotionSourceCandidateId === 'string' ? meta.promotionSourceCandidateId : undefined),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const knowledgeDir = join(KNOWLEDGE_DIR, id);
  const metaPath = join(knowledgeDir, 'metadata.json');
  const storedAsset = getKnowledgeAsset(id);

  if (!storedAsset && !existsSync(metaPath)) {
    return NextResponse.json({ error: 'Knowledge item not found' }, { status: 404 });
  }

  try {
    const body = await req.json();
    const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf-8')) : {};

    if (body.title !== undefined) meta.title = body.title;
    if (body.summary !== undefined) meta.summary = body.summary;

    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    if (storedAsset) {
      updateKnowledgeAssetMetadata(id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
      });
    }

    const tsPath = join(knowledgeDir, 'timestamps.json');
    let timestamps = { created: '', modified: '', accessed: '' };
    try {
      timestamps = JSON.parse(readFileSync(tsPath, 'utf-8'));
    } catch {
      // optional
    }
    timestamps.modified = new Date().toISOString();
    writeFileSync(tsPath, JSON.stringify(timestamps, null, 2), 'utf-8');

    return NextResponse.json({ ok: true, title: meta.title, summary: meta.summary });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const knowledgeDir = join(KNOWLEDGE_DIR, id);
  const storedAsset = getKnowledgeAsset(id);

  if (!storedAsset && !existsSync(knowledgeDir)) {
    return NextResponse.json({ error: 'Knowledge item not found' }, { status: 404 });
  }

  try {
    if (storedAsset) {
      deleteKnowledgeAsset(id);
    }
    rmSync(knowledgeDir, { recursive: true, force: true });
    return NextResponse.json({ ok: true, deleted: id });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
