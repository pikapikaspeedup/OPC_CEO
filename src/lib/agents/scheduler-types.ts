export interface ScheduledJob {
  jobId: string;
  name: string;
  type: 'cron' | 'interval' | 'once';
  cronExpression?: string;
  timeZone?: string;
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
    templateId?: string;
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
      kind: 'dispatch-prompt';
      workspace: string;
      prompt: string;
      promptAssetRefs?: string[];
      skillHints?: string[];
      projectId?: string;
      model?: string;
    }
  | {
      kind: 'dispatch-execution-profile';
      executionProfile:
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
      workspace: string;
      prompt: string;
      projectId?: string;
      model?: string;
    }
  | {
      kind: 'health-check';
      projectId: string;
    }
  | {
      kind: 'company-loop';
      loopKind: 'daily-review' | 'weekly-review' | 'growth-review' | 'risk-review';
      policyId?: string;
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
