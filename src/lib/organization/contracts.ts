export interface CEODecisionRecord {
  timestamp: string;
  summary: string;
  source: 'user' | 'ceo' | 'system';
  command?: string;
  action?: string;
  projectId?: string;
  runId?: string;
}

export interface CEOFeedbackSignal {
  timestamp: string;
  type: 'correction' | 'approval' | 'rejection' | 'preference';
  content: string;
  source?: 'user' | 'system';
}

export interface CEOPendingIssue {
  id: string;
  title: string;
  level: 'critical' | 'warning' | 'info';
  source: 'approval' | 'project' | 'scheduler' | 'knowledge' | 'ceo';
  projectId?: string;
  workspaceUri?: string;
  createdAt: string;
}

export type CEORoutineActionType = 'approval' | 'project' | 'scheduler' | 'knowledge' | 'focus';
export type CEORoutineActionStatus = 'done' | 'pending' | 'attention';
export type CEORoutineActionPriority = 'low' | 'medium' | 'high';

export interface CEORoutineActionTarget {
  kind: 'approvals' | 'project' | 'scheduler' | 'knowledge' | 'ceo-focus';
  section: 'ceo' | 'projects' | 'knowledge' | 'operations' | 'settings' | 'conversations';
  requestId?: string;
  projectId?: string;
  jobId?: string;
  knowledgeId?: string;
  workspaceUri?: string;
}

export interface CEORoutineAction {
  id: string;
  label: string;
  type: CEORoutineActionType;
  status: CEORoutineActionStatus;
  priority: CEORoutineActionPriority;
  meta?: string;
  count?: number;
  target: CEORoutineActionTarget;
}

export interface CEOProfile {
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
  recentDecisions?: CEODecisionRecord[];
  feedbackSignals?: CEOFeedbackSignal[];
  pendingIssues?: CEOPendingIssue[];
  updatedAt: string;
}

export interface DepartmentContract {
  workspaceUri: string;
  name: string;
  type: string;
  description?: string;
  responsibilities: string[];
  providerPolicy: {
    defaultProvider?: string;
    allowedProviders?: string[];
  };
  workflowRefs: string[];
  skillRefs: string[];
  memoryScopes: {
    department: boolean;
    organization: boolean;
    providerSpecific: boolean;
  };
  tokenQuota?: {
    daily: number;
    monthly: number;
    canRequestMore: boolean;
  };
  okrRef?: {
    enabled: boolean;
    period?: string;
  };
  routinePolicies?: {
    allowDailyDigest?: boolean;
    allowWeeklyReview?: boolean;
    allowAutonomousPatrol?: boolean;
  };
}

export type DepartmentExecutionClass = 'light' | 'artifact-heavy' | 'review-loop' | 'delivery';

export type DepartmentToolset = 'research' | 'coding' | 'safe' | 'full';

export type DepartmentPermissionMode = 'default' | 'dontAsk' | 'acceptEdits' | 'bypassPermissions';

export interface DepartmentRequiredArtifact {
  path: string;
  required: boolean;
  format?: 'md' | 'json' | 'txt';
  description?: string;
}

export interface DepartmentRuntimeContract {
  workspaceRoot: string;
  additionalWorkingDirectories: string[];
  readRoots: string[];
  writeRoots: string[];
  artifactRoot: string;
  executionClass: DepartmentExecutionClass;
  toolset: DepartmentToolset;
  permissionMode: DepartmentPermissionMode;
  requiredArtifacts?: DepartmentRequiredArtifact[];
  mcpServers?: string[];
  allowSubAgents?: boolean;
}

export interface DepartmentRuntimeCapabilities {
  supportsDepartmentRuntime: boolean;
  supportsToolRuntime: boolean;
  supportsArtifactContracts: boolean;
  supportsReadWriteAudit: boolean;
  supportsPermissionEnforcement: boolean;
  supportsReviewLoops: boolean;
}

export interface CEORoutineSummary {
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
  actions: CEORoutineAction[];
}

export interface CEOEventRecord {
  id: string;
  kind: 'project' | 'approval' | 'scheduler' | 'knowledge' | 'ceo';
  level: 'critical' | 'warning' | 'info' | 'done';
  title: string;
  description?: string;
  projectId?: string;
  workspaceUri?: string;
  timestamp: string;
  meta?: Record<string, unknown>;
}
