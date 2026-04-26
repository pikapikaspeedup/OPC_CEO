import { createHash } from 'crypto';

import type {
  OperatingAgendaAction,
  OperatingAgendaItem,
  OperatingAgendaPriority,
  OperatingAgendaStatus,
  OperatingSignal,
} from './contracts';

function hashId(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

export function priorityFromScore(score: number): OperatingAgendaPriority {
  if (score >= 85) return 'p0';
  if (score >= 70) return 'p1';
  if (score >= 50) return 'p2';
  return 'p3';
}

export function recommendedActionForSignal(signal: OperatingSignal): OperatingAgendaAction {
  if (signal.kind === 'decision') return 'approve';
  if (signal.kind === 'failure') return signal.risk >= 80 ? 'ask_user' : 'dispatch';
  if (signal.kind === 'risk') return signal.risk >= 75 ? 'observe' : 'snooze';
  if (signal.kind === 'learning') return signal.value >= 70 ? 'observe' : 'snooze';
  if (signal.kind === 'opportunity') return signal.value >= 80 && signal.risk < 70 ? 'dispatch' : 'observe';
  return 'observe';
}

function statusForAction(action: OperatingAgendaAction): OperatingAgendaStatus {
  if (action === 'dispatch' || action === 'approve') return 'ready';
  if (action === 'ask_user') return 'blocked';
  if (action === 'snooze') return 'snoozed';
  if (action === 'dismiss') return 'dismissed';
  return 'triaged';
}

function buildReason(signals: OperatingSignal[], action: OperatingAgendaAction): string {
  const topSignal = signals[0];
  const score = Math.round(signals.reduce((sum, signal) => sum + signal.score, 0) / Math.max(1, signals.length));
  return [
    `Action: ${action}.`,
    `Score: ${score}.`,
    `Top signal: ${topSignal.title}`,
  ].join(' ');
}

export function buildAgendaItemFromSignals(signals: OperatingSignal[]): OperatingAgendaItem {
  if (signals.length === 0) {
    throw new Error('Cannot build agenda item without signals');
  }

  const sorted = [...signals].sort((a, b) => b.score - a.score);
  const topSignal = sorted[0];
  const averageScore = Math.round(sorted.reduce((sum, signal) => sum + signal.score, 0) / sorted.length);
  const action = recommendedActionForSignal(topSignal);
  const now = new Date().toISOString();
  const signalIds = sorted.map((signal) => signal.id).sort();
  const estimatedCost = sorted.reduce((total, signal) => ({
    tokens: total.tokens + signal.estimatedCost.tokens,
    minutes: total.minutes + signal.estimatedCost.minutes,
  }), { tokens: 0, minutes: 0 });

  return {
    id: `agenda-${hashId(signalIds.join(':'))}`,
    signalIds,
    title: topSignal.title,
    recommendedAction: action,
    ...(topSignal.workspaceUri ? { targetDepartmentId: topSignal.workspaceUri, workspaceUri: topSignal.workspaceUri } : {}),
    ...(topSignal.metadata?.workflowSuggestion && typeof topSignal.metadata.workflowSuggestion === 'object'
      ? { suggestedWorkflowRef: String((topSignal.metadata.workflowSuggestion as { title?: string }).title || '') }
      : {}),
    priority: priorityFromScore(averageScore),
    score: averageScore,
    status: statusForAction(action),
    reason: buildReason(sorted, action),
    evidenceRefs: sorted.flatMap((signal) => signal.evidenceRefs).slice(0, 8),
    estimatedCost,
    createdAt: now,
    updatedAt: now,
    metadata: {
      signalSources: sorted.map((signal) => signal.source),
      signalKinds: sorted.map((signal) => signal.kind),
    },
  };
}
