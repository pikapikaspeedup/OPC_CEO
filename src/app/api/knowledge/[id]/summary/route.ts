import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { NextResponse } from 'next/server';

import { callLLMOneshot } from '@/lib/agents/llm-oneshot';
import { getKnowledgeAsset } from '@/lib/knowledge';
import { resolveProvider } from '@/lib/providers/ai-config';

const KNOWLEDGE_DIR = join(homedir(), '.gemini', 'antigravity', 'knowledge');
const SUMMARY_SCENE = 'knowledge-summary';

function toWorkspacePath(workspaceUri?: string): string | undefined {
  if (!workspaceUri?.startsWith('file://')) {
    return undefined;
  }
  try {
    return decodeURIComponent(workspaceUri.replace(/^file:\/\//, ''));
  } catch {
    return workspaceUri.replace(/^file:\/\//, '');
  }
}

function extractJsonSummary(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('模型未返回摘要内容');
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { summary?: unknown };
      if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
        return parsed.summary.trim();
      }
    } catch {
      // fall back to raw text below
    }
  }

  return trimmed
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();
}

function updateKnowledgeSummaryMetadata(id: string, summary: string): void {
  const metaPath = join(KNOWLEDGE_DIR, id, 'metadata.json');
  if (!existsSync(metaPath)) {
    throw new Error('Knowledge metadata not found');
  }

  const metadata = JSON.parse(readFileSync(metaPath, 'utf-8')) as Record<string, unknown>;
  metadata.summary = summary;
  writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

  const timestampPath = join(KNOWLEDGE_DIR, id, 'timestamps.json');
  if (existsSync(timestampPath)) {
    const timestamps = JSON.parse(readFileSync(timestampPath, 'utf-8')) as {
      created?: string;
      modified?: string;
      accessed?: string;
    };
    timestamps.modified = new Date().toISOString();
    writeFileSync(timestampPath, JSON.stringify(timestamps, null, 2), 'utf-8');
  }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = getKnowledgeAsset(id);
  if (!asset) {
    return NextResponse.json({ error: 'Knowledge item not found' }, { status: 404 });
  }

  const workspacePath = toWorkspacePath(asset.workspaceUri);
  const resolved = resolveProvider(SUMMARY_SCENE, workspacePath);
  const prompt = [
    '你是 OPC Knowledge 的结构化编辑器。',
    '请基于下面这条知识正文，生成一段可直接展示在知识详情页顶部的结构化摘要。',
    '要求：',
    '1. 使用简体中文。',
    '2. 2 到 4 句，120 字以内。',
    '3. 说清用途、边界或风险，不要复述标题。',
    '4. 只返回 JSON：{"summary":"..."}。',
    '',
    `标题：${asset.title}`,
    `分类：${asset.category}`,
    `范围：${asset.scope}`,
    '',
    '正文：',
    asset.content.slice(0, 12_000),
  ].join('\n');

  try {
    const content = await callLLMOneshot(prompt, resolved.model, SUMMARY_SCENE);
    const summary = extractJsonSummary(content);
    updateKnowledgeSummaryMetadata(id, summary);

    return NextResponse.json({
      ok: true,
      summary,
      provider: resolved.provider,
      model: resolved.model,
      source: resolved.source,
      scene: SUMMARY_SCENE,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate knowledge summary' },
      { status: 500 },
    );
  }
}
