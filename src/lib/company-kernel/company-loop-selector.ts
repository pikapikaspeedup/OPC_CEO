import type {
  CompanyLoopAgendaAction,
  CompanyLoopPolicy,
  OperatingAgendaAction,
  OperatingAgendaItem,
  OperatingSignal,
} from './contracts';
import { getOperatingSignal } from './operating-signal-store';

export interface CompanyLoopSkippedAgenda {
  item: OperatingAgendaItem;
  reason: string;
}

export interface CompanyLoopSelection {
  selected: OperatingAgendaItem[];
  dispatchCandidates: OperatingAgendaItem[];
  digestOnly: CompanyLoopSkippedAgenda[];
  skipped: CompanyLoopSkippedAgenda[];
}

export interface SelectCompanyLoopAgendaInput {
  policy: CompanyLoopPolicy;
  agenda: OperatingAgendaItem[];
  signalResolver?: (id: string) => OperatingSignal | null;
}

const PRIORITY_WEIGHT: Record<OperatingAgendaItem['priority'], number> = {
  p0: 100,
  p1: 75,
  p2: 45,
  p3: 20,
};

const ACTION_WEIGHT: Record<OperatingAgendaAction, number> = {
  dispatch: 100,
  approve: 70,
  ask_user: 65,
  observe: 35,
  snooze: 20,
  dismiss: 5,
};

function mapAgendaAction(action: OperatingAgendaAction): CompanyLoopAgendaAction {
  if (action === 'ask_user') return 'observe';
  return action;
}

function agendaDedupeKey(item: OperatingAgendaItem): string {
  const metadataKey = typeof item.metadata?.dedupeKey === 'string' ? item.metadata.dedupeKey : '';
  if (metadataKey) return metadataKey;
  if (item.signalIds.length > 0) return item.signalIds.slice().sort().join('|');
  return item.title.trim().toLowerCase();
}

function agendaAgeWeight(item: OperatingAgendaItem): number {
  const ageMs = Date.now() - new Date(item.createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 0;
  return Math.min(100, Math.floor(ageMs / 3_600_000));
}

function resolveAgendaRisk(
  item: OperatingAgendaItem,
  signalResolver: (id: string) => OperatingSignal | null,
): number {
  const metadataRisk = item.metadata?.risk;
  const parsedMetadataRisk = typeof metadataRisk === 'number' ? metadataRisk : Number(metadataRisk);
  const signalRisks = item.signalIds
    .map((id) => signalResolver(id)?.risk)
    .filter((risk): risk is number => typeof risk === 'number' && Number.isFinite(risk));
  return Math.max(
    Number.isFinite(parsedMetadataRisk) ? parsedMetadataRisk : 0,
    ...signalRisks,
  );
}

function loopSelectionScore(
  item: OperatingAgendaItem,
  risk: number,
): number {
  const priorityWeight = PRIORITY_WEIGHT[item.priority] || 0;
  const ageWeight = agendaAgeWeight(item);
  const actionWeight = ACTION_WEIGHT[item.recommendedAction] || 0;
  const riskPenalty = Math.max(0, risk);
  const costPenalty = Math.min(100, (item.estimatedCost.tokens / 1000) + item.estimatedCost.minutes);
  return (item.score * 0.45)
    + (priorityWeight * 0.2)
    + (ageWeight * 0.1)
    + (actionWeight * 0.1)
    - (riskPenalty * 0.1)
    - (costPenalty * 0.05);
}

export function selectCompanyLoopAgenda(input: SelectCompanyLoopAgendaInput): CompanyLoopSelection {
  const signalResolver = input.signalResolver || getOperatingSignal;
  const allowedActions = new Set(input.policy.allowedAgendaActions);
  const seenDedupeKeys = new Set<string>();
  const skipped: CompanyLoopSkippedAgenda[] = [];
  const digestOnly: CompanyLoopSkippedAgenda[] = [];

  const scored = input.agenda
    .map((item) => {
      const risk = resolveAgendaRisk(item, signalResolver);
      return {
        item,
        risk,
        score: loopSelectionScore(item, risk),
      };
    })
    .sort((a, b) => b.score - a.score);

  const selected: OperatingAgendaItem[] = [];
  const dispatchCandidates: OperatingAgendaItem[] = [];

  for (const candidate of scored) {
    const item = candidate.item;
    if (item.status !== 'ready' && item.status !== 'triaged') {
      skipped.push({ item, reason: `status:${item.status}` });
      continue;
    }

    const dedupeKey = agendaDedupeKey(item);
    if (seenDedupeKeys.has(dedupeKey)) {
      skipped.push({ item, reason: `duplicate:${dedupeKey}` });
      continue;
    }
    seenDedupeKeys.add(dedupeKey);

    const action = mapAgendaAction(item.recommendedAction);
    if (!allowedActions.has(action)) {
      digestOnly.push({ item, reason: `action-not-allowed:${action}` });
      continue;
    }

    if (item.recommendedAction === 'approve') {
      digestOnly.push({ item, reason: 'approval-requires-human' });
      selected.push(item);
      if (selected.length >= input.policy.maxAgendaPerDailyLoop) {
        break;
      }
      continue;
    }

    if (item.recommendedAction === 'dispatch' && candidate.risk >= 75) {
      digestOnly.push({ item, reason: `risk-too-high:${candidate.risk}` });
      selected.push(item);
      if (selected.length >= input.policy.maxAgendaPerDailyLoop) {
        break;
      }
      continue;
    }

    selected.push(item);
    if (item.recommendedAction === 'dispatch') {
      dispatchCandidates.push(item);
    }

    if (selected.length >= input.policy.maxAgendaPerDailyLoop) {
      break;
    }
  }

  return {
    selected,
    dispatchCandidates: dispatchCandidates.slice(0, input.policy.maxAutonomousDispatchesPerLoop),
    digestOnly,
    skipped,
  };
}
