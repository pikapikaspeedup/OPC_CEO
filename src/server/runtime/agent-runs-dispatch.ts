import type { ExecutionTarget, PromptExecutionTarget, TaskEnvelope, TriggerContext } from '@/lib/agents/group-types';
import type { DepartmentRuntimeContract } from '@/lib/organization/contracts';
import type { BudgetLedgerEntry } from '@/lib/company-kernel/contracts';
import {
  attachRunToBudgetReservation,
  releaseBudgetForRun,
  reserveBudgetForOperation,
} from '@/lib/company-kernel/budget-gate';
import {
  type ExecutionProfile,
  isExecutionProfile,
  normalizeExecutionProfileForTarget,
} from '@/lib/execution';

type RuntimeTaskEnvelopeCarrier = {
  executionProfile?: ExecutionProfile;
  departmentRuntimeContract?: DepartmentRuntimeContract & Record<string, unknown>;
};

type RuntimeDispatchBody = {
  workspace?: string;
  prompt?: string;
  model?: string;
  parentConversationId?: string;
  taskEnvelope?: Partial<TaskEnvelope> & { goal?: string };
  sourceRunIds?: string[];
  projectId?: string;
  pipelineId?: string;
  templateId?: string;
  stageId?: string;
  pipelineStageId?: string;
  pipelineStageIndex?: number;
  templateOverrides?: Record<string, unknown>;
  conversationMode?: 'shared' | 'isolated';
  provider?: string;
  executionProfile?: unknown;
  departmentRuntimeContract?: unknown;
  runtimeContract?: unknown;
  executionTarget?: ExecutionTarget;
  triggerContext?: TriggerContext;
};

function promptTextFromBody(body: RuntimeDispatchBody): string {
  return body.prompt || body.taskEnvelope?.goal || '';
}

function manualBudgetShouldBeRecorded(body: RuntimeDispatchBody): boolean {
  if (!body.workspace) return false;
  if (body.triggerContext?.schedulerJobId) return false;
  if (body.triggerContext?.source === 'scheduler') return false;
  return true;
}

function reserveManualDispatchBudget(
  body: RuntimeDispatchBody,
  kind: 'prompt' | 'template',
): BudgetLedgerEntry | null {
  if (!manualBudgetShouldBeRecorded(body)) return null;
  const promptText = promptTextFromBody(body);
  const budget = reserveBudgetForOperation({
    scope: 'department',
    scopeId: body.workspace,
    estimatedCost: {
      tokens: Math.max(500, Math.ceil(promptText.length / 2) + 1_000),
      minutes: kind === 'template' ? 10 : 5,
    },
    // Manual dispatches still consume token/time budget but do not spend autonomous dispatch quota.
    dispatches: 0,
    operationKind: `manual.${kind}`,
    reason: `Manual ${kind} dispatch`,
  });
  if (!budget.decision.allowed) {
    const err = new Error(budget.decision.reasons.join('; ') || 'Manual dispatch blocked by budget gate') as Error & { statusCode: number };
    err.statusCode = 409;
    throw err;
  }
  return budget.ledger;
}

function releaseUnattachedBudgetReservation(ledger: BudgetLedgerEntry | null, reason: string): void {
  if (!ledger || ledger.decision !== 'reserved') return;
  releaseBudgetForRun({
    policyId: ledger.policyId,
    scope: ledger.scope,
    scopeId: ledger.scopeId,
    schedulerJobId: ledger.schedulerJobId,
    proposalId: ledger.proposalId,
    reason,
  });
}

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
    const body = await req.json() as RuntimeDispatchBody;
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

    const promptExecutionTarget = executionTarget?.kind === 'prompt'
      ? executionTarget as PromptExecutionTarget
      : undefined;
    if (promptExecutionTarget) {
      const budgetLedger = reserveManualDispatchBudget(body, 'prompt');
      const { executePrompt } = await import('@/lib/agents/prompt-executor');
      let result: { runId: string };
      try {
        result = await executePrompt({
          workspace: body.workspace || '',
          prompt: body.prompt,
          model: body.model,
          parentConversationId: body.parentConversationId,
          taskEnvelope,
          sourceRunIds: body.sourceRunIds,
          projectId: body.projectId,
          executionTarget: promptExecutionTarget,
          triggerContext: body.triggerContext,
        });
      } catch (err) {
        releaseUnattachedBudgetReservation(budgetLedger, 'manual prompt dispatch failed before run attach');
        throw err;
      }
      if (budgetLedger?.decision === 'reserved') {
        attachRunToBudgetReservation(budgetLedger, result.runId);
      }

      return Response.json({ runId: result.runId, status: 'starting' }, { status: 201 });
    }

    if (executionTarget?.kind && executionTarget.kind !== 'template') {
      return Response.json({ error: `Unsupported execution target: ${executionTarget.kind}` }, { status: 400 });
    }

    const { executeDispatch } = await import('@/lib/agents/dispatch-service');
    const budgetLedger = reserveManualDispatchBudget(body, 'template');
    let result: { runId: string };
    try {
      result = await executeDispatch({
        workspace: body.workspace || '',
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
    } catch (err) {
      releaseUnattachedBudgetReservation(budgetLedger, 'manual template dispatch failed before run attach');
      throw err;
    }
    if (budgetLedger?.decision === 'reserved') {
      attachRunToBudgetReservation(budgetLedger, result.runId);
    }

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
