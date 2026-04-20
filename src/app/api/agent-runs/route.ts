import { NextResponse } from 'next/server';
import type { TaskEnvelope } from '@/lib/agents/group-types';
import type { DepartmentRuntimeContract } from '@/lib/organization/contracts';
import type { RunStatus } from '@/lib/agents/group-types';
import { createLogger } from '@/lib/logger';
import {
  type ExecutionProfile,
  deriveExecutionProfileFromRun,
  isExecutionProfile,
  normalizeExecutionProfileForTarget,
  summarizeExecutionProfile,
} from '@/lib/execution';
import { listRunRecordsByFilter, type RunRecordFilter } from '@/lib/storage/gateway-db';

export const dynamic = 'force-dynamic';

const log = createLogger('AgentRuns');

type RuntimeTaskEnvelopeCarrier = {
  executionProfile?: ExecutionProfile;
  departmentRuntimeContract?: DepartmentRuntimeContract & Record<string, unknown>;
};

function coerceDepartmentRuntimeContract(
  value: unknown,
): (DepartmentRuntimeContract & Record<string, unknown>) | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return { ...(value as Record<string, unknown>) } as DepartmentRuntimeContract & Record<string, unknown>;
}

function buildTaskEnvelopeWithRuntimeCarrier(
  taskEnvelope: unknown,
  carrier: RuntimeTaskEnvelopeCarrier,
): Partial<TaskEnvelope> | undefined {
  const base = taskEnvelope && typeof taskEnvelope === 'object'
    ? { ...(taskEnvelope as Partial<TaskEnvelope>) }
    : {};
  const next = base as Partial<TaskEnvelope> & RuntimeTaskEnvelopeCarrier;

  if (carrier.executionProfile) {
    next.executionProfile = carrier.executionProfile;
  }
  if (carrier.departmentRuntimeContract) {
    next.departmentRuntimeContract = carrier.departmentRuntimeContract;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

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

// POST /api/agent-runs — dispatch a new run
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const executionProfile = isExecutionProfile(body.executionProfile) ? body.executionProfile : undefined;
    const departmentRuntimeContract = coerceDepartmentRuntimeContract(
      body.departmentRuntimeContract ?? body.runtimeContract,
    );
    const taskEnvelope = buildTaskEnvelopeWithRuntimeCarrier(body.taskEnvelope, {
      executionProfile,
      departmentRuntimeContract,
    });
    const executionProfileTarget = executionProfile ? normalizeExecutionProfileForTarget(executionProfile) : undefined;
    const templateTarget = body.executionTarget?.kind === 'template'
      ? body.executionTarget
      : undefined;

    const executionTarget = executionProfileTarget
      || body.executionTarget
      || (body.templateId || body.pipelineId
        ? {
            kind: 'template',
            templateId: body.templateId || body.pipelineId,
            ...(body.stageId || body.pipelineStageId
              ? { stageId: body.stageId || body.pipelineStageId }
              : {}),
          }
        : undefined);

    if (executionTarget?.kind === 'prompt') {
      const { executePrompt } = await import('@/lib/agents/prompt-executor');
      const result = await executePrompt({
        workspace: body.workspace,
        prompt: body.prompt,
        model: body.model,
        parentConversationId: body.parentConversationId,
        taskEnvelope,
        sourceRunIds: body.sourceRunIds,
        projectId: body.projectId,
        executionTarget,
        triggerContext: body.triggerContext,
      });

      return NextResponse.json({ runId: result.runId, status: 'starting' }, { status: 201 });
    }

    if (executionTarget?.kind && executionTarget.kind !== 'template') {
      return NextResponse.json({ error: `Unsupported execution target: ${executionTarget.kind}` }, { status: 400 });
    }

    const { executeDispatch } = await import('@/lib/agents/dispatch-service');
    const result = await executeDispatch({
      workspace: body.workspace,
      prompt: body.prompt,
      model: body.model,
      parentConversationId: body.parentConversationId,
      taskEnvelope,
      sourceRunIds: body.sourceRunIds,
      projectId: body.projectId,
      pipelineId: body.pipelineId,
      templateId: body.templateId || templateTarget?.templateId || (executionTarget?.kind === 'template' ? executionTarget.templateId : undefined),
      stageId: body.stageId || templateTarget?.stageId || (executionTarget?.kind === 'template' ? executionTarget.stageId : undefined),
      pipelineStageId: body.pipelineStageId,
      pipelineStageIndex: body.pipelineStageIndex,
      templateOverrides: body.templateOverrides,
      conversationMode: body.conversationMode,
      provider: body.provider,
      triggerContext: body.triggerContext,
    });

    return NextResponse.json({ runId: result.runId, status: 'starting' }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Dispatch failed';
    const statusCode = typeof err === 'object'
      && err
      && 'statusCode' in err
      && typeof (err as { statusCode?: unknown }).statusCode === 'number'
      ? (err as { statusCode: number }).statusCode
      : 500;
    log.error({ err: message }, 'Dispatch failed');
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}

// GET /api/agent-runs — list runs with optional filters
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
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

  const runs = listRunRecordsByFilter(Object.keys(filter).length > 0 ? filter as RunRecordFilter : undefined);
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

    result.push({
      ...run,
      stageId: run.pipelineStageId || run.stageId,
      executionProfile: profile,
      executionProfileSummary: profile ? summarizeExecutionProfile(profile) : undefined,
    });
  }

  return NextResponse.json(result);
}
