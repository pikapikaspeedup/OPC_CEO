import { NextResponse } from 'next/server';
import { getProject, getFirstActionableStage, incrementStageAttempts, updatePipelineStage, updatePipelineStageByStageId } from '@/lib/agents/project-registry';
import { getRun, recoverInterruptedRun, updateRun } from '@/lib/agents/run-registry';
import { cancelRun, interveneRun, InterventionConflictError } from '@/lib/agents/group-runtime';
import { emitProjectEvent } from '@/lib/agents/project-events';
import { createLogger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const log = createLogger('ProjectResume');

type ResumeAction = 'recover' | 'nudge' | 'restart_role' | 'cancel' | 'skip' | 'force-complete';

function responseForAction(input: {
  status: string;
  requestedAction: ResumeAction;
  actualAction: ResumeAction;
  stageId: string;
  stageIndex: number;
  runId: string;
  stageTitle?: string;
  branchIndex?: number;
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
      stageId: requestedStageId,
      stageIndex: requestedStageIndex,
      branchIndex: requestedBranchIndex,
      action,
      prompt,
      roleId,
    } = body as {
      stageId?: string;
      stageIndex?: number;
      branchIndex?: number;
      action?: ResumeAction;
      prompt?: string;
      roleId?: string;
    };

    if (!action || !['recover', 'nudge', 'restart_role', 'cancel', 'skip', 'force-complete'].includes(action)) {
      return NextResponse.json(
        { error: 'Missing or invalid action. Must be "recover", "nudge", "restart_role", "cancel", "skip", or "force-complete".' },
        { status: 400 },
      );
    }

    const targetStage = requestedStageId
      ? project.pipelineState.stages.find(stage => stage.stageId === requestedStageId)
      : requestedStageIndex !== undefined
        ? project.pipelineState.stages[requestedStageIndex]
        : getFirstActionableStage(projectId);
    if (!targetStage) {
      const error = requestedStageId
        ? `Stage ${requestedStageId} not found`
        : requestedStageIndex !== undefined
          ? `Stage ${requestedStageIndex} not found`
          : 'No actionable stages found in pipeline';
      return NextResponse.json({ error }, { status: 400 });
    }

    let effectiveProjectId = projectId;
    let effectiveStage = targetStage;
    let effectiveBranchIndex = requestedBranchIndex;
    if (requestedBranchIndex !== undefined) {
      const branch = targetStage.branches?.find(item => item.branchIndex === requestedBranchIndex);
      if (!branch?.subProjectId) {
        return NextResponse.json({ error: `Branch ${requestedBranchIndex} not found on stage ${targetStage.stageId}` }, { status: 404 });
      }
      const subProject = getProject(branch.subProjectId);
      if (!subProject?.pipelineState) {
        return NextResponse.json({ error: `Sub-project ${branch.subProjectId} has no pipeline state` }, { status: 409 });
      }
      const subStage = getFirstActionableStage(branch.subProjectId);
      if (!subStage) {
        return NextResponse.json({ error: `No actionable stages found in sub-project ${branch.subProjectId}` }, { status: 409 });
      }
      effectiveProjectId = branch.subProjectId;
      effectiveStage = subStage;
    }

    const shortProjectId = projectId.slice(0, 8);

    // Force-complete: mark stage as completed and emit event to trigger downstream dispatch
    if (action === 'force-complete') {
      const allowedStatuses = ['running', 'failed', 'blocked', 'cancelled', 'pending'];
      if (!allowedStatuses.includes(targetStage.status)) {
        return NextResponse.json(
          {
            error: `Cannot force-complete stage in status '${targetStage.status}': allowed statuses are ${allowedStatuses.join(', ')}`,
            requestedAction: action,
          },
          { status: 409 },
        );
      }

      log.info({
        projectId: shortProjectId,
        stageId: effectiveStage.stageId,
        stageIndex: effectiveStage.stageIndex,
        previousStatus: targetStage.status,
        runId: targetStage.runId?.slice(0, 8),
      }, 'Force-completing pipeline stage');

      if (effectiveStage.stageId) {
        updatePipelineStageByStageId(effectiveProjectId, effectiveStage.stageId, {
          status: 'completed',
          completedAt: new Date().toISOString(),
        });
      } else {
        updatePipelineStage(effectiveProjectId, effectiveStage.stageIndex, {
          status: 'completed',
          completedAt: new Date().toISOString(),
        });
      }

      // Emit stage:completed event — this is the KEY trigger for downstream dispatch
      // fan-out-controller.handleProjectEvent() will call tryFanOut() + dispatchDownstreamStages()
      emitProjectEvent({
        type: 'stage:completed',
        projectId: effectiveProjectId,
        stageId: effectiveStage.stageId || `stage-${effectiveStage.stageIndex}`,
        runId: targetStage.runId || '',
        nodeKind: 'stage',
      });

      // V5.3 Fix: If this was a sub-project (like a fan-out branch) and this stage completion 
      // caused the entire project to complete, we must explicitly emit project:completed.
      // Otherwise fan-out-controller won't bubble up the branch completion to the parent.
      const updatedProject = getProject(effectiveProjectId);
      if (updatedProject?.pipelineState?.status === 'completed') {
        emitProjectEvent({ type: 'project:completed', projectId: effectiveProjectId });
      }

      return responseForAction({
        status: 'force-completed',
        requestedAction: action,
        actualAction: action,
        stageId: effectiveStage.stageId,
        stageIndex: effectiveStage.stageIndex,
        stageTitle: effectiveStage.title || effectiveStage.stageId,
        runId: effectiveStage.runId || '',
        branchIndex: effectiveBranchIndex,
        message: 'Stage force-completed. Downstream stages will be dispatched automatically.',
      });
    }

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

      if (effectiveStage.stageId) {
        updatePipelineStageByStageId(effectiveProjectId, effectiveStage.stageId, {
          status: 'skipped',
          completedAt: new Date().toISOString(),
        });
      } else {
        updatePipelineStage(effectiveProjectId, effectiveStage.stageIndex, { status: 'skipped', completedAt: new Date().toISOString() });
      }

      // V5.3 Fix: Ensure project completion is bubbled up if this skip completes a branch
      const updatedProject = getProject(effectiveProjectId);
      if (updatedProject?.pipelineState?.status === 'completed') {
        emitProjectEvent({ type: 'project:completed', projectId: effectiveProjectId });
      }

      return responseForAction({
        status: 'skipped',
        requestedAction: action,
        actualAction: action,
        stageId: effectiveStage.stageId,
        stageIndex: effectiveStage.stageIndex,
        stageTitle: effectiveStage.title || effectiveStage.stageId,
        runId: effectiveStage.runId || '',
        branchIndex: effectiveBranchIndex,
        message: 'Stage skipped successfully',
      });
    }

    if (!effectiveStage.runId) {
      return NextResponse.json({ error: 'Selected stage has no canonical run to resume' }, { status: 409 });
    }

    const existingRun = getRun(effectiveStage.runId);
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
      stageId: effectiveStage.stageId,
      stageIndex: effectiveStage.stageIndex,
      action,
      stageTitle: effectiveStage.title || effectiveStage.stageId,
      runId: effectiveStage.runId.slice(0, 8),
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
          stageId: effectiveStage.stageId,
          stageIndex: effectiveStage.stageIndex,
          stageTitle: effectiveStage.title || effectiveStage.stageId,
          runId: existingRun.runId,
          branchIndex: effectiveBranchIndex,
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

      incrementStageAttempts(effectiveProjectId, effectiveStage.stageId || effectiveStage.stageIndex);
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
        stageId: effectiveStage.stageId,
        stageIndex: effectiveStage.stageIndex,
        stageTitle: effectiveStage.title || effectiveStage.stageId,
        runId: existingRun.runId,
        branchIndex: effectiveBranchIndex,
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

      incrementStageAttempts(effectiveProjectId, effectiveStage.stageId || effectiveStage.stageIndex);
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
        stageId: effectiveStage.stageId,
        stageIndex: effectiveStage.stageIndex,
        stageTitle: effectiveStage.title || effectiveStage.stageId,
        runId: existingRun.runId,
        branchIndex: effectiveBranchIndex,
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
      stageId: effectiveStage.stageId,
      stageIndex: effectiveStage.stageIndex,
      stageTitle: effectiveStage.title || effectiveStage.stageId,
      runId: existingRun.runId,
      branchIndex: effectiveBranchIndex,
      activeConversationId: existingRun.activeConversationId,
    });
  } catch (err: any) {
    log.error({ err: err.message }, 'Resume failed');
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
