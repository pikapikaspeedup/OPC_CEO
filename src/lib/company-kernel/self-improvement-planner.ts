import { randomUUID } from 'crypto';

import type {
  SystemImprovementArea,
  SystemImprovementProposal,
  SystemImprovementSignal,
} from './contracts';
import {
  getSystemImprovementSignal,
  upsertSystemImprovementProposal,
} from './self-improvement-store';
import { evaluateSystemImprovementRisk } from './self-improvement-risk';

export interface GenerateSystemImprovementProposalInput {
  signalIds: string[];
  proposalId?: string;
  title?: string;
  summary?: string;
  affectedFiles?: string[];
  affectedAreas?: SystemImprovementArea[];
  branchName?: string;
  linkedRunIds?: string[];
  metadata?: Record<string, unknown>;
}

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function defaultAffectedFiles(signals: SystemImprovementSignal[]): string[] {
  const fromMetadata = signals.flatMap((signal) => {
    const files = signal.metadata?.affectedFiles;
    return Array.isArray(files) ? files.filter((file): file is string => typeof file === 'string') : [];
  });
  if (fromMetadata.length > 0) return uniq(fromMetadata);
  if (signals.some((signal) => signal.affectedAreas.includes('frontend'))) return ['src/components/*'];
  if (signals.some((signal) => signal.affectedAreas.includes('api'))) return ['src/app/api/company/*'];
  if (signals.some((signal) => signal.affectedAreas.includes('database'))) return ['src/lib/storage/*'];
  return ['docs/design/*'];
}

function buildImplementationPlan(input: {
  signals: SystemImprovementSignal[];
  risk: string;
  affectedFiles: string[];
}): string[] {
  return [
    'Confirm the evidence and define the smallest safe change set.',
    `Limit edits to affected files or adjacent modules: ${input.affectedFiles.slice(0, 6).join(', ') || 'TBD'}.`,
    input.risk === 'high' || input.risk === 'critical'
      ? 'Prepare the change on a branch and require CEO approval before protected-core execution.'
      : 'Implement the proposal through the normal development flow with targeted tests.',
    'Update API/user/architecture documentation only for changed behavior.',
  ];
}

function buildTestPlan(signals: SystemImprovementSignal[], affectedFiles: string[]): string[] {
  const plan = ['npx tsc --noEmit --pretty false'];
  if (affectedFiles.some((file) => file.includes('components') || file.includes('app/'))) {
    plan.unshift('npx eslint <changed frontend files>');
  }
  if (affectedFiles.some((file) => file.includes('company-kernel') || file.includes('api/company'))) {
    plan.unshift('npx vitest run src/lib/company-kernel src/app/api/company');
  }
  if (signals.some((signal) => signal.source === 'performance')) {
    plan.push('Run targeted API smoke and record latency before/after.');
  }
  return uniq(plan);
}

function proposalStatus(input: {
  evidenceCount: number;
  risk: string;
}): SystemImprovementProposal['status'] {
  if (input.evidenceCount === 0) return 'needs-evidence';
  if (input.risk === 'high' || input.risk === 'critical') return 'approval-required';
  return 'draft';
}

export function generateSystemImprovementProposal(input: GenerateSystemImprovementProposalInput): SystemImprovementProposal {
  const signals = input.signalIds
    .map(getSystemImprovementSignal)
    .filter((signal): signal is SystemImprovementSignal => Boolean(signal));
  if (signals.length === 0) {
    throw new Error('No system improvement signals found for proposal generation');
  }

  const now = new Date().toISOString();
  const affectedAreas = uniq([
    ...(input.affectedAreas || []),
    ...signals.flatMap((signal) => signal.affectedAreas),
  ]);
  const affectedFiles = uniq(input.affectedFiles?.length ? input.affectedFiles : defaultAffectedFiles(signals));
  const risk = evaluateSystemImprovementRisk({
    affectedFiles,
    affectedAreas,
    sourceSignals: signals,
  });
  const evidenceRefs = uniq(signals.flatMap((signal) => signal.evidenceRefs));
  const title = input.title?.trim() || signals[0].title;
  const summary = input.summary?.trim() || signals.map((signal) => signal.summary).join('\n');

  const proposal: SystemImprovementProposal = {
    id: input.proposalId || `system-improvement-proposal-${randomUUID()}`,
    status: proposalStatus({ evidenceCount: evidenceRefs.length, risk: risk.risk }),
    title,
    summary,
    sourceSignalIds: signals.map((signal) => signal.id),
    evidenceRefs,
    affectedFiles,
    protectedAreas: risk.protectedAreas,
    risk: risk.risk,
    implementationPlan: buildImplementationPlan({ signals, risk: risk.risk, affectedFiles }),
    testPlan: buildTestPlan(signals, affectedFiles),
    rollbackPlan: [
      'Keep the previous behavior reachable until validation passes.',
      'Revert the change set if tests fail or post-release observation regresses.',
      'Record rollback evidence in the proposal before closing.',
    ],
    ...(input.branchName ? { branchName: input.branchName } : {}),
    linkedRunIds: input.linkedRunIds ? uniq(input.linkedRunIds) : [],
    testEvidence: [],
    createdAt: now,
    updatedAt: now,
    metadata: {
      riskReasons: risk.reasons,
      ...(input.metadata || {}),
    },
  };

  return upsertSystemImprovementProposal(proposal);
}
