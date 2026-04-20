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

export interface DepartmentConfig {
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
  provider?: 'antigravity' | 'codex' | 'native-codex' | 'claude-code' | 'claude-api' | 'openai-api' | 'gemini-api' | 'grok-api' | 'custom';
  /** V6: Token quota for this department */
  tokenQuota?: TokenQuota | null;
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
    label: string;
    type: 'approval' | 'project' | 'scheduler' | 'knowledge' | 'focus';
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
}

export interface ApprovalSummaryFE {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  feedback: number;
}
