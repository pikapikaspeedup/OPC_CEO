import type {
  ExecutionTarget,
  PromptModeResolution,
  ReviewOutcome,
  RunStatus,
  TaskResult,
  TriggerContext,
} from '../agents/group-types';

export type EvidenceRefType =
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

export interface EvidenceRef {
  id: string;
  type: EvidenceRefType;
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

export type WorkingCheckpointKind =
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

export interface WorkingCheckpoint {
  id: string;
  runId: string;
  kind: WorkingCheckpointKind;
  summary: string;
  occurredAt: string;
  evidenceRefs: EvidenceRef[];
  metadata?: Record<string, unknown>;
}

export interface RunCapsule {
  capsuleId: string;
  runId: string;
  workspaceUri: string;
  projectId?: string;
  providerId?: string;
  executionTarget?: ExecutionTarget;
  triggerContext?: TriggerContext;
  promptResolution?: PromptModeResolution;
  goal: string;
  prompt: string;
  status: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  checkpoints: WorkingCheckpoint[];
  verifiedFacts: string[];
  decisions: string[];
  reusableSteps: string[];
  blockers: string[];
  changedFiles: string[];
  outputArtifacts: EvidenceRef[];
  qualitySignals: {
    resultStatus?: TaskResult['status'];
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

export type MemoryCandidateKind =
  | 'decision'
  | 'pattern'
  | 'lesson'
  | 'domain-knowledge'
  | 'workflow-proposal'
  | 'skill-proposal';

export type MemoryCandidateStatus =
  | 'candidate'
  | 'auto-promoted'
  | 'pending-review'
  | 'promoted'
  | 'rejected'
  | 'archived';

export type KnowledgePromotionLevel =
  | 'l0-candidate'
  | 'l1-index'
  | 'l2-fact'
  | 'l3-process'
  | 'l4-archive';

export type KnowledgeVolatility =
  | 'stable'
  | 'time-bound'
  | 'volatile';

export interface MemoryCandidateScore {
  total: number;
  evidence: number;
  reuse: number;
  specificity: number;
  stability: number;
  novelty: number;
  risk: number;
}

export interface MemoryCandidateConflict {
  knowledgeId: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
}

export interface MemoryCandidate {
  id: string;
  workspaceUri?: string;
  sourceRunId: string;
  sourceCapsuleId: string;
  kind: MemoryCandidateKind;
  title: string;
  content: string;
  evidenceRefs: EvidenceRef[];
  volatility: KnowledgeVolatility;
  score: MemoryCandidateScore;
  reasons: string[];
  conflicts: MemoryCandidateConflict[];
  status: MemoryCandidateStatus;
  promotedKnowledgeId?: string;
  rejectedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeEvidence {
  refs: EvidenceRef[];
  strength: number;
  verifiedAt?: string;
}

export interface KnowledgePromotionMetadata {
  level: KnowledgePromotionLevel;
  volatility: KnowledgeVolatility;
  qualityScore: number;
  sourceCandidateId?: string;
  sourceCapsuleIds: string[];
  promotedBy: 'system' | 'ceo' | 'manual';
  promotedAt: string;
  conflictGroupId?: string;
}

export type OperatingSignalSource =
  | 'scheduler'
  | 'run'
  | 'approval'
  | 'knowledge'
  | 'user'
  | 'system'
  | 'external';

export type OperatingSignalKind =
  | 'opportunity'
  | 'risk'
  | 'routine'
  | 'failure'
  | 'learning'
  | 'decision';

export type OperatingSignalStatus =
  | 'observed'
  | 'triaged'
  | 'dismissed'
  | 'converted';

export interface EstimatedOperatingCost {
  tokens: number;
  minutes: number;
}

export interface OperatingSignal {
  id: string;
  source: OperatingSignalSource;
  kind: OperatingSignalKind;
  title: string;
  summary: string;
  evidenceRefs: EvidenceRef[];
  workspaceUri?: string;
  sourceRunId?: string;
  sourceJobId?: string;
  sourceCandidateId?: string;
  sourceApprovalId?: string;
  urgency: number;
  value: number;
  confidence: number;
  risk: number;
  estimatedCost: EstimatedOperatingCost;
  score: number;
  dedupeKey: string;
  status: OperatingSignalStatus;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type OperatingAgendaAction =
  | 'dispatch'
  | 'ask_user'
  | 'approve'
  | 'observe'
  | 'snooze'
  | 'dismiss';

export type OperatingAgendaPriority = 'p0' | 'p1' | 'p2' | 'p3';

export type OperatingAgendaStatus =
  | 'triaged'
  | 'ready'
  | 'blocked'
  | 'dispatched'
  | 'completed'
  | 'dismissed'
  | 'snoozed';

export interface OperatingAgendaItem {
  id: string;
  signalIds: string[];
  title: string;
  recommendedAction: OperatingAgendaAction;
  targetDepartmentId?: string;
  suggestedWorkflowRef?: string;
  suggestedExecutionTargetId?: string;
  priority: OperatingAgendaPriority;
  score: number;
  status: OperatingAgendaStatus;
  reason: string;
  evidenceRefs: EvidenceRef[];
  workspaceUri?: string;
  estimatedCost: EstimatedOperatingCost;
  budgetDecisionId?: string;
  blockedReason?: string;
  snoozedUntil?: string;
  dispatchedRunId?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface DepartmentOperatingStateSummary {
  workspaceUri: string;
  name?: string;
  activeRuns: number;
  completedRuns: number;
  blockedRuns: number;
  activeSignals: number;
  topAgendaItemIds: string[];
  updatedAt: string;
}

export interface CompanyOperatingDay {
  date: string;
  timezone: string;
  focus: string[];
  agenda: OperatingAgendaItem[];
  activeSignals: OperatingSignal[];
  departmentStates: DepartmentOperatingStateSummary[];
  activeRuns: string[];
  completedRuns: string[];
  newKnowledgeIds: string[];
  memoryCandidateIds: string[];
  blockedSignals: string[];
  createdAt: string;
  updatedAt: string;
}

export type CompanyLoopPolicyScope = 'organization' | 'department';

export type CompanyLoopAgendaAction =
  | 'observe'
  | 'dispatch'
  | 'approve'
  | 'snooze'
  | 'dismiss';

export type CompanyLoopNotificationChannel = 'web' | 'email' | 'webhook';

export interface CompanyLoopPolicy {
  id: string;
  scope: CompanyLoopPolicyScope;
  scopeId?: string;
  enabled: boolean;
  timezone: string;
  dailyReviewHour: number;
  weeklyReviewDay: number;
  weeklyReviewHour: number;
  maxAgendaPerDailyLoop: number;
  maxAutonomousDispatchesPerLoop: number;
  allowedAgendaActions: CompanyLoopAgendaAction[];
  growthReviewEnabled: boolean;
  notificationChannels: CompanyLoopNotificationChannel[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type CompanyLoopRunKind =
  | 'daily-review'
  | 'weekly-review'
  | 'growth-review'
  | 'risk-review';

export type CompanyLoopRunStatus =
  | 'running'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface CompanyLoopRun {
  id: string;
  policyId: string;
  kind: CompanyLoopRunKind;
  status: CompanyLoopRunStatus;
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

export interface CompanyLoopDigest {
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

export type BudgetScope =
  | 'organization'
  | 'department'
  | 'scheduler-job'
  | 'agenda-item'
  | 'growth-proposal';

export type BudgetPeriod = 'day' | 'week' | 'month';

export interface OperatingBudgetPolicy {
  id: string;
  scope: BudgetScope;
  scopeId?: string;
  period: BudgetPeriod;
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

export type BudgetLedgerDecision =
  | 'reserved'
  | 'committed'
  | 'released'
  | 'blocked'
  | 'skipped';

export interface BudgetLedgerEntry {
  id: string;
  scope: BudgetScope;
  scopeId?: string;
  policyId?: string;
  decision: BudgetLedgerDecision;
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

export type CircuitBreakerStatus = 'closed' | 'open' | 'half-open';

export interface CircuitBreaker {
  id: string;
  scope: BudgetScope | 'provider' | 'workflow';
  scopeId: string;
  status: CircuitBreakerStatus;
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

export interface BudgetGateDecision {
  id: string;
  allowed: boolean;
  decision: 'allow' | 'warn' | 'block';
  reasons: string[];
  policy: OperatingBudgetPolicy;
  usage: {
    tokens: number;
    minutes: number;
    dispatches: number;
  };
  requested: EstimatedOperatingCost & { dispatches: number };
  circuitBreakers: CircuitBreaker[];
  createdAt: string;
}

export type GrowthProposalKind = 'sop' | 'workflow' | 'skill' | 'script' | 'rule';

export type GrowthProposalStatus =
  | 'draft'
  | 'evaluated'
  | 'approval-required'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'observing'
  | 'archived';

export type GrowthProposalRisk = 'low' | 'medium' | 'high';

export interface GrowthProposalEvaluation {
  evaluatedAt: string;
  evidenceCount: number;
  score: number;
  recommendation: 'approve' | 'needs-approval' | 'reject' | 'observe';
  reasons: string[];
}

export interface GrowthProposal {
  id: string;
  kind: GrowthProposalKind;
  status: GrowthProposalStatus;
  risk: GrowthProposalRisk;
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
  evidenceRefs: EvidenceRef[];
  evaluation?: GrowthProposalEvaluation;
  approvalRequestId?: string;
  publishedAssetRef?: string;
  publishedAt?: string;
  rejectedReason?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface GrowthObservation {
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

export type SystemImprovementSignalSource =
  | 'performance'
  | 'ux-breakpoint'
  | 'test-failure'
  | 'runtime-error'
  | 'manual-feedback'
  | 'duplicate-work'
  | 'architecture-risk';

export type SystemImprovementArea =
  | 'frontend'
  | 'api'
  | 'runtime'
  | 'scheduler'
  | 'provider'
  | 'knowledge'
  | 'approval'
  | 'database'
  | 'docs';

export type SystemImprovementSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface SystemImprovementSignal {
  id: string;
  source: SystemImprovementSignalSource;
  title: string;
  summary: string;
  evidenceRefs: EvidenceRef[];
  affectedAreas: SystemImprovementArea[];
  severity: SystemImprovementSeverity;
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

export type SystemImprovementProposalStatus =
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

export type SystemImprovementRisk = 'low' | 'medium' | 'high' | 'critical';

export interface SystemImprovementTestEvidence {
  command: string;
  status: 'passed' | 'failed';
  outputSummary: string;
  createdAt: string;
}

export interface SystemImprovementProposal {
  id: string;
  status: SystemImprovementProposalStatus;
  title: string;
  summary: string;
  sourceSignalIds: string[];
  evidenceRefs: EvidenceRef[];
  affectedFiles: string[];
  protectedAreas: string[];
  risk: SystemImprovementRisk;
  implementationPlan: string[];
  testPlan: string[];
  rollbackPlan: string[];
  branchName?: string;
  approvalRequestId?: string;
  linkedRunIds: string[];
  testEvidence: SystemImprovementTestEvidence[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ProtectedCorePolicy {
  id: string;
  protectedGlobs: string[];
  criticalGlobs: string[];
  requiresApprovalFor: Array<
    | 'database'
    | 'scheduler'
    | 'approval'
    | 'provider'
    | 'memory'
    | 'runtime'
    | 'security'
  >;
  maxFilesWithoutApproval: number;
  requireBranch: boolean;
  requireTests: boolean;
  requireRollbackPlan: boolean;
  createdAt: string;
  updatedAt: string;
}
