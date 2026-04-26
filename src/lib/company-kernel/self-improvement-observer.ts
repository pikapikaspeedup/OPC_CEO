import { patchSystemImprovementProposal } from './self-improvement-store';

export function observeSystemImprovementProposal(input: {
  proposalId: string;
  summary: string;
  linkedRunIds?: string[];
  metadata?: Record<string, unknown>;
}) {
  const proposal = patchSystemImprovementProposal(input.proposalId, {
    status: 'observing',
    ...(input.linkedRunIds?.length ? { linkedRunIds: input.linkedRunIds } : {}),
    metadata: {
      ...(input.metadata || {}),
      observationSummary: input.summary,
      observedAt: new Date().toISOString(),
    },
  });
  if (!proposal) {
    throw new Error(`System improvement proposal not found: ${input.proposalId}`);
  }
  return proposal;
}
