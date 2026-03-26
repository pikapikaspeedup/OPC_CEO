import { NextResponse } from 'next/server';
import { getProject, getFirstActionableStage, incrementStageAttempts, updatePipelineStage } from '@/lib/agents/project-registry';
import { getRun, recoverInterruptedRun, updateRun } from '@/lib/agents/run-registry';
import { cancelRun, interveneRun, InterventionConflictError } from '@/lib/agents/group-runtime';
import { createLogger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const log = createLogger('ProjectResume');

type ResumeAction = 'recover' | 'nudge' | 'restart_role' | 'cancel' | 'skip';

function responseForAction(input: {
  status: string;
  requestedAction: ResumeAction;
  actualAction: ResumeAction;
  stageIndex: number;
  groupId: string;
  runId: string;
  activeConversationId?: string;
  message?: string;
}) {
  const httpStatus = input.status === 'recovered' || input.status === 'cancelled' ? 200 : 202;
  return NextResponse.json(input, {
    status: httpStatus,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    const project = getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (!project.pipelineState) {
      return NextResponse.json({ error: 'Project has no pipeline state. Dispatch a template first.' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      stageIndex: requestedStageIndex,
      action,
      prompt,
      roleId,
    } = body as {
      stageIndex?: number;
      action?: ResumeAction;
      prompt?: string;
      roleId?: string;
    };

    if (!action || !['recover', 'nudge', 'restart_role', 'cancel', 'skip'].includes(action)) {
      return NextResponse.json(
        { error: 'Missing or invalid action. Must be "recover", "nudge", "restart_role", "cancel", or "skip".' },
        { status: 400 },
      );
    }

    const targetStage = requestedStageIndex !== undefined
      ? project.pipelineState.stages[requestedStageIndex]
      : getFirstActionableStage(projectId);
    if (!targetStage) {
      const error = requestedStageIndex !== undefined
        ? `Stage ${requestedStageIndex} not found`
        : 'No actionable stages found in pipeline';
      return NextResponse.json({ error }, { status: 400 });
    }

    const shortProjectId = projectId.slice(0, 8);

    // Skip action can be performed without a runId (e.g. for pending stages)
    if (action === 'skip') {
      const allowedSkipStatuses = ['pending', 'failed', 'blocked', 'cancelled'];
      if (!allowedSkipStatuses.includes(targetStage.status)) {
        return NextResponse.json(
          {
            error: `Cannot skip stage in status '${targetStage.status}': allowed statuses are ${allowedSkipStatuses.join(', ')}`,
            requestedAction: action,
          },
          { status: 409 },
        );
      }

      updatePipelineStage(projectId, targetStage.stageIndex, { status: 'skipped', completedAt: new Date().toISOString() });
      
      return responseForAction({
        status: 'skipped',
        requestedAction: action,
        actualAction: action,
        stageIndex: targetStage.stageIndex,
        groupId: targetStage.groupId,
        runId: targetStage.runId || '',
        message: 'Stage skipped successfully',
      });
    }

    if (!targetStage.runId) {
      return NextResponse.json({ error: 'Selected stage has no canonical run to resume' }, { status: 409 });
    }

    const existingRun = getRun(targetStage.runId);
    if (!existingRun) {
      return NextResponse.json({ error: 'Canonical run not found for selected stage' }, { status: 404 });
    }

    const isStaleActive = (existingRun.status === 'starting' || existingRun.status === 'running') && !!existingRun.liveState?.staleSince;
    const isRestartable = existingRun.status === 'failed'
      || existingRun.status === 'blocked'
      || existingRun.status === 'timeout'
      || existingRun.status === 'cancelled'
      || isStaleActive;
    const isCancellable = existingRun.status === 'starting' || existingRun.status === 'running' || existingRun.status === 'blocked';

    log.info({
      projectId: shortProjectId,
      stageIndex: targetStage.stageIndex,
      action,
      groupId: targetStage.groupId,
      runId: targetStage.runId.slice(0, 8),
    }, 'Resuming project pipeline');

    if (action === 'recover') {
      if (recoverInterruptedRun(existingRun, true)) {
        const recoveredResult = existingRun.result;
        const recoveredOutcome = existingRun.reviewOutcome;
        existingRun.status = 'failed';
        updateRun(existingRun.runId, {
          status: 'completed',
          result: recoveredResult,
          reviewOutcome: recoveredOutcome,
          lastError: undefined,
        });

        log.info({
          projectId: shortProjectId,
          runId: existingRun.runId.slice(0, 8),
          stageIndex: targetStage.stageIndex,
        }, 'Pipeline stage recovered from artifacts');

        return responseForAction({
          status: 'recovered',
          requestedAction: action,
          actualAction: action,
          stageIndex: targetStage.stageIndex,
          groupId: targetStage.groupId,
          runId: existingRun.runId,
          activeConversationId: existingRun.activeConversationId,
          message: 'Recovered from existing artifacts',
        });
      }

      return NextResponse.json(
        { error: 'Cannot recover run: no completion signals found in artifacts', requestedAction: action },
        { status: 400 },
      );
    }

    if (action === 'nudge') {
      if (!isStaleActive) {
        return NextResponse.json(
          {
            error: `Cannot nudge run in status '${existingRun.status}': only stale-active runs are supported`,
            requestedAction: action,
            currentRunStatus: existingRun.status,
          },
          { status: 409 },
        );
      }

      incrementStageAttempts(projectId, targetStage.stageIndex);
      try {
        interveneRun(existingRun.runId, 'nudge', prompt, roleId).catch((err: any) => {
          log.error({ projectId: shortProjectId, err: err.message }, 'Resume nudge failed');
        });
      } catch (err: any) {
        if (err instanceof InterventionConflictError) {
          return NextResponse.json({ error: err.message, requestedAction: action }, { status: 409 });
        }
        throw err;
      }

      return responseForAction({
        status: 'resuming',
        requestedAction: action,
        actualAction: action,
        stageIndex: targetStage.stageIndex,
        groupId: targetStage.groupId,
        runId: existingRun.runId,
        activeConversationId: existingRun.activeConversationId,
      });
    }

    if (action === 'restart_role') {
      if (!isRestartable) {
        return NextResponse.json(
          {
            error: `Cannot restart role for run in status '${existingRun.status}'`,
            requestedAction: action,
            currentRunStatus: existingRun.status,
          },
          { status: 409 },
        );
      }

      incrementStageAttempts(projectId, targetStage.stageIndex);
      try {
        interveneRun(existingRun.runId, 'restart_role', prompt, roleId).catch((err: any) => {
          log.error({ projectId: shortProjectId, err: err.message }, 'Resume restart_role failed');
        });
      } catch (err: any) {
        if (err instanceof InterventionConflictError) {
          return NextResponse.json({ error: err.message, requestedAction: action }, { status: 409 });
        }
        throw err;
      }

      return responseForAction({
        status: 'resuming',
        requestedAction: action,
        actualAction: action,
        stageIndex: targetStage.stageIndex,
        groupId: targetStage.groupId,
        runId: existingRun.runId,
        activeConversationId: existingRun.activeConversationId,
      });
    }

    if (!isCancellable) {
      return NextResponse.json(
        {
          error: `Cannot cancel run in status '${existingRun.status}'`,
          requestedAction: action,
          currentRunStatus: existingRun.status,
        },
        { status: 409 },
      );
    }

    await cancelRun(existingRun.runId);
    return responseForAction({
      status: 'cancelled',
      requestedAction: action,
      actualAction: action,
      stageIndex: targetStage.stageIndex,
      groupId: targetStage.groupId,
      runId: existingRun.runId,
      activeConversationId: existingRun.activeConversationId,
    });
  } catch (err: any) {
    log.error({ err: err.message }, 'Resume failed');
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
