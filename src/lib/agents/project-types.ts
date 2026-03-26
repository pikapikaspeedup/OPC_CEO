export type ProjectStatus = 'active' | 'completed' | 'failed' | 'cancelled' | 'paused' | 'archived';

// ---------------------------------------------------------------------------
// Pipeline Stage Progress — tracks each stage within a Project's pipeline
// ---------------------------------------------------------------------------

export type PipelineStageStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'skipped';

export interface PipelineStageProgress {
  groupId: string;
  stageIndex: number;
  runId?: string;
  status: PipelineStageStatus;
  attempts: number;
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ProjectPipelineState {
  templateId: string;
  stages: PipelineStageProgress[];
  currentStageIndex: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
}

export interface ProjectDefinition {
  projectId: string;
  name: string;
  goal: string;
  templateId?: string;
  workspace?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  runIds: string[];
  pipelineState?: ProjectPipelineState;
}
