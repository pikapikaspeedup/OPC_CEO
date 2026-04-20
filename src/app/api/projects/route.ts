import { NextResponse } from 'next/server';
import { paginateArray, parsePaginationSearchParams } from '@/lib/pagination';
import { getErrorMessage, normalizeProject } from '@/lib/project-utils';
import { listProjectRecords, listRunRecordsByIds } from '@/lib/storage/gateway-db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, goal, templateId, workspace, projectType, skillHint } = body;

    if (!name || !goal || !workspace) {
      return NextResponse.json({ error: 'Missing required fields: name, goal, workspace' }, { status: 400 });
    }

    const { createProject } = await import('@/lib/agents/project-registry');
    const project = createProject({ name, goal, templateId, workspace, projectType, skillHint });
    return NextResponse.json(project, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pagination = parsePaginationSearchParams(searchParams, {
    defaultPageSize: 100,
    maxPageSize: 200,
  });
  const projects = listProjectRecords();
  const pagedProjects = paginateArray(projects, pagination);
  const runIdsNeedingLookup = Array.from(new Set(
    pagedProjects.items.flatMap((project) =>
      (project.pipelineState?.stages || [])
        .filter((stage) => !stage.lastError && !!stage.runId && ['failed', 'blocked', 'cancelled'].includes(stage.status))
        .map((stage) => stage.runId!)
    ),
  ));
  const runs = listRunRecordsByIds(runIdsNeedingLookup);
  const runMap = new Map(runs.map((run) => [run.runId, run]));

  const normalizedProjects = pagedProjects.items.map((project) => normalizeProject(project, {
    getRunById: (runId) => runMap.get(runId),
  }));

  return NextResponse.json({
    ...pagedProjects,
    items: normalizedProjects,
  });
}
