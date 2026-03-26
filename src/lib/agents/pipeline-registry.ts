import { createLogger } from '../logger';
import { AssetLoader } from './asset-loader';
import type { PipelineStage, TemplateDefinition } from './pipeline-types';

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
 */
export function getNextStage(templateId: string, currentGroupId: string): {
  stage: PipelineStage;
  stageIndex: number;
} | null {
  const template = AssetLoader.getTemplate(templateId);
  if (!template) return null;

  const currentIdx = template.pipeline.findIndex(s => s.groupId === currentGroupId);
  if (currentIdx < 0 || currentIdx >= template.pipeline.length - 1) return null;

  const nextStage = template.pipeline[currentIdx + 1];
  return { stage: nextStage, stageIndex: currentIdx + 1 };
}

export function reloadPipelines(): void {
  AssetLoader.reloadTemplates();
}
