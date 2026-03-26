import type { AgentRun } from './types';
import { formatRelativeTime } from './i18n/formatting';
import type { Locale } from './i18n';

export function isAgentRunActive(status: string): boolean {
  return status === 'running' || status === 'starting';
}

export function getAgentRunWorkspaceName(uri: string): string {
  if (!uri) return 'Workspace';
  if (uri.includes('/playground/')) return 'Playground';
  const parts = uri.replace(/^file:\/\//, '').split('/').filter(Boolean);
  return parts[parts.length - 1] || 'Workspace';
}

export function getAgentRunTimeAgo(date: string, locale: Locale = 'en'): string {
  return formatRelativeTime(date, locale);
}

export function getAgentRunDuration(run: AgentRun): string | null {
  const end = run.finishedAt || (isAgentRunActive(run.status) ? new Date().toISOString() : '');
  if (!end) return null;
  const diffSeconds = Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(run.startedAt || run.createdAt).getTime()) / 1000),
  );

  if (diffSeconds < 60) return `${diffSeconds}s`;
  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

export function pickDefaultAgentRun(
  runs: AgentRun[],
  selectedRunId: string | null,
): string | null {
  if (selectedRunId && runs.some(run => run.runId === selectedRunId)) {
    return selectedRunId;
  }

  const nextRun = runs.find(run => isAgentRunActive(run.status)) || runs[0];
  return nextRun?.runId || null;
}
