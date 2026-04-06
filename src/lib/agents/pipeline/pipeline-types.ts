import type { StageExecutionConfig } from '../group-types';
import type { StageContract, FanOutContract, JoinMergeContract } from '../contract-types';
import type { GraphPipeline } from './graph-pipeline-types';

export interface PipelineStage extends StageExecutionConfig {
  /** Stable stage identifier, unique within the template */
  stageId: string;
  /** Automatically dispatch this stage when the previous stage completes? */
  autoTrigger: boolean;
  /** What outcome from the previous stage triggers this stage (default: 'approved') */
  triggerOn?: 'approved' | 'completed' | 'any';
  /** Optional prompt template override for this stage */
  promptTemplate?: string;
  /** Explicit upstream dependency list. Falls back to linear previous stage when omitted. */
  upstreamStageIds?: string[];
  /** Orchestration stage type */
  stageType?: 'normal' | 'fan-out' | 'join';
  /** Fan-out configuration */
  fanOutSource?: {
    workPackagesPath: string;
    perBranchTemplateId: string;
    /** Maximum number of branches to run concurrently. Omit or 0 = unlimited. */
    maxConcurrency?: number;
  };
  /** Join configuration */
  joinFrom?: string;
  joinPolicy?: 'all';
  /** Stage data contract (V4.4) */
  contract?: StageContract;
  /** Fan-out data contract — only meaningful when stageType === 'fan-out' (V4.4) */
  fanOutContract?: FanOutContract;
  /** Join merge contract — only meaningful when stageType === 'join' (V4.4) */
  joinMergeContract?: JoinMergeContract;
  /** @deprecated Internal compatibility alias; use `stageId`. */
  groupId?: string;
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
  /** Ordered pipeline stages — defines execution order */
  pipeline?: PipelineStage[];
  /** Explicit graph definition (alternative to pipeline[], mutually exclusive; takes priority) */
  graphPipeline?: GraphPipeline;
  /** Default model for all groups in this template */
  defaultModel?: string;
  /** @deprecated Legacy template shape accepted only during load-time normalization */
  groups?: Record<string, Omit<StageExecutionConfig, 'defaultModel'>>;
}

// Re-export for backward compat
export type { PipelineStage as PipelineStageDefinition };
