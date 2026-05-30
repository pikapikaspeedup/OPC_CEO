import type { KnowledgeAsset } from './contracts';
import { listKnowledgeAssets } from './store';

export interface KnowledgeSelectionSearchInput {
  workspaceUri: string;
  promptText: string;
  workflowRef?: string;
  skillHints?: string[];
  limit?: number;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function scoreKnowledgeAsset(asset: KnowledgeAsset, input: KnowledgeSelectionSearchInput): number {
  let score = 0;
  const promptTokens = tokenize(input.promptText);
  const title = normalizeText(asset.title);
  const content = normalizeText(asset.content);
  let matched = false;

  if (input.workflowRef && asset.tags?.includes(`workflow:${input.workflowRef}`)) {
    score += 6;
    matched = true;
  }

  for (const skillHint of input.skillHints || []) {
    if (asset.tags?.includes(`skill:${skillHint}`)) {
      score += 4;
      matched = true;
    }
  }

  for (const token of promptTokens) {
    if (title.includes(token)) {
      score += 3;
      matched = true;
    } else if (content.includes(token)) {
      score += 1;
      matched = true;
    }
  }

  if (!matched) return 0;

  if (asset.category === 'decision') score += 2;
  if (asset.category === 'pattern') score += 2;
  if (asset.category === 'domain-knowledge') score += 1;

  const updatedAt = new Date(asset.updatedAt).getTime();
  if (Number.isFinite(updatedAt)) {
    const ageHours = (Date.now() - updatedAt) / (1000 * 60 * 60);
    score += Math.max(0, 2 - ageHours / 24);
  }

  return score;
}

export function searchKnowledgeAssetsForSelection(input: KnowledgeSelectionSearchInput): KnowledgeAsset[] {
  const candidates = listKnowledgeAssets({
    workspaceUri: input.workspaceUri,
    status: 'active',
    limit: 50,
  });

  const assets = candidates
    .map((asset) => ({ asset, score: scoreKnowledgeAsset(asset, input) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.asset.updatedAt.localeCompare(a.asset.updatedAt))
    .slice(0, input.limit ?? 5)
    .map((entry) => entry.asset);
  return assets;
}
