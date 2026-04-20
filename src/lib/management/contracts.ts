export interface ManagementMetric {
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

export interface ManagementRisk {
  level: 'critical' | 'warning' | 'info';
  title: string;
  description?: string;
  projectId?: string;
  workspaceUri?: string;
}

export interface ManagementOverview {
  generatedAt: string;
  activeProjects: number;
  completedProjects: number;
  failedProjects: number;
  blockedProjects: number;
  pendingApprovals: number;
  activeSchedulers: number;
  recentKnowledge: number;
  okrProgress: number | null;
  risks: ManagementRisk[];
  metrics: ManagementMetric[];
}

export interface DepartmentManagementOverview extends ManagementOverview {
  workspaceUri: string;
  workflowHitRate: number;
  throughput30d: number;
}
