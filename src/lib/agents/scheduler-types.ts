export interface ScheduledJob {
  jobId: string;
  name: string;
  type: 'cron' | 'interval' | 'once';
  cronExpression?: string;
  intervalMs?: number;
  scheduledAt?: string;
  action: ScheduledAction;
  enabled: boolean;
  lastRunAt?: string;
  lastRunResult?: 'success' | 'failed' | 'skipped';
  lastRunError?: string;
  createdAt: string;
  /** OPC: associated department workspace URI */
  departmentWorkspaceUri?: string;
  /** OPC: action to create an Ad-hoc project on trigger */
  opcAction?: {
    type: 'create_project';
    projectType: 'adhoc';
    goal: string;
    skillHint?: string;
  };
}

export type ScheduledAction =
  | {
      kind: 'dispatch-pipeline';
      templateId: string;
      workspace: string;
      prompt: string;
      projectId?: string;
      model?: string;
    }
  | {
      kind: 'dispatch-group';
      groupId: string;
      workspace: string;
      prompt: string;
      projectId?: string;
      model?: string;
      sourceRunIds?: string[];
    }
  | {
      kind: 'health-check';
      projectId: string;
    };

export interface SchedulerTriggerResult {
  jobId: string;
  status: 'success' | 'failed' | 'skipped';
  triggeredAt: string;
  message?: string;
}
