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
  createdBy?: 'ceo-command' | 'ceo-workflow' | 'mcp' | 'web' | 'api';
  intentSummary?: string;
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
      stageId?: string;
      workspace: string;
      prompt: string;
      projectId?: string;
      model?: string;
      sourceRunIds?: string[];
    }
  | {
      kind: 'health-check';
      projectId: string;
    }
  | {
      kind: 'create-project';
    };

export interface SchedulerTriggerResult {
  jobId: string;
  status: 'success' | 'failed' | 'skipped';
  triggeredAt: string;
  message?: string;
}
