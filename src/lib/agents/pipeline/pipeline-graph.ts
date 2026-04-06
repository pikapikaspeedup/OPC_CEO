import type { PipelineStage, TemplateDefinition } from './pipeline-types';
import { validateTemplateContracts } from '../contract-validator';

export function resolveStageId(stage: PipelineStage): string {
  return stage.stageId || stage.groupId || '';
}

export function getStageIndex(template: TemplateDefinition, stageId: string): number {
  return (template.pipeline ?? []).findIndex(stage => resolveStageId(stage) === stageId);
}

export function validateTemplatePipeline(template: TemplateDefinition): string[] {
  const errors: string[] = [];
  const stageIds = new Set<string>();

  for (const stage of template.pipeline || []) {
    const stageId = resolveStageId(stage);
    if (stageIds.has(stageId)) {
      errors.push(`Duplicate stageId: ${stageId}`);
      continue;
    }
    stageIds.add(stageId);
  }

  for (const stage of template.pipeline || []) {
    const stageId = resolveStageId(stage);
    for (const upstreamStageId of stage.upstreamStageIds || []) {
      if (!stageIds.has(upstreamStageId)) {
        errors.push(`Stage '${stageId}' references missing upstream '${upstreamStageId}'`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (stageId: string): boolean => {
    if (visiting.has(stageId)) return false;
    if (visited.has(stageId)) return true;

    visiting.add(stageId);
    const stage = (template.pipeline ?? []).find(item => resolveStageId(item) === stageId);
    for (const upstreamStageId of stage?.upstreamStageIds || []) {
      if (!visit(upstreamStageId)) {
        return false;
      }
    }

    visiting.delete(stageId);
    visited.add(stageId);
    return true;
  };

  for (const stage of template.pipeline || []) {
    const stageId = resolveStageId(stage);
    if (!visit(stageId)) {
      errors.push(`Cycle detected involving stage '${stageId}'`);
      break;
    }
  }

  // Contract validation (V4.4) — only if DAG structure is valid
  if (errors.length === 0) {
    const contractResult = validateTemplateContracts(template);
    for (const err of contractResult.errors) {
      errors.push(`[Contract] ${err.stageId}: ${err.message}`);
    }
    // Warnings are not pushed to errors — they don't block template loading
  }

  return errors;
}
