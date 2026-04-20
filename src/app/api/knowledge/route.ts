import { NextResponse } from 'next/server';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export const dynamic = 'force-dynamic';

const KNOWLEDGE_DIR = join(homedir(), '.gemini', 'antigravity', 'knowledge');

interface KnowledgeItem {
  id: string;
  title: string;
  summary: string;
  references: Array<{ type: string; value: string }>;
  timestamps: { created: string; modified: string; accessed: string };
  artifactFiles: string[];
  workspaceUri?: string;
  category?: string;
  status?: string;
  usageCount?: number;
  lastAccessedAt?: string;
}

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
  } catch { /* dir missing */ }
  return files;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const workspaceFilter = url.searchParams.get('workspace') || undefined;
    const categoryFilter = url.searchParams.get('category') || undefined;
    const limit = Number(url.searchParams.get('limit') || 0);
    const entries = readdirSync(KNOWLEDGE_DIR, { withFileTypes: true });
    const items: KnowledgeItem[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const kiDir = join(KNOWLEDGE_DIR, entry.name);
      const metaPath = join(kiDir, 'metadata.json');
      const tsPath = join(kiDir, 'timestamps.json');

      try {
        statSync(metaPath);
      } catch {
        continue; // skip dirs without metadata
      }

      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      let timestamps = { created: '', modified: '', accessed: '' };
      try {
        timestamps = JSON.parse(readFileSync(tsPath, 'utf-8'));
      } catch { /* optional */ }

      const artifactFiles = listArtifactFiles(join(kiDir, 'artifacts'));

      items.push({
        id: entry.name,
        title: meta.title || entry.name,
        summary: meta.summary || '',
        references: meta.references || [],
        timestamps,
        artifactFiles,
        workspaceUri: typeof meta.workspaceUri === 'string' ? meta.workspaceUri : undefined,
        category: typeof meta.category === 'string' ? meta.category : undefined,
        status: typeof meta.status === 'string' ? meta.status : undefined,
        usageCount: typeof meta.usageCount === 'number' ? meta.usageCount : undefined,
        lastAccessedAt: typeof meta.lastAccessedAt === 'string' ? meta.lastAccessedAt : undefined,
      });
    }

    // Sort by last accessed (most recent first)
    items.sort((a, b) => {
      const ta = new Date(a.timestamps.accessed || 0).getTime();
      const tb = new Date(b.timestamps.accessed || 0).getTime();
      return tb - ta;
    });

    const filtered = items.filter((item) => {
      if (workspaceFilter && item.workspaceUri !== workspaceFilter) return false;
      if (categoryFilter && item.category !== categoryFilter) return false;
      return true;
    });

    return NextResponse.json(limit > 0 ? filtered.slice(0, limit) : filtered);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
