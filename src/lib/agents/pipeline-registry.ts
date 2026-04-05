import { createLogger } from '../logger';
import { AssetLoader } from './asset-loader';
import { getGroup } from './group-registry';
import { getRun } from './run-registry';
import type { ProjectPipelineState } from './project-types';
import { resolveStageId } from './pipeline-graph';
import type { PipelineStage, TemplateDefinition } from './pipeline-types';
import { getOrCompileIR } from './dag-compiler';
import { canActivateNode, getDownstreamNodes, filterSourcesByNode as irFilterSources } from './dag-runtime';

const log = createLogger('PipelineRegistry');

/**
 * List all available templates (each template IS a pipeline).
 */
export function listPipelines(): TemplateDefinition[] {
  return AssetLoader.loadAllTemplates();
}

/**
 * Get a template by its ID.
 */
export function getPipeline(id: string): TemplateDefinition | null {
  return AssetLoader.getTemplate(id);
}

/**
 * Given a template and the current stage's groupId, return the next stage (if any).
 * Returns null if the template pipeline is finished or the groupId is not found.
 *
 * Internally delegates to DAG IR for traversal (V5.0).
 */
export function getDownstreamStages(templateId: string, currentStageId: string): PipelineStage[] {
  const template = AssetLoader.getTemplate(templateId);
  if (!template) return [];

  const ir = getOrCompileIR(template);
  const downstreamNodes = getDownstreamNodes(ir, currentStageId);

  // Map IR nodes back to PipelineStage for backward compatibility
  return downstreamNodes
    .map(node => {
      if (template.pipeline) {
        return template.pipeline.find(s => resolveStageId(s) === node.id);
      } else if (template.graphPipeline) {
        return template.graphPipeline.nodes.find((n: any) => n.id === node.id) as any;
      }
      return undefined;
    })
    .filter((s): s is PipelineStage => !!s);
}

/**
 * Check whether a stage can be activated given the current project state.
 *
 * Internally delegates to DAG IR activation logic (V5.0).
 */
export function canActivateStage(
  template: TemplateDefinition,
  stage: PipelineStage,
  projectState: ProjectPipelineState,
): { ready: boolean; missingUpstreams: string[] } {
  const ir = getOrCompileIR(template);
  const stageId = resolveStageId(stage);
  const activation = canActivateNode(ir, stageId, projectState);
  return {
    ready: activation.canActivate,
    missingUpstreams: activation.pendingUpstreamIds,
  };
}

/**
 * Filter source run IDs by the target group's sourceContract.
 *
 * Internally delegates to DAG IR source filtering (V5.0).
 */
export function filterSourcesByContract(targetGroupId: string, allSourceRunIds: string[]): string[] {
  if (allSourceRunIds.length === 0) return allSourceRunIds;
  const group = getGroup(targetGroupId);
  const acceptedSourceGroupIds = group?.sourceContract?.acceptedSourceGroupIds;
  if (!acceptedSourceGroupIds?.length) {
    return allSourceRunIds;
  }

  const accepted = new Set(acceptedSourceGroupIds);
  return allSourceRunIds.filter(runId => {
    const run = getRun(runId);
    return !!run && accepted.has(run.groupId);
  });
}

export function reloadPipelines(): void {
  AssetLoader.reloadTemplates();
}
