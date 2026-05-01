import type { AIProviderId } from './providers/types';

// === API Response Types ===

export interface UserInfo {
  name?: string;
  email?: string;
  hasApiKey: boolean;
  credits?: ModelsResponse | null;
  creditSource?: string | null;
  providerAwareNotice?: string | null;
  providerUsageSummary?: {
    totalRuns: number;
    providers: number;
    tokenRuns: number;
    totalTokens: number;
    windowDays: number;
  };
  providerCredits?: Array<{
    provider: string;
    category: 'runtime' | 'oauth' | 'api-key' | 'custom-profile';
    configured: boolean;
    usageTracked: boolean;
    note: string;
  }>;
}

export interface ModelConfig {
  label: string;
  modelOrAlias?: { model?: string };
  quotaInfo?: { remainingFraction?: number };
  isRecommended?: boolean;
  tagTitle?: string;
}

export interface ModelsResponse {
  clientModelConfigs?: ModelConfig[];
}

export interface Conversation {
  id: string;
  title: string;
  workspace: string;
  mtime: number;
  steps: number;
}

export interface Server {
  pid: number;
  port: number;
  csrf: string;
  workspace: string;
}

export interface Workspace {
  name: string;
  uri: string;
}

export interface WorkspacesResponse {
  workspaces: Workspace[];
  playgrounds: string[];
}

export interface PaginationQueryFE {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// OPC: Department (Workspace 增强)
// ---------------------------------------------------------------------------

export interface DepartmentSkill {
  skillId: string;
  name: string;
  category: string;
  workflowRef?: string;
  skillRefs?: string[];
  difficulty?: 'junior' | 'mid' | 'senior';
  deliverableSpec?: {
    format: string;
    qualityCriteria?: string[];
  };
}

export interface DepartmentOKR {
  period: string;
  objectives: Array<{
    title: string;
    keyResults: Array<{
      description: string;
      target: number;
      current: number;
    }>;
  }>;
}

/** Maps a roleId pattern to a display name for pixel office personification. */
export interface DepartmentRoster {
  rolePattern: string;   // regex pattern matched against roleId, e.g. "pm|product"
  displayName: string;   // human name to display, e.g. "张三"
  title?: string;        // optional job title, e.g. "产品经理"
  spriteType?: string;   // character sprite override, e.g. 'cc_nova', 'rpg_dev', 'guest_3', 'rpg_char_2'
  x?: number;            // custom canvas x position (0–1280), overrides auto-placement
  y?: number;            // custom canvas y position (0–720), overrides auto-placement
  visible?: boolean;     // whether to show in the office room (default true)
}

export interface RoomLayoutItem {
  assetKey: string;           // texture key, e.g. 'rpg_cabinet', 'lpc_tv', 'cc_coding_desk'
  x: number;                  // canvas x (0–1280)
  y: number;                  // canvas y (0–720)
  scale?: number;             // display scale (default 1)
  depth?: number;             // z-order
  frame?: number;             // spritesheet frame index
  rotation?: number;          // rotation in degrees (default 0)
}

export type DepartmentWorkspaceRole = 'primary' | 'execution' | 'context';

export interface DepartmentWorkspaceBinding {
  workspaceUri: string;
  alias?: string;
  role: DepartmentWorkspaceRole;
  writeAccess?: boolean;
}

export interface DepartmentExecutionPolicy {
  defaultWorkspaceUri?: string;
  contextDocumentPaths?: string[];
}

export interface DepartmentConfig {
  departmentId?: string;
  name: string;
  type: string;                   // e.g. 'build', 'research', 'operations', 'ceo', or user-defined
  typeIcon?: string;              // emoji icon for the department type, e.g. '🔧'
  description?: string;           // department positioning / intro, used by CEO for task routing
  templateIds?: string[];         // selected pipeline template IDs
  skills: DepartmentSkill[];
  okr?: DepartmentOKR | null;
  roster?: DepartmentRoster[];  // optional role name overrides
  roomLayout?: RoomLayoutItem[];  // preserved for backward compat
  roomBg?: string;                // preserved for backward compat
  /** V6: Default provider for this department's agent tasks */
  provider?: AIProviderId;
  /** V6: Token quota for this department */
  tokenQuota?: TokenQuota | null;
  workspaceBindings?: DepartmentWorkspaceBinding[];
  executionPolicy?: DepartmentExecutionPolicy;
}

/** V6: Token quota for a department */
export interface TokenQuota {
  daily: number;
  monthly: number;
  used: { daily: number; monthly: number };
  canRequestMore: boolean;
}

export interface TemplateExecutionTargetFE {
  kind: 'template';
  templateId: string;
  stageId?: string;
}

export interface PromptExecutionTargetFE {
  kind: 'prompt';
  promptAssetRefs?: string[];
  skillHints?: string[];
}

export interface ProjectOnlyExecutionTargetFE {
  kind: 'project-only';
}

export type ExecutionTargetFE =
  | TemplateExecutionTargetFE
  | PromptExecutionTargetFE
  | ProjectOnlyExecutionTargetFE;

export type ExecutionProfileFE =
  | {
      kind: 'workflow-run';
      workflowRef?: string;
      skillHints?: string[];
    }
  | {
      kind: 'review-flow';
      templateId: string;
      stageId?: string;
      reviewPolicyId?: string;
      roles?: string[];
    }
  | {
      kind: 'dag-orchestration';
      templateId: string;
      stageId?: string;
    };

export interface ExecutionProfileSummaryFE {
  kind: ExecutionProfileFE['kind'];
  label: string;
  detail?: string;
}

export type ExecutorKindFE = 'template' | 'prompt';

export interface TriggerContextFE {
  source?: 'ceo-command' | 'ceo-workflow' | 'scheduler' | 'mcp' | 'web' | 'api';
  schedulerJobId?: string;
  intentSummary?: string;
}

export type AgentRunStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface AgentRunResult {
  status: 'completed' | 'blocked' | 'failed' | 'cancelled' | 'timeout';
  summary: string;
  changedFiles: string[];
  blockers: string[];
  needsReview: string[];
  promptResolution?: PromptModeResolutionFE;
  reportedEventDate?: string;
  reportedEventCount?: number;
  verificationPassed?: boolean;
  reportApiResponse?: string;
}

export type ReviewDecision = 'approved' | 'revise' | 'rejected';
export type ReviewOutcome = 'approved' | 'rejected' | 'revise-exhausted';

export interface PromptResolutionEvidenceFE {
  requestedWorkflowRefs: string[];
  requestedSkillHints: string[];
  matchedWorkflowRefs: string[];
  matchedSkillRefs: string[];
}

export interface PromptWorkflowSuggestionFE {
  shouldCreateWorkflow: true;
  source: 'skill' | 'prompt';
  title: string;
  reason: string;
  recommendedScope: 'department';
  evidence: PromptResolutionEvidenceFE;
}

export interface PromptModeResolutionFE {
  mode: 'workflow' | 'skill' | 'prompt';
  requestedWorkflowRefs: string[];
  requestedSkillHints: string[];
  matchedWorkflowRefs: string[];
  matchedSkillRefs: string[];
  resolutionReason: string;
  workflowSuggestion?: PromptWorkflowSuggestionFE;
}

export type ProjectStatus = "active" | "completed" | "archived" | "failed" | "cancelled" | "paused";

// ---------------------------------------------------------------------------
// Pipeline State (Frontend projection of backend project-types.ts)
// ---------------------------------------------------------------------------

export type PipelineStageStatusFE =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'skipped';

export interface PipelineStageProgressFE {
  stageId: string;
  stageIndex: number;
  runId?: string;
  status: PipelineStageStatusFE;
  attempts: number;
  branches?: BranchProgressFE[];
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
  title?: string;
  /** V5.2: node kind for control-flow rendering */
  nodeKind?: 'stage' | 'fan-out' | 'join' | 'gate' | 'switch' | 'loop-start' | 'loop-end';
  /** V5.2: gate approval state */
  gateApproval?: { status: 'pending' | 'approved' | 'rejected'; approvedBy?: string; reason?: string; decidedAt?: string };
  /** V5.2: loop iteration count (for loop-start / loop-end) */
  loopIteration?: number;
  /** V5.2: switch selected branch label */
  switchSelectedBranch?: string;
}

export interface BranchProgressFE {
  branchIndex: number;
  workPackageId: string;
  workPackageName: string;
  subProjectId: string;
  runId?: string;
  status: PipelineStageStatusFE;
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ProjectPipelineStateFE {
  templateId: string;
  stages: PipelineStageProgressFE[];
  activeStageIds: string[];
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  /** V5.2: loop iteration counters per loop-start nodeId */
  loopCounters?: Record<string, number>;
  /** V5.2: last checkpoint ID for replay/resume */
  lastCheckpointId?: string;
}

// ---------------------------------------------------------------------------
// Template Summary (lightweight frontend-only projection)
// ---------------------------------------------------------------------------

export interface TemplateStageSummaryFE {
  title: string;
  description?: string;
  roleIds?: string[];
  executionMode?: string;
}

/** @deprecated Use TemplateStageSummaryFE directly. */
export type TemplateGroupSummary = TemplateStageSummaryFE;

export interface TemplateSummaryFE {
  id: string;
  title: string;
  stages: Record<string, TemplateStageSummaryFE>;
  pipeline: Array<{ stageId: string; title?: string; stageType?: string }>;
  /** V5.1: template format — graphPipeline templates always have a DAG */
  format?: 'pipeline' | 'graphPipeline';
}

// ---------------------------------------------------------------------------
// Template Detail (full template definition for template browser)
// ---------------------------------------------------------------------------

export interface TemplateRoleDetailFE {
  id: string;
  workflow: string;
  timeoutMs: number;
  autoApprove: boolean;
  workflowContent?: string;
}

export interface TemplateStageConfigFE {
  title?: string;
  description?: string;
  executionMode?: string;
  roles: TemplateRoleDetailFE[];
  reviewPolicyId?: string;
  capabilities?: Record<string, boolean>;
  sourceContract?: {
    acceptedSourceStageIds?: string[];
    requireReviewOutcome?: string[];
    autoBuildInputArtifactsFromSources?: boolean;
    autoIncludeUpstreamSourceRuns?: boolean;
  };
}

/** @deprecated Use TemplateStageConfigFE. */
export type TemplateGroupDetailFE = TemplateStageConfigFE;

export interface TemplateNodeFE extends TemplateStageConfigFE {
  id: string;
  kind: 'stage' | 'fan-out' | 'join' | 'gate' | 'switch' | 'loop-start' | 'loop-end' | 'subgraph-ref';
  label?: string;
  autoTrigger?: boolean;
  triggerOn?: 'approved' | 'completed' | 'any';
  gate?: { autoApprove?: boolean; approvalTimeout?: number; approvalPrompt?: string };
  fanOut?: { workPackagesPath: string; perBranchTemplateId: string; maxConcurrency?: number };
  join?: { sourceNodeId: string; policy?: 'all' };
  loop?: { maxIterations: number; pairedNodeId: string };
  /** @deprecated Legacy compatibility alias */
  groupId?: string;
}

export interface TemplateEdgeFE {
  from: string;
  to: string;
  condition?: string;
}

export type TemplatePipelineStageFE = TemplateStageConfigFE & {
  stageId: string;
  autoTrigger: boolean;
  triggerOn?: string;
  stageType?: string;
  upstreamStageIds?: string[];
  fanOutSource?: { workPackagesPath: string; perBranchTemplateId: string; maxConcurrency?: number };
  joinFrom?: string;
  joinPolicy?: string;
  /** @deprecated Legacy compatibility alias */
  groupId?: string;
};

export interface TemplateDetailFE {
  id: string;
  kind: 'template';
  title: string;
  description: string;
  stages: Record<string, TemplateStageConfigFE>;
  pipeline?: TemplatePipelineStageFE[];
  graphPipeline?: { nodes: TemplateNodeFE[]; edges: TemplateEdgeFE[] };
  defaultModel?: string;
}

// ---------------------------------------------------------------------------
// Resume API Types
// ---------------------------------------------------------------------------

export type ResumeAction = 'recover' | 'nudge' | 'restart_role' | 'cancel' | 'skip' | 'force-complete';

export interface ResumeProjectOptions {
  stageId?: string;
  stageIndex?: number;
  branchIndex?: number;
  action: ResumeAction;
  prompt?: string;
  roleId?: string;
}

export interface ResumeProjectResponse {
  status: string;
  requestedAction: ResumeAction;
  actualAction: ResumeAction;
  stageId: string;
  stageIndex: number;
  runId: string;
  branchIndex?: number;
  activeConversationId?: string;
  message?: string;
  stageTitle?: string;
}

/** Phase 6: CEO AI decision record (frontend representation) */
export interface CEODecisionRecordFE {
  command: string;
  action: string;
  reasoning: string;
  departmentName?: string;
  templateId?: string;
  message: string;
  suggestions?: Array<{
    type: string;
    label: string;
    description: string;
    payload?: Record<string, string>;
  }>;
  resolved: boolean;
  decidedAt: string;
}

export interface PlatformEngineeringProjectGovernanceFE {
  observe: boolean;
  allowProposal: boolean;
  departmentId?: string;
  source?: 'default' | 'manual' | 'proposal-created';
  updatedAt?: string;
}

export interface ProjectGovernanceFE {
  platformEngineering?: PlatformEngineeringProjectGovernanceFE;
}

export interface Project {
  projectId: string;
  name: string;
  goal: string;
  templateId?: string;
  workspace?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  runIds: string[];
  childProjectIds?: string[];
  parentProjectId?: string;
  pipelineState?: ProjectPipelineStateFE;
  /** OPC: project execution type */
  projectType?: 'coordinated' | 'adhoc' | 'strategic';
  /** OPC: skill hint for ad-hoc tasks */
  skillHint?: string;
  /** Phase 6: CEO AI decision record */
  ceoDecision?: CEODecisionRecordFE;
  governance?: ProjectGovernanceFE;
}

// ---------------------------------------------------------------------------
// OPC: DailyDigest (Phase 3)
// ---------------------------------------------------------------------------

export interface DailyDigestFE {
  workspaceUri: string;
  departmentName: string;
  date: string;
  period?: 'day' | 'week' | 'month';
  summary: string;
  tasksCompleted: Array<{ projectId: string; projectName: string; description: string }>;
  tasksInProgress: Array<{ projectId: string; projectName: string; description: string; progress?: string }>;
  blockers: Array<{ projectId: string; description: string; since: string }>;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
}

// ---------------------------------------------------------------------------
// OPC: CEO Events (Phase 3)
// ---------------------------------------------------------------------------

export interface CEOEvent {
  id: string;
  type: 'critical' | 'warning' | 'info' | 'done';
  title: string;
  description?: string;
  projectId?: string;
  workspaceUri?: string;
  timestamp: string;
  actions?: Array<{
    label: string;
    action: 'view' | 'approve' | 'dismiss' | 'navigate';
    payload?: Record<string, unknown>;
  }>;
}

export interface CEORoutineSummaryFE {
  generatedAt: string;
  overview: string;
  digest: string;
  activeProjects: number;
  pendingApprovals: number;
  activeSchedulers: number;
  recentKnowledge: number;
  highlights: string[];
  reminders: string[];
  escalations: string[];
  actions: Array<{
    id: string;
    label: string;
    type: 'approval' | 'project' | 'scheduler' | 'knowledge' | 'focus';
    status: 'done' | 'pending' | 'attention';
    priority: 'low' | 'medium' | 'high';
    meta?: string;
    count?: number;
    target: {
      kind: 'approvals' | 'project' | 'scheduler' | 'knowledge' | 'ceo-focus';
      section: 'ceo' | 'projects' | 'knowledge' | 'operations' | 'settings' | 'conversations';
      requestId?: string;
      projectId?: string;
      jobId?: string;
      knowledgeId?: string;
      workspaceUri?: string;
    };
  }>;
}

export interface CEOProfileFE {
  id: 'default-ceo';
  identity: {
    name: string;
    role: 'ceo';
    tone?: string;
  };
  priorities: string[];
  activeFocus?: string[];
  communicationStyle?: {
    verbosity?: 'brief' | 'normal' | 'detailed';
    escalationStyle?: 'aggressive' | 'balanced' | 'minimal';
  };
  riskTolerance?: 'low' | 'medium' | 'high';
  reviewPreference?: 'result-first' | 'process-first' | 'balanced';
  recentDecisions?: Array<{
    timestamp: string;
    summary: string;
    source: 'user' | 'ceo' | 'system';
    command?: string;
    action?: string;
    projectId?: string;
    runId?: string;
  }>;
  feedbackSignals?: Array<{
    timestamp: string;
    type: 'correction' | 'approval' | 'rejection' | 'preference';
    content: string;
    source?: 'user' | 'system';
  }>;
  pendingIssues?: Array<{
    id: string;
    title: string;
    level: 'critical' | 'warning' | 'info';
    source: 'approval' | 'project' | 'scheduler' | 'knowledge' | 'ceo';
    projectId?: string;
    workspaceUri?: string;
    createdAt: string;
  }>;
  updatedAt: string;
}

export interface ManagementMetricFE {
  key:
    | 'objectiveContribution'
    | 'taskSuccessRate'
    | 'blockageRate'
    | 'retryRate'
    | 'selfHealRate'
    | 'memoryReuseRate'
    | 'workflowHitRate'
    | 'departmentThroughput'
    | 'ceoDecisionQuality';
  scope: 'organization' | 'department' | 'ceo';
  workspaceUri?: string;
  value: number;
  unit: 'ratio' | 'count' | 'score' | 'hours';
  window: 'day' | 'week' | 'month' | 'rolling-30d';
  computedAt: string;
  evidence?: string[];
}

export interface ManagementRiskFE {
  level: 'critical' | 'warning' | 'info';
  title: string;
  description?: string;
  projectId?: string;
  workspaceUri?: string;
}

export interface ManagementOverviewFE {
  generatedAt: string;
  activeProjects: number;
  completedProjects: number;
  failedProjects: number;
  blockedProjects: number;
  pendingApprovals: number;
  activeSchedulers: number;
  schedulerRuntime: {
    status: 'running' | 'idle' | 'disabled' | 'stalled';
    loopActive: boolean;
    configuredToStart: boolean;
    companionServicesEnabled: boolean;
    role: string;
    enabledJobCount: number;
    dueNowCount: number;
    nextRunAt: string | null;
    checkedAt: string;
    message: string;
  };
  recentKnowledge: number;
  okrProgress: number | null;
  risks: ManagementRiskFE[];
  metrics: ManagementMetricFE[];
}

export interface DepartmentManagementOverviewFE extends ManagementOverviewFE {
  workspaceUri: string;
  workflowHitRate: number;
  throughput30d: number;
}

export type EvolutionProposalKindFE = 'workflow' | 'skill';
export type EvolutionProposalStatusFE =
  | 'draft'
  | 'evaluated'
  | 'pending-approval'
  | 'published'
  | 'rejected';

export interface EvolutionProposalEvidenceFE {
  source: 'knowledge' | 'repeated-runs';
  label: string;
  detail: string;
  workspaceUri?: string;
  knowledgeId?: string;
  runIds?: string[];
  count?: number;
}

export interface EvolutionProposalEvaluationFE {
  evaluatedAt: string;
  sampleSize: number;
  matchedRunIds: string[];
  successRate: number;
  blockedRate: number;
  recommendation: 'publish' | 'revise' | 'hold';
  summary: string;
}

export interface EvolutionProposalRolloutFE {
  observedAt: string;
  hitCount: number;
  matchedRunIds: string[];
  successRate: number | null;
  lastUsedAt?: string;
  summary: string;
}

export interface EvolutionProposalFE {
  id: string;
  kind: EvolutionProposalKindFE;
  status: EvolutionProposalStatusFE;
  workspaceUri?: string;
  title: string;
  targetName: string;
  targetRef: string;
  rationale: string;
  content: string;
  sourceKnowledgeIds: string[];
  evidence: EvolutionProposalEvidenceFE[];
  evaluation?: EvolutionProposalEvaluationFE;
  approvalRequestId?: string;
  governanceNote?: string;
  publishedAt?: string;
  publishedArtifactPath?: string;
  rollout?: EvolutionProposalRolloutFE;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// OPC: Deliverable (Phase 3)
// ---------------------------------------------------------------------------

export interface Deliverable {
  id: string;
  projectId: string;
  stageId: string;
  sourceRunId?: string;
  type: 'document' | 'code' | 'data' | 'review';
  title: string;
  artifactPath?: string;
  createdAt: string;
  quality: {
    reviewDecision?: 'approved' | 'revise' | 'rejected';
    reviewedAt?: string;
  };
}


export interface RoleProgressFE {
  roleId: string;
  round: number;
  childConversationId?: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  reviewDecision?: ReviewDecision;
  result?: AgentRunResult;
  promptSnapshot?: string;
  promptRecordedAt?: string;
  inputReadAudit?: RoleInputReadAuditFE;
}

export interface AgentRun {
  runId: string;
  projectId?: string;
  stageId: string;
  workspace: string;
  parentConversationId?: string;
  childConversationId?: string;
  status: AgentRunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  lastError?: string;
  prompt: string;
  model?: string;
  result?: AgentRunResult;
  roles?: RoleProgressFE[];
  currentRound?: number;
  maxRounds?: number;
  artifactDir?: string;
  reviewOutcome?: ReviewOutcome;
  supervisorReviews?: Array<{
    id: string;
    round: number;
    stepCount: number;
    decision: { status: 'HEALTHY' | 'STUCK' | 'LOOPING' | 'DONE', analysis: string, suggestedAction?: string };
    timestamp: string;
  }>;
  supervisorSummary?: {
    totalRounds: number;
    healthyCount: number;
    stuckCount: number;
    loopingCount: number;
    doneCount: number;
    consecutiveStuckPeak: number;
    suggestedActions: string[];
  };
  // V2 envelope fields
  templateId?: string;
  taskEnvelope?: TaskEnvelopeFE;
  resultEnvelope?: ResultEnvelopeFE;
  artifactManifestPath?: string;
  sourceRunIds?: string[];
  executorKind?: ExecutorKindFE;
  executionTarget?: ExecutionTargetFE;
  executionProfile?: ExecutionProfileFE;
  executionProfileSummary?: ExecutionProfileSummaryFE;
  triggerContext?: TriggerContextFE;
  liveState?: {
    cascadeStatus: string;
    stepCount: number;
    lastStepAt: string;
    lastStepType?: string;
    staleSince?: string;
  };
  activeConversationId?: string;
  activeRoleId?: string;
  supervisorConversationId?: string;
  // V3.5: Pipeline tracking
  pipelineId?: string;
  pipelineStageId?: string;
  pipelineStageIndex?: number;
  sessionProvenance?: {
    backendId?: string;
    handle?: string;
    model?: string;
    mode?: string;
    resolutionSource?: 'scene' | 'department' | 'layer' | 'default';
    createdVia?: 'dispatch' | 'nudge' | 'restart' | 'evaluate' | 'pipeline';
    supersedesHandle?: string;
    recordedAt?: string;
    transcriptPath?: string;
    projectPath?: string;
  };
  // V6.1: Provider & Usage tracking
  provider?: string;
  resolvedWorkflowRef?: string;
  resolvedSkillRefs?: string[];
  resolutionReason?: string;
  promptResolution?: PromptModeResolutionFE;
  reportedEventDate?: string;
  reportedEventCount?: number;
  verificationPassed?: boolean;
  reportApiResponse?: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

// ---------------------------------------------------------------------------
// Company Kernel (RunCapsule / MemoryCandidate frontend projection)
// ---------------------------------------------------------------------------

export type CompanyEvidenceRefTypeFE =
  | 'run'
  | 'artifact'
  | 'result-envelope'
  | 'delivery-packet'
  | 'log'
  | 'api-response'
  | 'user-feedback'
  | 'approval'
  | 'file'
  | 'screenshot';

export interface CompanyEvidenceRefFE {
  id: string;
  type: CompanyEvidenceRefTypeFE;
  label: string;
  runId?: string;
  artifactPath?: string;
  filePath?: string;
  apiRoute?: string;
  excerpt?: string;
  checksum?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type CompanyWorkingCheckpointKindFE =
  | 'run-created'
  | 'run-started'
  | 'conversation-attached'
  | 'artifact-discovered'
  | 'result-discovered'
  | 'verification-discovered'
  | 'run-completed'
  | 'run-blocked'
  | 'run-failed'
  | 'run-cancelled';

export interface CompanyWorkingCheckpointFE {
  id: string;
  runId: string;
  kind: CompanyWorkingCheckpointKindFE;
  summary: string;
  occurredAt: string;
  evidenceRefs: CompanyEvidenceRefFE[];
  metadata?: Record<string, unknown>;
}

export interface RunCapsuleFE {
  capsuleId: string;
  runId: string;
  workspaceUri: string;
  projectId?: string;
  providerId?: string;
  executionTarget?: ExecutionTargetFE;
  triggerContext?: TriggerContextFE;
  promptResolution?: PromptModeResolutionFE;
  goal: string;
  prompt: string;
  status: AgentRunStatus;
  startedAt?: string;
  finishedAt?: string;
  checkpoints: CompanyWorkingCheckpointFE[];
  verifiedFacts: string[];
  decisions: string[];
  reusableSteps: string[];
  blockers: string[];
  changedFiles: string[];
  outputArtifacts: CompanyEvidenceRefFE[];
  qualitySignals: {
    resultStatus?: AgentRunResult['status'];
    reviewOutcome?: ReviewOutcome;
    verificationPassed?: boolean;
    reportedEventDate?: string;
    reportedEventCount?: number;
    hasResultEnvelope: boolean;
    hasArtifactManifest: boolean;
    hasDeliveryPacket: boolean;
  };
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  sourceRunUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type MemoryCandidateKindFE =
  | 'decision'
  | 'pattern'
  | 'lesson'
  | 'domain-knowledge'
  | 'workflow-proposal'
  | 'skill-proposal';

export type MemoryCandidateStatusFE =
  | 'candidate'
  | 'auto-promoted'
  | 'pending-review'
  | 'promoted'
  | 'rejected'
  | 'archived';

export type KnowledgeVolatilityFE = 'stable' | 'time-bound' | 'volatile';
export type KnowledgePromotionLevelFE = 'l0-candidate' | 'l1-index' | 'l2-fact' | 'l3-process' | 'l4-archive';

export interface MemoryCandidateScoreFE {
  total: number;
  evidence: number;
  reuse: number;
  specificity: number;
  stability: number;
  novelty: number;
  risk: number;
}

export interface MemoryCandidateConflictFE {
  knowledgeId: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
}

export interface MemoryCandidateFE {
  id: string;
  workspaceUri?: string;
  sourceRunId: string;
  sourceCapsuleId: string;
  kind: MemoryCandidateKindFE;
  title: string;
  content: string;
  evidenceRefs: CompanyEvidenceRefFE[];
  volatility: KnowledgeVolatilityFE;
  score: MemoryCandidateScoreFE;
  reasons: string[];
  conflicts: MemoryCandidateConflictFE[];
  status: MemoryCandidateStatusFE;
  promotedKnowledgeId?: string;
  rejectedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type OperatingSignalSourceFE = 'scheduler' | 'run' | 'approval' | 'knowledge' | 'user' | 'system' | 'external';
export type OperatingSignalKindFE = 'opportunity' | 'risk' | 'routine' | 'failure' | 'learning' | 'decision';
export type OperatingSignalStatusFE = 'observed' | 'triaged' | 'dismissed' | 'converted';

export interface OperatingSignalFE {
  id: string;
  source: OperatingSignalSourceFE;
  kind: OperatingSignalKindFE;
  title: string;
  summary: string;
  evidenceRefs: CompanyEvidenceRefFE[];
  workspaceUri?: string;
  sourceRunId?: string;
  sourceJobId?: string;
  sourceCandidateId?: string;
  sourceApprovalId?: string;
  urgency: number;
  value: number;
  confidence: number;
  risk: number;
  estimatedCost: { tokens: number; minutes: number };
  score: number;
  dedupeKey: string;
  status: OperatingSignalStatusFE;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type OperatingAgendaActionFE = 'dispatch' | 'ask_user' | 'approve' | 'observe' | 'snooze' | 'dismiss';
export type OperatingAgendaPriorityFE = 'p0' | 'p1' | 'p2' | 'p3';
export type OperatingAgendaStatusFE = 'triaged' | 'ready' | 'blocked' | 'dispatched' | 'completed' | 'dismissed' | 'snoozed';

export interface OperatingAgendaItemFE {
  id: string;
  signalIds: string[];
  title: string;
  recommendedAction: OperatingAgendaActionFE;
  targetDepartmentId?: string;
  suggestedWorkflowRef?: string;
  suggestedExecutionTargetId?: string;
  priority: OperatingAgendaPriorityFE;
  score: number;
  status: OperatingAgendaStatusFE;
  reason: string;
  evidenceRefs: CompanyEvidenceRefFE[];
  workspaceUri?: string;
  estimatedCost: { tokens: number; minutes: number };
  budgetDecisionId?: string;
  blockedReason?: string;
  snoozedUntil?: string;
  dispatchedRunId?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface CompanyOperatingDayFE {
  date: string;
  timezone: string;
  focus: string[];
  agenda: OperatingAgendaItemFE[];
  activeSignals: OperatingSignalFE[];
  departmentStates: Array<{
    workspaceUri: string;
    name?: string;
    activeRuns: number;
    completedRuns: number;
    blockedRuns: number;
    activeSignals: number;
    topAgendaItemIds: string[];
    updatedAt: string;
  }>;
  activeRuns: string[];
  completedRuns: string[];
  newKnowledgeIds: string[];
  memoryCandidateIds: string[];
  blockedSignals: string[];
  createdAt: string;
  updatedAt: string;
}

export type CompanyLoopPolicyScopeFE = 'organization' | 'department';
export type CompanyLoopAgendaActionFE = 'observe' | 'dispatch' | 'approve' | 'snooze' | 'dismiss';
export type CompanyLoopNotificationChannelFE = 'web' | 'email' | 'webhook';

export interface CompanyLoopPolicyFE {
  id: string;
  scope: CompanyLoopPolicyScopeFE;
  scopeId?: string;
  enabled: boolean;
  timezone: string;
  dailyReviewHour: number;
  weeklyReviewDay: number;
  weeklyReviewHour: number;
  maxAgendaPerDailyLoop: number;
  maxAutonomousDispatchesPerLoop: number;
  allowedAgendaActions: CompanyLoopAgendaActionFE[];
  growthReviewEnabled: boolean;
  notificationChannels: CompanyLoopNotificationChannelFE[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type CompanyLoopRunKindFE = 'daily-review' | 'weekly-review' | 'growth-review' | 'risk-review';
export type CompanyLoopRunStatusFE = 'running' | 'completed' | 'skipped' | 'failed';

export interface CompanyLoopRunFE {
  id: string;
  policyId: string;
  kind: CompanyLoopRunKindFE;
  status: CompanyLoopRunStatusFE;
  date: string;
  timezone: string;
  selectedAgendaIds: string[];
  dispatchedRunIds: string[];
  generatedProposalIds: string[];
  notificationIds: string[];
  budgetLedgerIds: string[];
  summary: string;
  skipReason?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CompanyLoopDigestFE {
  id: string;
  loopRunId: string;
  date: string;
  title: string;
  operatingSummary: string;
  decisionsNeeded: string[];
  risksBlocked: string[];
  departmentHighlights: string[];
  capabilityGrowth: string[];
  budgetSummary: string[];
  linkedAgendaIds: string[];
  linkedRunIds: string[];
  linkedProposalIds: string[];
  createdAt: string;
}

export type BudgetScopeFE = 'organization' | 'department' | 'scheduler-job' | 'agenda-item' | 'growth-proposal';
export type BudgetPeriodFE = 'day' | 'week' | 'month';

export interface OperatingBudgetPolicyFE {
  id: string;
  scope: BudgetScopeFE;
  scopeId?: string;
  period: BudgetPeriodFE;
  maxTokens: number;
  maxMinutes: number;
  maxDispatches: number;
  maxConcurrentRuns?: number;
  cooldownMinutesByKind?: Record<string, number>;
  failureBudget?: {
    maxConsecutiveFailures: number;
    coolDownMinutes: number;
  };
  warningThreshold: number;
  hardStop: boolean;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type BudgetLedgerDecisionFE = 'reserved' | 'committed' | 'released' | 'blocked' | 'skipped';

export interface BudgetLedgerEntryFE {
  id: string;
  scope: BudgetScopeFE;
  scopeId?: string;
  policyId?: string;
  decision: BudgetLedgerDecisionFE;
  agendaItemId?: string;
  runId?: string;
  schedulerJobId?: string;
  proposalId?: string;
  tokens: number;
  minutes: number;
  dispatches: number;
  reason?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type CircuitBreakerStatusFE = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerFE {
  id: string;
  scope: BudgetScopeFE | 'provider' | 'workflow';
  scopeId: string;
  status: CircuitBreakerStatusFE;
  failureCount: number;
  threshold: number;
  coolDownMinutes: number;
  openedAt?: string;
  recoverAt?: string;
  lastFailureAt?: string;
  resetAt?: string;
  reason?: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface BudgetGateDecisionFE {
  id: string;
  allowed: boolean;
  decision: 'allow' | 'warn' | 'block';
  reasons: string[];
  policy: OperatingBudgetPolicyFE;
  usage: { tokens: number; minutes: number; dispatches: number };
  requested: { tokens: number; minutes: number; dispatches: number };
  circuitBreakers: CircuitBreakerFE[];
  createdAt: string;
}

export type GrowthProposalKindFE = 'sop' | 'workflow' | 'skill' | 'script' | 'rule';
export type GrowthProposalStatusFE = 'draft' | 'evaluated' | 'approval-required' | 'approved' | 'rejected' | 'published' | 'observing' | 'archived';
export type GrowthProposalRiskFE = 'low' | 'medium' | 'high';

export interface GrowthProposalFE {
  id: string;
  kind: GrowthProposalKindFE;
  status: GrowthProposalStatusFE;
  risk: GrowthProposalRiskFE;
  score: number;
  workspaceUri?: string;
  title: string;
  summary: string;
  targetName: string;
  targetRef: string;
  content: string;
  sourceRunIds: string[];
  sourceCapsuleIds: string[];
  sourceKnowledgeIds: string[];
  sourceCandidateIds: string[];
  evidenceRefs: CompanyEvidenceRefFE[];
  evaluation?: {
    evaluatedAt: string;
    evidenceCount: number;
    score: number;
    recommendation: 'approve' | 'needs-approval' | 'reject' | 'observe';
    reasons: string[];
  };
  approvalRequestId?: string;
  publishedAssetRef?: string;
  publishedAt?: string;
  rejectedReason?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface GrowthObservationFE {
  id: string;
  proposalId: string;
  publishedAssetRef?: string;
  observedAt: string;
  hitCount: number;
  matchedRunIds: string[];
  successRate: number | null;
  estimatedTokenSaving?: number;
  regressionSignals?: string[];
  summary: string;
  metadata?: Record<string, unknown>;
}

export type SystemImprovementSignalSourceFE =
  | 'performance'
  | 'ux-breakpoint'
  | 'test-failure'
  | 'runtime-error'
  | 'manual-feedback'
  | 'duplicate-work'
  | 'architecture-risk'
  | 'user-story-gap';

export type SystemImprovementAreaFE =
  | 'frontend'
  | 'api'
  | 'runtime'
  | 'scheduler'
  | 'provider'
  | 'knowledge'
  | 'approval'
  | 'database'
  | 'docs';

export type SystemImprovementSeverityFE = 'low' | 'medium' | 'high' | 'critical';

export interface SystemImprovementSignalFE {
  id: string;
  source: SystemImprovementSignalSourceFE;
  title: string;
  summary: string;
  evidenceRefs: CompanyEvidenceRefFE[];
  affectedAreas: SystemImprovementAreaFE[];
  severity: SystemImprovementSeverityFE;
  recurrence: number;
  estimatedBenefit: {
    latencyReductionMs?: number;
    failureReduction?: number;
    maintenanceSaving?: number;
    uxImpact?: number;
  };
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type SystemImprovementProposalStatusFE =
  | 'draft'
  | 'needs-evidence'
  | 'approval-required'
  | 'approved'
  | 'in-progress'
  | 'testing'
  | 'ready-to-merge'
  | 'published'
  | 'rejected'
  | 'rolled-back'
  | 'observing';

export type SystemImprovementRiskFE = 'low' | 'medium' | 'high' | 'critical';

export interface SystemImprovementTestEvidenceFE {
  command: string;
  status: 'passed' | 'failed';
  outputSummary: string;
  createdAt: string;
}

export interface SystemImprovementExecutionProjectSnapshotFE {
  projectId: string;
  name: string;
  status: string;
  workspaceUri?: string;
  templateId?: string;
  runCount: number;
  updatedAt: string;
}

export interface SystemImprovementExecutionRunSnapshotFE {
  runId: string;
  status: string;
  stageId: string;
  summary?: string;
  lastError?: string;
  changedFilesCount: number;
  blockerCount: number;
  finishedAt?: string;
  updatedAt: string;
}

export interface SystemImprovementExecutionTestSummaryFE {
  plannedCount: number;
  evidenceCount: number;
  passedCount: number;
  failedCount: number;
  latestStatus?: 'passed' | 'failed';
  latestCommand?: string;
  latestSummary?: string;
  latestAt?: string;
}

export interface SystemImprovementMergeGateSummaryFE {
  status: 'pending' | 'ready-to-merge' | 'blocked';
  approvalReady: boolean;
  deliveryReady: boolean;
  testsReady: boolean;
  rollbackReady: boolean;
  reasons: string[];
}

export interface SystemImprovementExitEvidenceBundleFE {
  project?: SystemImprovementExecutionProjectSnapshotFE;
  latestRun?: SystemImprovementExecutionRunSnapshotFE;
  testing: SystemImprovementExecutionTestSummaryFE;
  mergeGate: SystemImprovementMergeGateSummaryFE;
  updatedAt: string;
}

export interface SystemImprovementProposalFE {
  id: string;
  status: SystemImprovementProposalStatusFE;
  title: string;
  summary: string;
  sourceSignalIds: string[];
  evidenceRefs: CompanyEvidenceRefFE[];
  affectedFiles: string[];
  protectedAreas: string[];
  risk: SystemImprovementRiskFE;
  implementationPlan: string[];
  testPlan: string[];
  rollbackPlan: string[];
  branchName?: string;
  approvalRequestId?: string;
  linkedRunIds: string[];
  testEvidence: SystemImprovementTestEvidenceFE[];
  exitEvidence?: SystemImprovementExitEvidenceBundleFE;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface SystemImprovementLaunchResultFE {
  status: 'already-running' | 'dispatched' | 'dispatch-failed';
  projectId?: string;
  runId?: string;
  createdProject: boolean;
  templateId: string;
  workspaceUri: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// V2 Envelope types (frontend)
// ---------------------------------------------------------------------------

export interface ContextRefFE {
  type: 'run' | 'artifact' | 'file';
  runId?: string;
  artifactId?: string;
  path?: string;
  label?: string;
}

export interface ArtifactRefFE {
  id: string;
  kind: string;
  title: string;
  path: string;
  format?: 'md' | 'json' | 'txt';
  roleId?: string;
  round?: number;
  sourceRunId?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskEnvelopeFE {
  templateId?: string;
  executionTarget?: ExecutionTargetFE;
  runId?: string;
  taskId?: string;
  goal: string;
  constraints?: string[];
  contextRefs?: ContextRefFE[];
  inputArtifacts?: ArtifactRefFE[];
  requestedDeliverables?: string[];
  successCriteria?: string[];
  governance?: {
    reviewRequired?: boolean;
    maxRounds?: number;
  };
}

export interface ResultEnvelopeFE {
  templateId?: string;
  executionTarget?: ExecutionTargetFE;
  runId: string;
  taskId?: string;
  status: string;
  decision?: string;
  summary: string;
  outputArtifacts: ArtifactRefFE[];
  risks?: string[];
  openQuestions?: string[];
  nextAction?: string;
  promptResolution?: PromptModeResolutionFE;
  reportedEventDate?: string;
  reportedEventCount?: number;
  verificationPassed?: boolean;
  reportApiResponse?: string;
}

export interface ArtifactManifestFE {
  runId: string;
  templateId?: string;
  executionTarget?: ExecutionTargetFE;
  items: ArtifactRefFE[];
}

export interface RunConversationMessageFE {
  role: 'user' | 'assistant';
  content: string;
}

export type RunConversationFE =
  | {
      kind: 'conversation';
      provider?: string;
      conversationId: string;
      title: string;
    }
  | {
      kind: 'transcript';
      provider?: string;
      handle?: string;
      messages: RunConversationMessageFE[];
      viewerConversationId?: string;
      viewerTitle?: string;
    }
  | {
      kind: 'unavailable';
      provider?: string;
      reason: string;
    };

export interface RoleReadEvidenceFE {
  stepIndex: number;
  stepType: string;
  target: string;
}

export type InputReadAuditStatusFE = 'not_applicable' | 'verified' | 'partial' | 'missing';

export interface InputArtifactReadAuditEntryFE {
  artifactId: string;
  title: string;
  kind: string;
  sourceRunId?: string;
  originalPath: string;
  canonicalPath: string;
  canonicalRead: boolean;
  evidence: RoleReadEvidenceFE[];
  alternateReadPaths?: string[];
}

export interface RoleInputReadAuditFE {
  status: InputReadAuditStatusFE;
  auditedAt: string;
  taskEnvelopePath?: string;
  taskEnvelopeRead: boolean;
  taskEnvelopeEvidence: RoleReadEvidenceFE[];
  requiredArtifactCount: number;
  canonicalReadCount: number;
  alternateReadCount: number;
  missingCanonicalPaths: string[];
  summary: string;
  entries: InputArtifactReadAuditEntryFE[];
}

export interface Skill {
  name: string;
  description: string;
  path: string;
  baseDir: string;
  scope: 'global' | 'workspace';
  source?: 'canonical' | 'discovered';
  content?: string;
}

export interface Workflow {
  name: string;
  description: string;
  path: string;
  workspace?: string;
  content?: string;
  scope?: 'global' | 'workspace';
  baseDir?: string;
  source?: 'canonical' | 'discovered';
}

export interface Rule {
  name: string;
  description: string;
  path: string;
  content?: string;
  scope?: 'global' | 'workspace';
  baseDir?: string;
  source?: 'canonical' | 'discovered';
}

export interface AnalyticsData {
  completionStatistics?: {
    numCompletionsAccepted?: number;
    numCompletionsGenerated?: number;
  };
  completionsByDay?: Array<{
    date?: string;
    numCompletionsAccepted?: number;
  }>;
  completionsByLanguage?: Array<{
    language?: number;
    numCompletionsAccepted?: number;
  }>;
  chatsByModel?: Array<{
    model?: string;
    numChats?: number;
  }>;
  providerUsage?: Array<{
    provider: string;
    runCount: number;
    completedCount: number;
    activeCount: number;
    failedCount: number;
    blockedCount: number;
    cancelledCount: number;
    promptRunCount: number;
    tokenRuns: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    lastRunAt?: string;
  }>;
  providerUsageSummary?: {
    totalRuns: number;
    providers: number;
    tokenRuns: number;
    totalTokens: number;
    windowDays: number;
  };
  dataSources?: {
    antigravityRuntime: boolean;
    gatewayRuns: boolean;
  };
  providerAwareNotice?: string;
}

export interface McpConfig {
  servers?: McpServer[];
}

export interface McpServer {
  name: string;
  type?: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  description?: string;
}

export interface McpToolInfo {
  name: string;
  serverName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

// === Knowledge Item Types ===

export interface KnowledgeItem {
  id: string;
  title: string;
  summary: string;
  references: Array<{ type: string; value: string }>;
  timestamps: { created: string; modified: string; accessed: string };
  artifactFiles: string[];
  workspaceUri?: string;
  category?: string;
  status?: string;
  usageCount?: number;
  lastAccessedAt?: string;
  tags?: string[];
  scope?: 'department' | 'organization';
  sourceType?: 'run' | 'manual' | 'ceo' | 'system';
  sourceRunId?: string;
  sourceArtifactPath?: string;
  confidence?: number;
  evidenceCount?: number;
  promotionLevel?: string;
  promotionSourceCandidateId?: string;
}

export interface KnowledgeDetail extends KnowledgeItem {
  artifacts: Record<string, string>;
}

// === Step Types (match actual protobuf structure) ===

// Step status lifecycle: PENDING → RUNNING → GENERATING → DONE / CANCELED / ERROR
export type StepStatus =
  | 'CORTEX_STEP_STATUS_PENDING'
  | 'CORTEX_STEP_STATUS_RUNNING'
  | 'CORTEX_STEP_STATUS_GENERATING'
  | 'CORTEX_STEP_STATUS_DONE'
  | 'CORTEX_STEP_STATUS_CANCELED'
  | 'CORTEX_STEP_STATUS_ERROR';

export interface MessageItem {
  text?: string;
  item?: {
    file?: {
      absoluteUri?: string;
      workspaceUrisToRelativePaths?: Record<string, string>;
    };
  };
}

export interface MessageMedia {
  mimeType?: string;
  inlineData?: string;
  uri?: string;
  thumbnail?: string;
}

export interface ConversationStructuredError {
  userErrorMessage?: string;
  modelErrorMessage?: string;
  shortError?: string;
  fullError?: string;
  errorCode?: number | string;
  details?: unknown;
  rpcErrorDetails?: unknown[];
}

export interface ConversationStepErrorMessage extends ConversationStructuredError {
  message?: string;
  errorMessage?: string;
  shouldShowUser?: boolean;
  error?: ConversationStructuredError;
}

export interface Step {
  type: string;
  status?: string;
  // Each step has one of these populated based on type
  userInput?: {
    items?: MessageItem[];
    media?: MessageMedia[];
  };
  plannerResponse?: {
    response?: string;
    modifiedResponse?: string;
  };
  taskBoundary?: {
    taskName?: string;
    mode?: string;
    taskStatus?: string;
    taskSummary?: string;
  };
  notifyUser?: {
    notificationContent?: string;
    reviewAbsoluteUris?: string[];
    isBlocking?: boolean;
    // Rich fields from gRPC traffic
    blockedOnUser?: boolean;
    pathsToReview?: string[];
    shouldAutoProceed?: boolean;
  };
  codeAction?: {
    description?: string;
    isArtifactFile?: boolean;
    actionSpec?: {
      createFile?: { absoluteUri?: string };
      editFile?: { absoluteUri?: string };
      deleteFile?: { absoluteUri?: string };
    };
  };
  viewFile?: {
    absoluteUri?: string;
  };
  grepSearch?: {
    query?: string;
    searchPattern?: string;
  };
  runCommand?: {
    command?: string;
    commandLine?: string;
    safeToAutoRun?: boolean;
  };
  commandStatus?: {
    commandId?: string;
    output?: string;
  };
  sendCommandInput?: {
    commandId?: string;
    input?: string;
  };
  searchWeb?: {
    query?: string;
  };
  listDirectory?: {
    path?: string;
  };
  find?: {
    pattern?: string;
    searchDirectory?: string;
  };
  browserSubagent?: {
    taskName?: string;
    task?: string;
  };
  errorMessage?: ConversationStepErrorMessage;
}

export interface StepsData {
  steps: Step[];
  cascadeStatus?: string; // 'running' | 'idle' — from WS
}

// --- V5.3 AI-Assisted Pipeline Generation (FE types) ---

export interface RiskAssessmentFE {
  severity: 'critical' | 'warning' | 'info';
  category: string;
  message: string;
  suggestion?: string;
}

export interface GenerationResultFE {
  draftId: string;
  status: 'draft' | 'confirmed';
  graphPipeline: Record<string, unknown>;
  templateMeta: { name: string; description?: string };
  explanation: string;
  validation: { valid: boolean; dagErrors: string[] };
  risks: RiskAssessmentFE[];
}

export interface ConfirmResultFE {
  templateId: string;
  saved: boolean;
  validationErrors?: string[];
}

// --- V5.4 Platformization (FE types) ---

export interface SubgraphSummaryFE {
  id: string;
  title: string;
  description?: string;
  nodeCount: number;
  inputs: { id: string; nodeId: string }[];
  outputs: { id: string; nodeId: string }[];
}

export interface PolicyRuleFE {
  resource: 'runs' | 'branches' | 'iterations' | 'stages' | 'concurrent-runs';
  limit: number;
  action: 'warn' | 'block' | 'pause';
  description?: string;
}

export interface ResourcePolicyFE {
  id: string;
  name: string;
  scope: 'workspace' | 'template' | 'project';
  targetId: string;
  rules: PolicyRuleFE[];
  enabled?: boolean;
}

export interface PolicyViolationFE {
  policyId: string;
  rule: PolicyRuleFE;
  currentValue: number;
  action: 'warn' | 'block' | 'pause';
  message: string;
}

export interface PolicyEvalResultFE {
  allowed: boolean;
  violations: PolicyViolationFE[];
}

// ---------------------------------------------------------------------------
// V5.2: Execution Journal
// ---------------------------------------------------------------------------

export interface JournalEntryFE {
  timestamp: string;
  projectId: string;
  nodeId: string;
  eventType: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// V5.2: Checkpoint
// ---------------------------------------------------------------------------

export interface CheckpointFE {
  id: string;
  projectId: string;
  nodeId: string;
  createdAt: string;
  state: {
    stages: PipelineStageProgressFE[];
    activeStageIds: string[];
  };
  loopCounters: Record<string, number>;
}

// ---------------------------------------------------------------------------
// OPC: CEO Approval Framework
// ---------------------------------------------------------------------------

export type ApprovalRequestTypeFE =
  | 'token_increase'
  | 'tool_access'
  | 'provider_change'
  | 'scope_extension'
  | 'pipeline_approval'
  | 'proposal_publish'
  | 'other';

export type ApprovalUrgencyFE = 'low' | 'normal' | 'high' | 'critical';
export type ApprovalStatusFE = 'pending' | 'approved' | 'rejected' | 'feedback';

export interface ApprovalRequestFE {
  id: string;
  type: ApprovalRequestTypeFE;
  workspace: string;
  runId?: string;
  title: string;
  description: string;
  urgency: ApprovalUrgencyFE;
  status: ApprovalStatusFE;
  createdAt: string;
  updatedAt: string;
  response?: {
    action: 'approved' | 'rejected' | 'feedback';
    message: string;
    respondedAt: string;
    channel: string;
  };
  notifications?: Array<{
    channel: string;
    success: boolean;
    messageId?: string;
    sentAt: string;
    error?: string;
  }>;
}

export interface ApprovalSummaryFE {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  feedback: number;
}
