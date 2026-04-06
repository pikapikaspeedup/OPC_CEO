import { NextResponse } from 'next/server';
import { executeDispatch, DispatchError } from '@/lib/agents/dispatch-service';
import { listRuns } from '@/lib/agents/run-registry';
import type { RunStatus } from '@/lib/agents/group-types';
import { createLogger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const log = createLogger('AgentRuns');

// POST /api/agent-runs — dispatch a new run
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const result = await executeDispatch({
      workspace: body.workspace,
      prompt: body.prompt,
      model: body.model,
      parentConversationId: body.parentConversationId,
      taskEnvelope: body.taskEnvelope,
      sourceRunIds: body.sourceRunIds,
      projectId: body.projectId,
      pipelineId: body.pipelineId,
      templateId: body.templateId,
      stageId: body.stageId,
      pipelineStageId: body.pipelineStageId,
      pipelineStageIndex: body.pipelineStageIndex,
      templateOverrides: body.templateOverrides,
      conversationMode: body.conversationMode,
    });

    return NextResponse.json({ runId: result.runId, status: 'starting' }, { status: 201 });
  } catch (err: any) {
    const statusCode = err instanceof DispatchError ? err.statusCode : (err.statusCode || 500);
    log.error({ err: err.message }, 'Dispatch failed');
    return NextResponse.json({ error: err.message }, { status: statusCode });
  }
}

// GET /api/agent-runs — list runs with optional filters
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status') as RunStatus | null;
  const stageIdFilter = searchParams.get('stageId');
  const reviewOutcomeFilter = searchParams.get('reviewOutcome');
  const projectIdFilter = searchParams.get('projectId');

  const filter: { status?: RunStatus; stageId?: string; reviewOutcome?: string; projectId?: string } = {};
  if (statusFilter) filter.status = statusFilter;
  if (stageIdFilter) filter.stageId = stageIdFilter;
  if (reviewOutcomeFilter) filter.reviewOutcome = reviewOutcomeFilter;
  if (projectIdFilter) filter.projectId = projectIdFilter;

  const runs = listRuns(Object.keys(filter).length > 0 ? filter : undefined);
  return NextResponse.json(runs.map((run) => ({
    ...run,
    stageId: run.pipelineStageId || run.stageId,
  })));
}
