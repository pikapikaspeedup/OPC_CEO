import type { TaskEnvelope } from '@/lib/agents/group-types';
import type { DepartmentRuntimeContract } from '@/lib/organization/contracts';
import {
  type ExecutionProfile,
  isExecutionProfile,
  normalizeExecutionProfileForTarget,
} from '@/lib/execution';

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

export async function handleRuntimeAgentRunDispatch(req: Request): Promise<Response> {
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

      return Response.json({ runId: result.runId, status: 'starting' }, { status: 201 });
    }

    if (executionTarget?.kind && executionTarget.kind !== 'template') {
      return Response.json({ error: `Unsupported execution target: ${executionTarget.kind}` }, { status: 400 });
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

    return Response.json({ runId: result.runId, status: 'starting' }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Dispatch failed';
    const statusCode = typeof err === 'object'
      && err
      && 'statusCode' in err
      && typeof (err as { statusCode?: unknown }).statusCode === 'number'
      ? (err as { statusCode: number }).statusCode
      : 500;
    return Response.json({ error: message }, { status: statusCode });
  }
}
