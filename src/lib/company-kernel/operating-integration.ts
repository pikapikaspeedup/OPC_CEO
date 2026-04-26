import type { ApprovalRequest } from '../approval/types';
import type { MemoryCandidate, OperatingAgendaItem, OperatingSignal, RunCapsule } from './contracts';
import { buildAgendaItemFromSignals } from './agenda';
import { upsertOperatingAgendaItem } from './agenda-store';
import {
  buildApprovalOperatingSignal,
  buildMemoryCandidateOperatingSignal,
  buildRunOperatingSignals,
} from './operating-signal';
import {
  updateOperatingSignalStatus,
  upsertOperatingSignal,
} from './operating-signal-store';

function convertSignalToAgenda(signal: OperatingSignal): OperatingAgendaItem {
  const storedSignal = upsertOperatingSignal(signal);
  const triagedSignal = updateOperatingSignalStatus(storedSignal.id, 'triaged') || storedSignal;
  return upsertOperatingAgendaItem(buildAgendaItemFromSignals([triagedSignal]));
}

export function observeRunCapsuleForAgenda(capsule: RunCapsule): OperatingAgendaItem[] {
  return buildRunOperatingSignals(capsule).map(convertSignalToAgenda);
}

export function observeMemoryCandidateForAgenda(candidate: MemoryCandidate): OperatingAgendaItem | null {
  if (candidate.status === 'promoted' || candidate.status === 'auto-promoted' || candidate.status === 'rejected' || candidate.status === 'archived') {
    return null;
  }
  return convertSignalToAgenda(buildMemoryCandidateOperatingSignal(candidate));
}

export function observeApprovalRequestForAgenda(request: ApprovalRequest): OperatingAgendaItem {
  return convertSignalToAgenda(buildApprovalOperatingSignal({
    id: request.id,
    title: request.status === 'pending'
      ? `Approval required: ${request.title}`
      : `Approval ${request.status}: ${request.title}`,
    summary: request.description,
    workspaceUri: request.workspace,
    createdAt: request.createdAt,
    status: request.status,
    type: request.type,
    risk: request.urgency === 'critical' ? 85 : request.urgency === 'high' ? 70 : undefined,
    value: request.urgency === 'critical' ? 85 : request.urgency === 'high' ? 75 : undefined,
  }));
}
