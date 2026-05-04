import type { PromptModeResolution, TaskResult } from '../agents/group-types';
import type { AgentRunState } from '../agents/group-types';
import { processRunCapsuleForMemory } from '../company-kernel/memory-promotion';
import { observeMemoryCandidateForAgenda, observeRunCapsuleForAgenda } from '../company-kernel/operating-integration';
import { rebuildRunCapsuleFromRun } from '../company-kernel/run-capsule-store';
import { appendCEOEvent } from '../organization/ceo-event-store';
import { getRunRecord } from '../storage/gateway-db';

import type { KnowledgeAsset } from './contracts';
import { logKnowledgePersistence } from './store';

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
  recordKnowledgeAssetAccess,
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

function buildRunForKnowledgePersistence(input: PersistKnowledgeForRunInput): AgentRunState {
  const stored = getRunRecord(input.runId);
  return {
    ...(stored || {
      runId: input.runId,
      stageId: 'prompt',
      workspace: input.workspaceUri || '',
      prompt: '',
      status: input.result.status === 'completed' ? 'completed' : input.result.status,
      createdAt: input.createdAt || new Date().toISOString(),
    }),
    workspace: stored?.workspace || input.workspaceUri || '',
    status: stored?.status || (input.result.status === 'completed' ? 'completed' : input.result.status),
    result: input.result,
    promptResolution: input.promptResolution || stored?.promptResolution,
    resolvedWorkflowRef: input.resolvedWorkflowRef || stored?.resolvedWorkflowRef,
    resolvedSkillRefs: input.resolvedSkillRefs || stored?.resolvedSkillRefs,
    finishedAt: stored?.finishedAt || input.createdAt || new Date().toISOString(),
  };
}

export function persistKnowledgeForRun(input: PersistKnowledgeForRunInput): KnowledgeAsset[] {
  const run = buildRunForKnowledgePersistence(input);
  const capsule = rebuildRunCapsuleFromRun(run);
  observeRunCapsuleForAgenda(capsule);
  const { candidates, promotedAssets } = processRunCapsuleForMemory(capsule, {
    autoPromote: false,
  });
  for (const candidate of candidates) {
    observeMemoryCandidateForAgenda(candidate);
  }

  if (promotedAssets.length > 0) {
    logKnowledgePersistence(input.runId, promotedAssets.length);
    appendCEOEvent({
      kind: 'knowledge',
      level: 'info',
      title: `新增 ${promotedAssets.length} 条知识资产`,
      description: promotedAssets.map((asset) => asset.title).slice(0, 3).join('，'),
      ...(input.workspaceUri ? { workspaceUri: input.workspaceUri } : {}),
      meta: {
        runId: input.runId,
        assetIds: promotedAssets.map((asset) => asset.id),
      },
    });
  }

  if (candidates.length > 0) {
    appendCEOEvent({
      kind: 'knowledge',
      level: 'info',
      title: `新增 ${candidates.length} 条记忆候选`,
      description: candidates.map((candidate) => candidate.title).slice(0, 3).join('，'),
      ...(input.workspaceUri ? { workspaceUri: input.workspaceUri } : {}),
      meta: {
        runId: input.runId,
        candidateIds: candidates.map((candidate) => candidate.id),
      },
    });
  }

  return promotedAssets;
}
