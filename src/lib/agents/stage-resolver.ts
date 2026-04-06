import { AssetLoader } from './asset-loader';
import type { StageDefinition } from './group-types';
import type { TemplateDefinition } from './pipeline/pipeline-types';
import { getTemplateNode, listTemplateNodes, resolveStageDefinition as resolveTemplateStageDefinition } from './pipeline/template-normalizer';

export function listTemplateStages(templateId: string): StageDefinition[] {
  const template = AssetLoader.getTemplate(templateId);
  if (!template) return [];
  return listTemplateNodes(template).map((node) => resolveTemplateStageDefinition(template, 'stageId' in node ? node.stageId : node.id)!).filter(Boolean);
}

export function getStageDefinition(templateId: string, stageId: string): StageDefinition | null {
  const template = AssetLoader.getTemplate(templateId);
  if (!template) return null;
  return resolveTemplateStageDefinition(template, stageId);
}

export function getStageNode(templateId: string, stageId: string) {
  const template = AssetLoader.getTemplate(templateId);
  if (!template) return null;
  return getTemplateNode(template, stageId);
}

export function getStageNodeFromTemplate(template: TemplateDefinition, stageId: string) {
  return getTemplateNode(template, stageId);
}
