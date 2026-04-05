import { NextResponse } from 'next/server';
import path from 'path';
import { getWorkspaces } from '@/lib/bridge/gateway';
import { getProjectsByWorkspace, getJournalEntriesForDate, templateSummary } from '@/lib/agents/digest-helpers';
import { getQuotaSummary } from '@/lib/approval/token-quota';

export const dynamic = 'force-dynamic';

function isRegisteredWorkspace(uri: string): boolean {
  const registered = getWorkspaces() as Array<{ uri: string }>;
  return registered.some(w => w.uri.replace(/^file:\/\//, '') === uri);
}

function isToday(isoDate: string | undefined, date: string): boolean {
  if (!isoDate) return false;
  return isoDate.startsWith(date);
}

/**
 * Helper: get date range for a period.
 */
function getDateRange(baseDate: string, period: string): string[] {
  const dates: string[] = [];
  const base = new Date(baseDate + 'T00:00:00Z');
  const days = period === 'month' ? 30 : period === 'week' ? 7 : 1;
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

// GET /api/departments/digest?workspace=<encoded_uri>&date=2026-01-15&period=day|week|month
export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspace = url.searchParams.get('workspace');
  if (!workspace) return NextResponse.json({ error: 'Missing workspace' }, { status: 400 });

  const uri = workspace.replace(/^file:\/\//, '');
  if (!isRegisteredWorkspace(uri)) return NextResponse.json({ error: 'Unknown workspace' }, { status: 403 });

  const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const period = url.searchParams.get('period') || 'day';

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, { status: 400 });
  }
  if (!['day', 'week', 'month'].includes(period)) {
    return NextResponse.json({ error: 'Invalid period, expected day|week|month' }, { status: 400 });
  }

  const projects = getProjectsByWorkspace(workspace);
  const dateRange = getDateRange(date, period);
  const entries = dateRange.flatMap(d => getJournalEntriesForDate(workspace, d));

  const dateSet = new Set(dateRange);
  const matchesRange = (isoDate: string | undefined) => {
    if (!isoDate) return false;
    return dateSet.has(isoDate.slice(0, 10));
  };

  const completed = projects
    .filter(p => p.status === 'completed' && matchesRange(p.updatedAt))
    .map(p => ({ projectId: p.projectId, projectName: p.name, description: p.goal || '' }));

  const inProgress = projects
    .filter(p => p.status === 'active')
    .map(p => {
      const stages = p.pipelineState?.stages || [];
      const done = stages.filter(s => s.status === 'completed' || s.status === 'skipped').length;
      return {
        projectId: p.projectId,
        projectName: p.name,
        description: p.goal || '',
        progress: stages.length > 0 ? `Stage ${done}/${stages.length}` : undefined,
      };
    });

  const blocked = projects
    .filter(p => p.pipelineState?.stages.some(s => s.status === 'blocked' || s.status === 'failed'))
    .map(p => {
      const failedStage = p.pipelineState?.stages.find(s => s.status === 'blocked' || s.status === 'failed');
      return {
        projectId: p.projectId,
        description: failedStage?.lastError || `${p.name} blocked`,
        since: failedStage?.startedAt || p.updatedAt || '',
      };
    });

  const periodLabel = period === 'month' ? '本月' : period === 'week' ? '本周' : '今日';
  const summary = period === 'day'
    ? templateSummary(completed.map(c => ({ name: c.projectName })), inProgress.map(c => ({ name: c.projectName })))
    : `${periodLabel}${completed.length ? `完成 ${completed.length} 项任务` : ''}${inProgress.length ? `${completed.length ? '，' : ''}${inProgress.length} 项进行中` : ''}${blocked.length ? `${completed.length || inProgress.length ? '，' : ''}${blocked.length} 项阻塞` : ''}` || `${periodLabel}暂无活动`;

  // Aggregate token usage from journal entries
  let inputTokens = 0;
  let outputTokens = 0;
  for (const entry of entries) {
    const details = entry.details as Record<string, unknown> | undefined;
    if (details?.inputTokens) inputTokens += Number(details.inputTokens) || 0;
    if (details?.outputTokens) outputTokens += Number(details.outputTokens) || 0;
  }
  const totalTokens = inputTokens + outputTokens;
  // Rough cost estimate: $3/M input, $15/M output (Claude Sonnet pricing)
  const estimatedCostUsd = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;

  return NextResponse.json({
    workspaceUri: workspace,
    departmentName: path.basename(uri),
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
