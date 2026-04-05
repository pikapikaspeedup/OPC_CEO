export type ProjectStatus = 'active' | 'completed' | 'failed' | 'cancelled' | 'paused' | 'archived';

// ---------------------------------------------------------------------------
// Pipeline Stage Progress — tracks each stage within a Project's pipeline
// ---------------------------------------------------------------------------

export type PipelineStageStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'skipped';

export interface PipelineStageProgress {
  stageId: string;
  groupId: string;
  stageIndex: number;
  runId?: string;
  status: PipelineStageStatus;
  attempts: number;
  branches?: BranchProgress[];
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
  /** Gate approval state (V5.2 — only for gate nodes) */
  gateApproval?: GateApproval;
}

export interface GateApproval {
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  reason?: string;
  decidedAt?: string;
}

export interface BranchProgress {
  branchIndex: number;
  workPackageId: string;
  workPackageName: string;
  subProjectId: string;
  runId?: string;
  status: PipelineStageStatus;
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ProjectPipelineState {
  templateId: string;
  stages: PipelineStageProgress[];
  activeStageIds: string[];
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  /** Loop iteration counters. key = loop-start nodeId, value = current iteration (V5.2) */
  loopCounters?: Record<string, number>;
  /** Most recent checkpoint ID (V5.2) */
  lastCheckpointId?: string;
  /** Runtime overrides applied on top of the template at dispatch time (V5.3) */
  templateOverrides?: Record<string, unknown>;
}

/** CEO AI decision record — persisted with the project so UI can display it */
export interface CEODecisionRecord {
  /** The original CEO command */
  command: string;
  /** LLM decision action taken */
  action: string;
  /** LLM reasoning text */
  reasoning: string;
  /** Which department was selected */
  departmentName?: string;
  /** Which template was selected/suggested */
  templateId?: string;
  /** User-facing message */
  message: string;
  /** Pending suggestions (for needs_decision action) */
  suggestions?: Array<{
    type: string;
    label: string;
    description: string;
    payload?: Record<string, string>;
  }>;
  /** Whether the decision has been acted on by the user */
  resolved: boolean;
  /** Timestamp of the decision */
  decidedAt: string;
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
  parentProjectId?: string;
  parentStageId?: string;
  branchIndex?: number;
  /** OPC: project execution type */
  projectType?: 'coordinated' | 'adhoc' | 'strategic';
  /** OPC: skill hint for ad-hoc tasks */
  skillHint?: string;
  /** OPC: priority level */
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  /** Phase 6: CEO AI decision record */
  ceoDecision?: CEODecisionRecord;
}
