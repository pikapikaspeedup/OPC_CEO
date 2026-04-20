import type { PromptModeResolution, TaskResult } from '../agents/group-types';
import { appendCEOEvent } from '../organization/ceo-event-store';

import type { KnowledgeAsset } from './contracts';
import { extractKnowledgeAssetsFromRun } from './extractor';
import { logKnowledgePersistence, upsertKnowledgeAsset } from './store';

export type { KnowledgeAsset, KnowledgeCategory, KnowledgeListQuery, KnowledgeScope, KnowledgeStatus } from './contracts';
export { buildKnowledgeSummary } from './contracts';
export { extractKnowledgeAssetsFromRun } from './extractor';
export { formatKnowledgeAssetsForPrompt, retrieveKnowledgeAssets } from './retrieval';
export {
  buildKnowledgeItemFromAsset,
  deleteKnowledgeAsset,
  getKnowledgeAsset,
  listKnowledgeAssets,
  listLegacyFilesystemKnowledgeIds,
  listRecentKnowledgeAssets,
  updateKnowledgeAssetArtifact,
  updateKnowledgeAssetMetadata,
  upsertKnowledgeAsset,
} from './store';

export interface PersistKnowledgeForRunInput {
  runId: string;
  workspaceUri?: string;
  result: TaskResult;
  promptResolution?: PromptModeResolution;
  resolvedWorkflowRef?: string;
  resolvedSkillRefs?: string[];
  createdAt?: string;
}

export function persistKnowledgeForRun(input: PersistKnowledgeForRunInput): KnowledgeAsset[] {
  const assets = extractKnowledgeAssetsFromRun({
    runId: input.runId,
    workspaceUri: input.workspaceUri,
    result: input.result,
    promptResolution: input.promptResolution,
    resolvedWorkflowRef: input.resolvedWorkflowRef,
    resolvedSkillRefs: input.resolvedSkillRefs,
    createdAt: input.createdAt,
  });

  for (const asset of assets) {
    upsertKnowledgeAsset(asset);
  }

  if (assets.length > 0) {
    logKnowledgePersistence(input.runId, assets.length);
    appendCEOEvent({
      kind: 'knowledge',
      level: 'info',
      title: `新增 ${assets.length} 条知识资产`,
      description: assets.map((asset) => asset.title).slice(0, 3).join('，'),
      ...(input.workspaceUri ? { workspaceUri: input.workspaceUri } : {}),
      meta: {
        runId: input.runId,
        assetIds: assets.map((asset) => asset.id),
      },
    });
  }

  return assets;
}
