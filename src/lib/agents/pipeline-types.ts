import type { GroupDefinition } from './group-types';

export interface PipelineStage {
  /** Which agent group to run at this stage */
  groupId: string;
  /** Automatically dispatch this stage when the previous stage completes? */
  autoTrigger: boolean;
  /** What outcome from the previous stage triggers this stage (default: 'approved') */
  triggerOn?: 'approved' | 'completed' | 'any';
  /** Optional prompt template override for this stage */
  promptTemplate?: string;
}

/**
 * TemplateDefinition — a first-class configuration entity.
 * 
 * A template is a complete solution package that includes:
 * - Groups (the teams, with their roles, capabilities, and review policies)
 * - Pipeline (the execution order and auto-trigger rules)
 * 
 * Workflows (role instructions) are reusable assets referenced by path.
 * Templates are NOT shared — need a new scenario, create a new template.
 */
export interface TemplateDefinition {
  id: string;
  kind: 'template';
  title: string;
  description: string;
  /** Groups defined within this template, keyed by groupId */
  groups: Record<string, Omit<GroupDefinition, 'id' | 'templateId' | 'defaultModel'>>;
  /** Ordered pipeline stages — defines execution order */
  pipeline: PipelineStage[];
  /** Default model for all groups in this template */
  defaultModel?: string;
}

// Re-export for backward compat
export type { PipelineStage as PipelineStageDefinition };
