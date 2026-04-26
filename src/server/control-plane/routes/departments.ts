import fs from 'fs';
import path from 'path';

import {
  appendDepartmentMemory,
  initDepartmentMemory,
  readDepartmentMemory,
  readOrganizationMemory,
  type MemoryCategory,
} from '@/lib/agents/department-memory';
import { syncRulesToAllIDEs, syncRulesToIDE, type IDETarget } from '@/lib/agents/department-sync';
import { getJournalEntriesForDate, getProjectsByWorkspace, templateSummary } from '@/lib/agents/digest-helpers';
import { getQuotaSummary } from '@/lib/approval/token-quota';
import { getKnownWorkspace } from '@/lib/workspace-catalog';

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function resolveWorkspace(req: Request): string | null {
  const url = new URL(req.url);
  return url.searchParams.get('workspace') || null;
}

function resolveKnownWorkspace(req: Request): { uri: string; path: string } | Response {
  const workspaceUri = resolveWorkspace(req);
  if (!workspaceUri) {
    return json({ error: 'Missing workspace' }, { status: 400 });
  }
  const workspace = getKnownWorkspace(workspaceUri);
  if (!workspace) {
    return json({ error: 'Unknown workspace' }, { status: 403 });
  }
  return workspace;
}

function getDateRange(baseDate: string, period: string): string[] {
  const dates: string[] = [];
  const base = new Date(`${baseDate}T00:00:00Z`);
  const days = period === 'month' ? 30 : period === 'week' ? 7 : 1;
  for (let i = 0; i < days; i += 1) {
    const date = new Date(base);
    date.setUTCDate(date.getUTCDate() - i);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

const VALID_MEMORY_CATEGORIES: MemoryCategory[] = ['knowledge', 'decisions', 'patterns'];
const VALID_SYNC_TARGETS: IDETarget[] = ['antigravity', 'codex', 'claude-code', 'cursor'];

export async function handleDepartmentsGet(req: Request): Promise<Response> {
  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  const configPath = path.join(workspace.path, '.department', 'config.json');
  if (!fs.existsSync(configPath)) {
    return json({
      name: path.basename(workspace.path),
      type: 'build',
      skills: [],
      okr: null,
    });
  }

  try {
    return json(JSON.parse(fs.readFileSync(configPath, 'utf-8')));
  } catch {
    return json({ error: 'Invalid .department/config.json format' }, { status: 422 });
  }
}

export async function handleDepartmentsPut(req: Request): Promise<Response> {
  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  const config = await req.json();
  const dir = path.join(workspace.path, '.department');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));

  return json({ ok: true, syncPending: true });
}

export async function handleDepartmentsDigestGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const workspaceUri = url.searchParams.get('workspace');
  if (!workspaceUri) {
    return json({ error: 'Missing workspace' }, { status: 400 });
  }

  const workspace = getKnownWorkspace(workspaceUri);
  if (!workspace) {
    return json({ error: 'Unknown workspace' }, { status: 403 });
  }

  const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const period = url.searchParams.get('period') || 'day';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: 'Invalid date format, expected YYYY-MM-DD' }, { status: 400 });
  }
  if (!['day', 'week', 'month'].includes(period)) {
    return json({ error: 'Invalid period, expected day|week|month' }, { status: 400 });
  }

  const projects = getProjectsByWorkspace(workspaceUri);
  const dateRange = getDateRange(date, period);
  const dateSet = new Set(dateRange);
  const entries = dateRange.flatMap((day) => getJournalEntriesForDate(workspaceUri, day));
  const matchesRange = (isoDate: string | undefined) => !!isoDate && dateSet.has(isoDate.slice(0, 10));

  const completed = projects
    .filter((project) => project.status === 'completed' && matchesRange(project.updatedAt))
    .map((project) => ({
      projectId: project.projectId,
      projectName: project.name,
      description: project.goal || '',
    }));

  const inProgress = projects
    .filter((project) => project.status === 'active')
    .map((project) => {
      const stages = project.pipelineState?.stages || [];
      const done = stages.filter((stage) => stage.status === 'completed' || stage.status === 'skipped').length;
      return {
        projectId: project.projectId,
        projectName: project.name,
        description: project.goal || '',
        progress: stages.length > 0 ? `Stage ${done}/${stages.length}` : undefined,
      };
    });

  const blocked = projects
    .filter((project) => project.pipelineState?.stages.some((stage) => stage.status === 'blocked' || stage.status === 'failed'))
    .map((project) => {
      const failedStage = project.pipelineState?.stages.find((stage) => stage.status === 'blocked' || stage.status === 'failed');
      return {
        projectId: project.projectId,
        description: failedStage?.lastError || `${project.name} blocked`,
        since: failedStage?.startedAt || project.updatedAt || '',
      };
    });

  const periodLabel = period === 'month' ? '本月' : period === 'week' ? '本周' : '今日';
  const summary = period === 'day'
    ? templateSummary(
      completed.map((item) => ({ name: item.projectName })),
      inProgress.map((item) => ({ name: item.projectName })),
    )
    : `${periodLabel}${completed.length ? `完成 ${completed.length} 项任务` : ''}${inProgress.length ? `${completed.length ? '，' : ''}${inProgress.length} 项进行中` : ''}${blocked.length ? `${completed.length || inProgress.length ? '，' : ''}${blocked.length} 项阻塞` : ''}` || `${periodLabel}暂无活动`;

  let inputTokens = 0;
  let outputTokens = 0;
  for (const entry of entries) {
    const details = entry.details as Record<string, unknown> | undefined;
    if (details?.inputTokens) {
      inputTokens += Number(details.inputTokens) || 0;
    }
    if (details?.outputTokens) {
      outputTokens += Number(details.outputTokens) || 0;
    }
  }

  const totalTokens = inputTokens + outputTokens;
  const estimatedCostUsd = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;

  return json({
    workspaceUri,
    departmentName: path.basename(workspace.path),
    date,
    period,
    summary,
    tasksCompleted: completed,
    tasksInProgress: inProgress,
    blockers: blocked,
    tokenUsage: totalTokens > 0 ? {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd: Math.round(estimatedCostUsd * 100) / 100,
    } : undefined,
  });
}

export async function handleDepartmentsMemoryGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') || 'department';

  if (scope === 'organization') {
    return json({ scope: 'organization', content: readOrganizationMemory() });
  }

  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  return json({
    scope: 'department',
    workspace: workspace.uri,
    memory: readDepartmentMemory(workspace.path),
  });
}

export async function handleDepartmentsMemoryPost(req: Request): Promise<Response> {
  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  if (action === 'init') {
    initDepartmentMemory(workspace.path);
    return json({ ok: true, action: 'initialized' });
  }

  const category = url.searchParams.get('category') as MemoryCategory | null;
  if (!category || !VALID_MEMORY_CATEGORIES.includes(category)) {
    return json({ error: `Invalid category. Valid: ${VALID_MEMORY_CATEGORIES.join(', ')}` }, { status: 400 });
  }

  const body = await req.json();
  if (!body.content || typeof body.content !== 'string') {
    return json({ error: 'Missing content' }, { status: 400 });
  }

  appendDepartmentMemory(workspace.path, category, {
    timestamp: new Date().toISOString(),
    source: body.source || 'manual',
    content: body.content,
  });

  return json({ ok: true, category });
}

export async function handleDepartmentsQuotaGet(req: Request): Promise<Response> {
  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  return json({
    workspace: workspace.uri,
    quota: getQuotaSummary(workspace.path),
  });
}

export async function handleDepartmentsSyncPost(req: Request): Promise<Response> {
  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  const url = new URL(req.url);
  const target = url.searchParams.get('target') || 'all';

  if (target === 'all') {
    const { results } = syncRulesToAllIDEs(workspace.path);
    return json({ ok: true, results });
  }

  if (!VALID_SYNC_TARGETS.includes(target as IDETarget)) {
    return json({ error: `Invalid target: ${target}. Valid: ${VALID_SYNC_TARGETS.join(', ')}` }, { status: 400 });
  }

  const { synced } = syncRulesToIDE(workspace.path, target as IDETarget);
  return json({ ok: true, target, synced });
}
