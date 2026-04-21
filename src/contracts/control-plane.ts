import type {
  AgentRun,
  Conversation,
  ExecutionProfileSummaryFE,
  PaginatedResponse,
  PaginationQueryFE,
  Project,
} from '../lib/types';

export type ControlPlanePaginationQuery = PaginationQueryFE;
export type ControlPlanePaginatedResponse<T> = PaginatedResponse<T>;

export interface ConversationSummary extends Conversation {
  lastActivityAt?: string;
  updatedAt?: string;
  provider?: string;
}

export type ConversationDetail = ConversationSummary;

export interface AgentRunSummary extends Pick<
  AgentRun,
  | 'runId'
  | 'stageId'
  | 'status'
  | 'workspace'
  | 'prompt'
  | 'createdAt'
  | 'projectId'
  | 'parentConversationId'
  | 'childConversationId'
  | 'activeConversationId'
  | 'activeRoleId'
  | 'startedAt'
  | 'finishedAt'
  | 'lastError'
  | 'model'
  | 'result'
  | 'currentRound'
  | 'maxRounds'
  | 'reviewOutcome'
  | 'templateId'
  | 'resultEnvelope'
  | 'artifactManifestPath'
  | 'executorKind'
  | 'executionTarget'
  | 'triggerContext'
  | 'liveState'
  | 'supervisorSummary'
  | 'supervisorConversationId'
  | 'pipelineId'
  | 'pipelineStageId'
  | 'pipelineStageIndex'
  | 'sessionProvenance'
  | 'provider'
  | 'resolvedWorkflowRef'
  | 'reportedEventDate'
  | 'reportedEventCount'
  | 'verificationPassed'
  | 'reportApiResponse'
> {
  executionProfileSummary?: ExecutionProfileSummaryFE;
}

export type AgentRunDetail = AgentRun;

export type ProjectSummary = Project;
export type ProjectDetail = Project;
