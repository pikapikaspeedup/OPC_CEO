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
import { getRun } from './run-registry';
import { AssetLoader } from './asset-loader';
import { getDownstreamStages } from './pipeline/pipeline-registry';
import { resolveStageId } from './pipeline/pipeline-graph';
import { getStageDefinition } from './stage-resolver';
import { buildTemplateProviderExecutionContext } from './department-execution-resolver';
import {
  addRunToProject,
  initializePipelineState,
  trackStageDispatch,
} from './project-registry';
import type { TriggerContext } from './group-types';
import { createLogger } from '../logger';

const log = createLogger('DispatchService');

// ---------------------------------------------------------------------------
// Input & Output types
// ---------------------------------------------------------------------------

export interface ExecuteDispatchInput {
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
  stageId?: string;
  pipelineStageId?: string;
  pipelineStageIndex?: number;
  templateOverrides?: Record<string, unknown>;
  conversationMode?: 'shared' | 'isolated';
  /** V6.1: Explicit provider override (bypasses resolveProvider). */
  provider?: string;
  triggerContext?: TriggerContext;
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
 *   1. Resolves templateId → stageId + pipelineStageId (if needed)
 *   2. Validates source contracts
 *   3. Calls `dispatchRun()` to start the run
 *   4. Links run to project (`addRunToProject`)
 *   5. Initializes pipeline state (`initializePipelineState`)
 *   6. Tracks stage dispatch (`trackStageDispatch`)
 */
export async function executeDispatch(input: ExecuteDispatchInput): Promise<ExecuteDispatchResult> {
  let finalStageId = input.stageId || input.pipelineStageId;
  let finalPipelineStageId = input.pipelineStageId;
  let finalPipelineStageIndex = input.pipelineStageIndex;
  const finalPipelineId = input.pipelineId || input.templateId;
  const workspacePath = input.workspace.replace(/^file:\/\//, '');

  if (!finalPipelineId) {
    throw new DispatchError('Missing required field: templateId');
  }

  // ── Step 1: Resolve template → stageId ──
  if (finalPipelineId) {
    const template = AssetLoader.getTemplate(finalPipelineId);
    if (!template) {
      throw new DispatchError(`Template not found: ${finalPipelineId}`);
    }
    if ((!template.pipeline || template.pipeline.length === 0) && !template.graphPipeline) {
      throw new DispatchError(`Template ${finalPipelineId} has no pipeline stages`);
    }

    // Auto-resolve from source run
    if (!finalStageId && !finalPipelineStageId && finalPipelineStageIndex === undefined && input.sourceRunIds?.length) {
      const sourceRun = getRun(input.sourceRunIds[0]);
      const sourceStageId = sourceRun?.pipelineStageId || sourceRun?.stageId;
      if (sourceStageId) {
        const downstreams = getDownstreamStages(finalPipelineId, sourceStageId);
        if (downstreams.length === 1) {
          finalPipelineStageId = resolveStageId(downstreams[0]);
          finalStageId = finalPipelineStageId;
        }
      } else if (sourceRun?.pipelineStageIndex !== undefined) {
        finalPipelineStageIndex = sourceRun.pipelineStageIndex + 1;
      }
    }

    if (!finalStageId && !finalPipelineStageId && finalPipelineStageIndex === undefined) {
      if (template.pipeline?.length) {
        finalPipelineStageIndex = 0;
      } else if (template.graphPipeline?.nodes.length) {
        finalStageId = template.graphPipeline.nodes.find((node: any) => node.autoTrigger !== false)?.id || template.graphPipeline.nodes[0].id;
      }
    }

    if (template.pipeline) {
      const resolvedStageId = finalStageId || finalPipelineStageId;
      const stageDef = resolvedStageId
        ? template.pipeline.find((stage: any) => resolveStageId(stage) === resolvedStageId)
        : template.pipeline[finalPipelineStageIndex!];
      if (!stageDef) {
        throw new DispatchError(`Pipeline stage is out of bounds for template ${finalPipelineId}`);
      }
      finalPipelineStageId = resolveStageId(stageDef);
      finalStageId = finalPipelineStageId;
      finalPipelineStageIndex = template.pipeline.findIndex((stage: any) => resolveStageId(stage) === finalPipelineStageId);
    } else if (template.graphPipeline) {
      const resolvedStageId = finalStageId || finalPipelineStageId;
      const node = resolvedStageId
        ? template.graphPipeline.nodes.find((n: any) => n.id === resolvedStageId)
        : template.graphPipeline.nodes.find((n: any) => n.autoTrigger);
      if (!node) {
        throw new DispatchError(`No matching internal node found for template ${finalPipelineId}`);
      }
      finalPipelineStageId = node.id;
      finalStageId = node.id;
    }
  }

  // ── Step 2: Validate ──
  if (!finalStageId) {
    throw new DispatchError('Missing required field: stageId');
  }
  if (!input.workspace) {
    throw new DispatchError('Missing required field: workspace');
  }

  const goal = input.taskEnvelope?.goal || input.prompt;
  if (!goal) {
    throw new DispatchError('Either prompt or taskEnvelope.goal is required');
  }

  const templateExecutionContext = buildTemplateProviderExecutionContext(workspacePath, finalPipelineId);

  // Source contract validation
  const stage = getStageDefinition(finalPipelineId, finalStageId);
  if (!stage) {
    throw new DispatchError(`Stage not found: ${finalPipelineId}/${finalStageId}`, 404);
  }
  if (stage.sourceContract) {
    if (!input.sourceRunIds || input.sourceRunIds.length === 0) {
      throw new DispatchError(`Stage ${finalStageId} requires sourceRunIds per its source contract`);
    }
    if (!stage.sourceContract.autoBuildInputArtifactsFromSources) {
      if (!input.taskEnvelope?.inputArtifacts?.length) {
        throw new DispatchError(`Stage ${finalStageId} requires inputArtifacts (source contract does not auto-build)`);
      }
    }
  } else if (stage.capabilities?.requiresInputArtifacts) {
    if (!input.taskEnvelope?.inputArtifacts?.length) {
      throw new DispatchError(`Stage ${finalStageId} requires inputArtifacts from an approved source run`);
    }
  }

  // ── Step 3: Dispatch ──
  log.info({
    stageId: finalStageId,
    workspace: input.workspace.split('/').pop(),
    goalLength: (goal as string).length,
    hasEnvelope: !!input.taskEnvelope,
    templateId: finalPipelineId,
    model: input.model,
  }, 'Dispatching run');

  const result = await dispatchRun({
    stageId: finalStageId,
    workspace: input.workspace,
    prompt: goal as string,
    model: input.model,
    parentConversationId: input.parentConversationId,
    taskEnvelope: input.taskEnvelope as any,
    sourceRunIds: input.sourceRunIds,
    projectId: input.projectId,
    pipelineId: finalPipelineId,
    templateId: finalPipelineId,
    pipelineStageId: finalPipelineStageId,
    pipelineStageIndex: finalPipelineStageIndex,
    conversationMode: input.conversationMode,
    provider: input.provider,
    triggerContext: input.triggerContext,
    promptPreamble: templateExecutionContext.promptPreamble,
    resolutionReason: templateExecutionContext.resolutionReason,
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
