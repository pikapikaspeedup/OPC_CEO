/**
 * Unified Dispatch Service
 *
 * Single execution path for all dispatch sources:
 *   - CEO command (GlobalCommandBar / QuickTaskInput)
 *   - team-dispatch workflow (Copilot + curl)
 *   - Frontend manual dispatch (ProjectsPanel)
 *
 * Ensures consistent behavior: dispatchRun + addRunToProject + initializePipelineState.
 */

import { dispatchRun } from './group-runtime';
import { getGroup } from './group-registry';
import { getRun } from './run-registry';
import { AssetLoader } from './asset-loader';
import { getDownstreamStages } from './pipeline/pipeline-registry';
import { resolveStageId } from './pipeline/pipeline-graph';
import {
  addRunToProject,
  initializePipelineState,
  trackStageDispatch,
} from './project-registry';
import { createLogger } from '../logger';

const log = createLogger('DispatchService');

// ---------------------------------------------------------------------------
// Input & Output types
// ---------------------------------------------------------------------------

export interface ExecuteDispatchInput {
  groupId?: string;
  workspace: string;
  prompt?: string;
  model?: string;
  parentConversationId?: string;
  taskEnvelope?: {
    goal?: string;
    inputArtifacts?: Array<{ path: string; label?: string }>;
    [key: string]: unknown;
  };
  sourceRunIds?: string[];
  projectId?: string;
  /** Can be passed as `templateId` or `pipelineId` — both are accepted. */
  pipelineId?: string;
  templateId?: string;
  pipelineStageId?: string;
  pipelineStageIndex?: number;
  templateOverrides?: Record<string, unknown>;
  conversationMode?: 'shared' | 'isolated';
}

export interface ExecuteDispatchResult {
  runId: string;
}

export class DispatchError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'DispatchError';
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Core dispatch function
// ---------------------------------------------------------------------------

/**
 * Execute a dispatch — the single source of truth for running agent tasks.
 *
 * This function:
 *   1. Resolves templateId → groupId + pipelineStageId (if needed)
 *   2. Validates source contracts
 *   3. Calls `dispatchRun()` to start the run
 *   4. Links run to project (`addRunToProject`)
 *   5. Initializes pipeline state (`initializePipelineState`)
 *   6. Tracks stage dispatch (`trackStageDispatch`)
 */
export async function executeDispatch(input: ExecuteDispatchInput): Promise<ExecuteDispatchResult> {
  let finalGroupId = input.groupId;
  let finalPipelineStageId = input.pipelineStageId;
  let finalPipelineStageIndex = input.pipelineStageIndex;
  const finalPipelineId = input.pipelineId || input.templateId;

  // ── Step 1: Resolve template → groupId ──
  if (!finalGroupId && finalPipelineId) {
    const template = AssetLoader.getTemplate(finalPipelineId);
    if (!template) {
      throw new DispatchError(`Template not found: ${finalPipelineId}`);
    }
    if ((!template.pipeline || template.pipeline.length === 0) && !template.graphPipeline) {
      throw new DispatchError(`Template ${finalPipelineId} has no pipeline stages`);
    }

    // Auto-resolve from source run
    if (!finalPipelineStageId && finalPipelineStageIndex === undefined && input.sourceRunIds?.length) {
      const sourceRun = getRun(input.sourceRunIds[0]);
      if (sourceRun?.pipelineStageId) {
        const downstreams = getDownstreamStages(finalPipelineId, sourceRun.pipelineStageId);
        if (downstreams.length === 1) {
          finalPipelineStageId = resolveStageId(downstreams[0]);
          finalGroupId = downstreams[0].groupId;
        }
      } else if (sourceRun?.pipelineStageIndex !== undefined) {
        finalPipelineStageIndex = sourceRun.pipelineStageIndex + 1;
      }
    }

    if (!finalPipelineStageId && finalPipelineStageIndex === undefined) {
      finalPipelineStageIndex = 0;
    }

    if (template.pipeline) {
      const stageDef = finalPipelineStageId
        ? template.pipeline.find((stage: any) => resolveStageId(stage) === finalPipelineStageId)
        : template.pipeline[finalPipelineStageIndex!];
      if (!stageDef) {
        throw new DispatchError(`Pipeline stage is out of bounds for template ${finalPipelineId}`);
      }
      finalPipelineStageId = resolveStageId(stageDef);
      finalPipelineStageIndex = template.pipeline.findIndex((stage: any) => resolveStageId(stage) === finalPipelineStageId);
      finalGroupId = stageDef.groupId || stageDef.stageId;
    } else if (template.graphPipeline) {
      const node = finalPipelineStageId
        ? template.graphPipeline.nodes.find((n: any) => n.id === finalPipelineStageId)
        : template.graphPipeline.nodes.find((n: any) => n.autoTrigger);
      if (!node) {
        throw new DispatchError(`No matching internal node found for template ${finalPipelineId}`);
      }
      finalPipelineStageId = node.id;
      finalGroupId = node.groupId || node.id;
    }
  } else {
    // groupId provided — still try to resolve downstream if source info given
    if (!finalPipelineStageId && finalPipelineStageIndex === undefined && finalPipelineId && input.sourceRunIds?.length) {
      const sourceRun = getRun(input.sourceRunIds[0]);
      if (sourceRun?.pipelineStageId) {
        const downstreams = getDownstreamStages(finalPipelineId, sourceRun.pipelineStageId);
        if (downstreams.length === 1) {
          finalPipelineStageId = resolveStageId(downstreams[0]);
          finalGroupId = finalGroupId || downstreams[0].groupId;
        }
      } else if (sourceRun?.pipelineStageIndex !== undefined) {
        finalPipelineStageIndex = sourceRun.pipelineStageIndex + 1;
      }
    }
  }

  // ── Step 2: Validate ──
  if (!finalGroupId) {
    throw new DispatchError('Missing required field: groupId (or pipelineId/templateId)');
  }
  if (!input.workspace) {
    throw new DispatchError('Missing required field: workspace');
  }

  const goal = input.taskEnvelope?.goal || input.prompt;
  if (!goal) {
    throw new DispatchError('Either prompt or taskEnvelope.goal is required');
  }

  // Source contract validation
  const group = getGroup(finalGroupId);
  if (group?.sourceContract) {
    if (!input.sourceRunIds || input.sourceRunIds.length === 0) {
      throw new DispatchError(`Group ${finalGroupId} requires sourceRunIds per its source contract`);
    }
    if (!group.sourceContract.autoBuildInputArtifactsFromSources) {
      if (!input.taskEnvelope?.inputArtifacts?.length) {
        throw new DispatchError(`Group ${finalGroupId} requires inputArtifacts (source contract does not auto-build)`);
      }
    }
  } else if (group?.capabilities?.requiresInputArtifacts) {
    if (!input.taskEnvelope?.inputArtifacts?.length) {
      throw new DispatchError(`Group ${finalGroupId} requires inputArtifacts from an approved source run`);
    }
  }

  // ── Step 3: Dispatch ──
  log.info({
    groupId: finalGroupId,
    workspace: input.workspace.split('/').pop(),
    goalLength: (goal as string).length,
    hasEnvelope: !!input.taskEnvelope,
    pipelineId: finalPipelineId,
    model: input.model,
  }, 'Dispatching run');

  const result = await dispatchRun({
    groupId: finalGroupId,
    workspace: input.workspace,
    prompt: goal as string,
    model: input.model,
    parentConversationId: input.parentConversationId,
    taskEnvelope: input.taskEnvelope,
    sourceRunIds: input.sourceRunIds,
    projectId: input.projectId,
    pipelineId: finalPipelineId,
    pipelineStageId: finalPipelineStageId,
    pipelineStageIndex: finalPipelineStageIndex,
    conversationMode: input.conversationMode,
  });

  // ── Step 4: Link to project ──
  if (input.projectId) {
    addRunToProject(input.projectId, result.runId);

    if (finalPipelineId) {
      initializePipelineState(input.projectId, finalPipelineId, input.templateOverrides);

      if (finalPipelineStageId) {
        trackStageDispatch(input.projectId, finalPipelineStageId, result.runId);
      } else if (finalPipelineStageIndex !== undefined) {
        trackStageDispatch(input.projectId, finalPipelineStageIndex, result.runId);
      }
    }
  }

  return { runId: result.runId };
}
