import { listRecentKnowledgeAssets } from '../knowledge/store';
import { listOperatingAgendaItems } from './agenda-store';
import { listMemoryCandidates } from './memory-candidate-store';
import { getOperatingSignal, listOperatingSignals } from './operating-signal-store';
import { listRunCapsules } from './run-capsule-store';
import type {
  CompanyOperatingDay,
  DepartmentOperatingStateSummary,
  OperatingAgendaItem,
  OperatingSignal,
  RunCapsule,
} from './contracts';

export interface CompanyOperatingDayQuery {
  date?: string;
  timezone?: string;
  workspaceUri?: string;
  limit?: number;
}

function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isSameDate(value: string | undefined, date: string, timezone: string): boolean {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed) === date;
}

function buildDepartmentStates(input: {
  capsules: RunCapsule[];
  signals: OperatingSignal[];
  agenda: OperatingAgendaItem[];
}): DepartmentOperatingStateSummary[] {
  const workspaceUris = new Set<string>();
  for (const capsule of input.capsules) workspaceUris.add(capsule.workspaceUri);
  for (const signal of input.signals) if (signal.workspaceUri) workspaceUris.add(signal.workspaceUri);
  for (const item of input.agenda) {
    if (item.workspaceUri) workspaceUris.add(item.workspaceUri);
    if (item.targetDepartmentId) workspaceUris.add(item.targetDepartmentId);
  }

  return Array.from(workspaceUris).map((workspaceUri) => {
    const capsuleMatches = input.capsules.filter((capsule) => capsule.workspaceUri === workspaceUri);
    const signalMatches = input.signals.filter((signal) => signal.workspaceUri === workspaceUri);
    const agendaMatches = input.agenda.filter((item) => item.workspaceUri === workspaceUri || item.targetDepartmentId === workspaceUri);
    return {
      workspaceUri,
      activeRuns: capsuleMatches.filter((capsule) => capsule.status === 'running' || capsule.status === 'queued' || capsule.status === 'starting').length,
      completedRuns: capsuleMatches.filter((capsule) => capsule.status === 'completed').length,
      blockedRuns: capsuleMatches.filter((capsule) => capsule.status === 'blocked' || capsule.status === 'failed' || capsule.status === 'timeout').length,
      activeSignals: signalMatches.length,
      topAgendaItemIds: agendaMatches.slice(0, 5).map((item) => item.id),
      updatedAt: new Date().toISOString(),
    };
  }).sort((a, b) => b.activeSignals - a.activeSignals || b.blockedRuns - a.blockedRuns);
}

export function getCompanyOperatingDay(query: CompanyOperatingDayQuery = {}): CompanyOperatingDay {
  const timezone = query.timezone || 'Asia/Shanghai';
  const date = query.date || todayInTimezone(timezone);
  const limit = Math.max(1, Math.min(100, Math.trunc(query.limit || 20)));
  const now = new Date().toISOString();

  const agenda = listOperatingAgendaItems({
    ...(query.workspaceUri ? { workspaceUri: query.workspaceUri } : {}),
    status: ['triaged', 'ready', 'blocked', 'snoozed'],
    limit,
  });
  const activeSignalsBase = listOperatingSignals({
    ...(query.workspaceUri ? { workspaceUri: query.workspaceUri } : {}),
    status: ['observed', 'triaged'],
    limit,
  });
  const activeSignalIds = new Set(activeSignalsBase.map((signal) => signal.id));
  const agendaSignals = agenda
    .flatMap((item) => item.signalIds)
    .filter((id) => !activeSignalIds.has(id))
    .map((id) => getOperatingSignal(id))
    .filter((signal): signal is OperatingSignal => Boolean(signal));
  const activeSignals = [...activeSignalsBase, ...agendaSignals].slice(0, Math.max(limit, agenda.length * 3));
  const capsules = listRunCapsules({
    ...(query.workspaceUri ? { workspaceUri: query.workspaceUri } : {}),
    limit: Math.max(limit, 50),
  });
  const memoryCandidates = listMemoryCandidates({
    ...(query.workspaceUri ? { workspaceUri: query.workspaceUri } : {}),
    status: ['candidate', 'pending-review'],
    limit,
  });
  const recentKnowledge = listRecentKnowledgeAssets(limit)
    .filter((asset) => (!query.workspaceUri || asset.workspaceUri === query.workspaceUri)
      && isSameDate(asset.updatedAt, date, timezone));

  const activeRuns = capsules
    .filter((capsule) => capsule.status === 'queued' || capsule.status === 'starting' || capsule.status === 'running')
    .map((capsule) => capsule.runId);
  const completedRuns = capsules
    .filter((capsule) => capsule.status === 'completed' && isSameDate(capsule.finishedAt || capsule.updatedAt, date, timezone))
    .map((capsule) => capsule.runId);

  return {
    date,
    timezone,
    focus: agenda.slice(0, 3).map((item) => item.title),
    agenda,
    activeSignals,
    departmentStates: buildDepartmentStates({ capsules, signals: activeSignals, agenda }),
    activeRuns,
    completedRuns,
    newKnowledgeIds: recentKnowledge.map((asset) => asset.id),
    memoryCandidateIds: memoryCandidates.map((candidate) => candidate.id),
    blockedSignals: activeSignals
      .filter((signal) => signal.kind === 'risk' || signal.kind === 'failure')
      .map((signal) => signal.id),
    createdAt: now,
    updatedAt: now,
  };
}
