import { NextResponse } from 'next/server';
import type { TaskEnvelope } from '@/lib/agents/group-types';
import type { RunStatus } from '@/lib/agents/group-types';
import { createLogger } from '@/lib/logger';
import {
  type ExecutionProfile,
  deriveExecutionProfileFromRun,
  isExecutionProfile,
  summarizeExecutionProfile,
} from '@/lib/execution';
import { buildPaginatedResponse, parsePaginationSearchParams } from '@/lib/pagination';
import {
  countRunRecordsByFilter,
  listRunRecordsByFilter,
  type RunRecordFilter,
} from '@/lib/storage/gateway-db';
import type {
  AgentRunState,
  ResultEnvelope,
  SessionProvenance,
  TaskResult,
} from '@/lib/agents/group-types';
import {
  proxyToControlPlane,
  proxyToRuntime,
  shouldProxyControlPlaneRequest,
  shouldProxyRuntimeRequest,
} from '@/server/shared/proxy';
import { handleRuntimeAgentRunDispatch } from '@/server/runtime/agent-runs-dispatch';

export const dynamic = 'force-dynamic';

const log = createLogger('AgentRuns');

function getStoredExecutionProfile(run: {
  taskEnvelope?: TaskEnvelope;
  executionTarget?: { kind: 'template' | 'prompt' | 'project-only'; templateId?: string; stageId?: string; promptAssetRefs?: string[]; skillHints?: string[] };
  executorKind?: 'template' | 'prompt';
  reviewOutcome?: string | null;
  resolvedWorkflowRef?: string;
  resolvedSkillRefs?: string[];
}) {
  const raw = run.taskEnvelope?.executionProfile;
  if (isExecutionProfile(raw)) {
    return raw;
  }

  return deriveExecutionProfileFromRun({
    executionTarget: run.executionTarget,
    executorKind: run.executorKind,
    reviewOutcome: run.reviewOutcome as Parameters<typeof deriveExecutionProfileFromRun>[0]['reviewOutcome'],
    resolvedWorkflowRef: run.resolvedWorkflowRef,
    resolvedSkillRefs: run.resolvedSkillRefs,
  });
}

function toListResult(result?: TaskResult): TaskResult | undefined {
  if (!result) {
    return undefined;
  }

  return {
    status: result.status,
    summary: result.summary,
    changedFiles: [...(result.changedFiles || [])],
    blockers: [...(result.blockers || [])],
    needsReview: [...(result.needsReview || [])],
    ...(result.decision ? { decision: result.decision } : {}),
  };
}

function toListResultEnvelope(resultEnvelope?: ResultEnvelope): ResultEnvelope | undefined {
  if (!resultEnvelope) {
    return undefined;
  }

  return {
    runId: resultEnvelope.runId,
    status: resultEnvelope.status,
    summary: resultEnvelope.summary,
    outputArtifacts: [...(resultEnvelope.outputArtifacts || [])],
    ...(resultEnvelope.templateId ? { templateId: resultEnvelope.templateId } : {}),
    ...(resultEnvelope.executionTarget ? { executionTarget: resultEnvelope.executionTarget } : {}),
    ...(resultEnvelope.taskId ? { taskId: resultEnvelope.taskId } : {}),
    ...(resultEnvelope.decision ? { decision: resultEnvelope.decision } : {}),
    ...(resultEnvelope.risks?.length ? { risks: [...resultEnvelope.risks] } : {}),
    ...(resultEnvelope.openQuestions?.length ? { openQuestions: [...resultEnvelope.openQuestions] } : {}),
    ...(resultEnvelope.nextAction ? { nextAction: resultEnvelope.nextAction } : {}),
  };
}

function toListSessionProvenance(session?: SessionProvenance): SessionProvenance | undefined {
  if (!session) {
    return undefined;
  }

  const next: Partial<SessionProvenance> = {
    handle: session.handle,
    backendId: session.backendId,
    handleKind: session.handleKind,
    workspacePath: session.workspacePath,
    ...(session.model ? { model: session.model } : {}),
    ...(session.createdVia ? { createdVia: session.createdVia } : {}),
    ...(session.recordedAt ? { recordedAt: session.recordedAt } : {}),
  };

  return next as SessionProvenance;
}

function toRunListItem(
  run: AgentRunState,
  executionProfile?: ExecutionProfile,
): AgentRunState & {
  executionProfileSummary?: ReturnType<typeof summarizeExecutionProfile>;
} {
  return {
    runId: run.runId,
    stageId: run.pipelineStageId || run.stageId,
    status: run.status,
    workspace: run.workspace,
    prompt: run.prompt,
    createdAt: run.createdAt,
    ...(run.projectId ? { projectId: run.projectId } : {}),
    ...(run.parentConversationId ? { parentConversationId: run.parentConversationId } : {}),
    ...(run.childConversationId ? { childConversationId: run.childConversationId } : {}),
    ...(run.activeConversationId ? { activeConversationId: run.activeConversationId } : {}),
    ...(run.activeRoleId ? { activeRoleId: run.activeRoleId } : {}),
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    ...(run.lastError ? { lastError: run.lastError } : {}),
    ...(run.model ? { model: run.model } : {}),
    ...(toListResult(run.result) ? { result: toListResult(run.result) } : {}),
    ...(run.roles?.length ? { roles: run.roles } : {}),
    ...(run.currentRound !== undefined ? { currentRound: run.currentRound } : {}),
    ...(run.maxRounds !== undefined ? { maxRounds: run.maxRounds } : {}),
    ...(run.reviewOutcome ? { reviewOutcome: run.reviewOutcome } : {}),
    ...(run.templateId ? { templateId: run.templateId } : {}),
    ...(toListResultEnvelope(run.resultEnvelope) ? { resultEnvelope: toListResultEnvelope(run.resultEnvelope) } : {}),
    ...(run.artifactManifestPath ? { artifactManifestPath: run.artifactManifestPath } : {}),
    ...(run.executorKind ? { executorKind: run.executorKind } : {}),
    ...(run.executionTarget ? { executionTarget: run.executionTarget } : {}),
    ...(executionProfile ? { executionProfileSummary: summarizeExecutionProfile(executionProfile) } : {}),
    ...(run.triggerContext ? { triggerContext: run.triggerContext } : {}),
    ...(run.liveState ? { liveState: run.liveState } : {}),
    ...(run.supervisorReviews?.length ? { supervisorReviews: run.supervisorReviews } : {}),
    ...(run.supervisorSummary ? { supervisorSummary: run.supervisorSummary } : {}),
    ...(run.supervisorConversationId ? { supervisorConversationId: run.supervisorConversationId } : {}),
    ...(run.pipelineId ? { pipelineId: run.pipelineId } : {}),
    ...(run.pipelineStageId ? { pipelineStageId: run.pipelineStageId } : {}),
    ...(run.pipelineStageIndex !== undefined ? { pipelineStageIndex: run.pipelineStageIndex } : {}),
    ...(toListSessionProvenance(run.sessionProvenance) ? { sessionProvenance: toListSessionProvenance(run.sessionProvenance) } : {}),
    ...(run.provider ? { provider: run.provider } : {}),
    ...(run.resolvedWorkflowRef ? { resolvedWorkflowRef: run.resolvedWorkflowRef } : {}),
    ...(run.reportedEventDate ? { reportedEventDate: run.reportedEventDate } : {}),
    ...(run.reportedEventCount !== undefined ? { reportedEventCount: run.reportedEventCount } : {}),
    ...(run.verificationPassed !== undefined ? { verificationPassed: run.verificationPassed } : {}),
    ...(run.reportApiResponse ? { reportApiResponse: run.reportApiResponse } : {}),
  };
}

// POST /api/agent-runs — dispatch a new run
export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  if (shouldProxyRuntimeRequest()) {
    return proxyToRuntime(req, '/internal/runtime/agent-runs');
  }

  const response = await handleRuntimeAgentRunDispatch(req);
  if (!response.ok) {
    let message = 'Dispatch failed';
    try {
      const payload = await response.clone().json() as { error?: string };
      message = payload.error || message;
    } catch {
      // ignore JSON parsing failures
    }
    log.error({ err: message, status: response.status }, 'Dispatch failed');
  }
  return response;
}

// GET /api/agent-runs — list runs with optional filters
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pagination = parsePaginationSearchParams(searchParams, {
    defaultPageSize: 50,
    maxPageSize: 200,
  });
  const statusFilter = searchParams.get('status') as RunStatus | null;
  const stageIdFilter = searchParams.get('stageId');
  const reviewOutcomeFilter = searchParams.get('reviewOutcome');
  const projectIdFilter = searchParams.get('projectId');
  const executorKindFilter = searchParams.get('executorKind');
  const schedulerJobIdFilter = searchParams.get('schedulerJobId');

  const filter: { status?: RunStatus; stageId?: string; reviewOutcome?: string; projectId?: string; executorKind?: string; schedulerJobId?: string } = {};
  if (statusFilter) filter.status = statusFilter;
  if (stageIdFilter) filter.stageId = stageIdFilter;
  if (reviewOutcomeFilter) filter.reviewOutcome = reviewOutcomeFilter;
  if (projectIdFilter) filter.projectId = projectIdFilter;
  if (executorKindFilter) filter.executorKind = executorKindFilter;
  if (schedulerJobIdFilter) filter.schedulerJobId = schedulerJobIdFilter;

  const normalizedFilter = Object.keys(filter).length > 0 ? filter as RunRecordFilter : undefined;
  const total = countRunRecordsByFilter(normalizedFilter);
  const runs = listRunRecordsByFilter(normalizedFilter, {
    limit: pagination.limit,
    offset: pagination.offset,
  });
  let getStageDefinition:
    | ((templateId: string, stageId: string) => {
      executionMode?: 'legacy-single' | 'review-loop' | 'delivery-single-pass' | 'orchestration';
      reviewPolicyId?: string;
      roles?: Array<{ id: string }>;
    } | null)
    | null = null;

  const result = [];
  for (const run of runs) {
    let profile = getStoredExecutionProfile(run);
    if (!profile && run.templateId && (run.pipelineStageId || run.stageId)) {
      if (!getStageDefinition) {
        ({ getStageDefinition } = await import('@/lib/agents/stage-resolver'));
      }
      const stage = getStageDefinition(run.templateId, run.pipelineStageId || run.stageId);
      profile = deriveExecutionProfileFromRun({
        executionTarget: run.executionTarget,
        executorKind: run.executorKind,
        reviewOutcome: run.reviewOutcome,
        resolvedWorkflowRef: run.resolvedWorkflowRef,
        resolvedSkillRefs: run.resolvedSkillRefs,
        stageExecutionMode: stage?.executionMode,
        reviewPolicyId: stage?.reviewPolicyId,
        roleIds: stage?.roles?.map((role) => role.id),
      });
    }

    result.push(toRunListItem(run, profile || undefined));
  }

  return NextResponse.json(buildPaginatedResponse(result, total, pagination));
}
