import { describe, expect, it } from 'vitest';

import {
  buildImprovementCandidateViews,
} from './ceo-office-improvement-pool';
import type { SystemImprovementProposalFE, SystemImprovementSignalFE } from './types';

function makeSignal(overrides: Partial<SystemImprovementSignalFE>): SystemImprovementSignalFE {
  return {
    id: 'signal-1',
    source: 'user-story-gap',
    title: 'Signal title',
    summary: 'Signal summary',
    evidenceRefs: [],
    affectedAreas: ['frontend', 'runtime'],
    severity: 'medium',
    recurrence: 1,
    estimatedBenefit: {},
    createdAt: '2026-05-07T10:00:00.000Z',
    metadata: {
      candidateKind: 'story-top',
      candidateActive: true,
      candidateGeneratedAt: '2026-05-07T10:00:00.000Z',
    },
    ...overrides,
  };
}

function makeProposal(overrides: Partial<SystemImprovementProposalFE>): SystemImprovementProposalFE {
  return {
    id: 'proposal-1',
    status: 'draft',
    title: 'Proposal title',
    summary: 'Proposal summary',
    sourceSignalIds: ['signal-1'],
    evidenceRefs: [],
    affectedFiles: [],
    protectedAreas: [],
    risk: 'low',
    implementationPlan: [],
    testPlan: [],
    rollbackPlan: [],
    linkedRunIds: [],
    testEvidence: [],
    createdAt: '2026-05-07T11:00:00.000Z',
    updatedAt: '2026-05-07T11:00:00.000Z',
    ...overrides,
  };
}

describe('ceo-office-improvement-pool', () => {
  it('marks signals without proposals as 未生成提案', () => {
    const candidates = buildImprovementCandidateViews([makeSignal({ id: 'signal-a' })], []);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.proposal).toBeNull();
    expect(candidates[0]?.proposalStatusLabel).toBe('未生成提案');
  });

  it('uses the latest proposal for a signal when multiple proposals reference it', () => {
    const signal = makeSignal({ id: 'signal-a' });
    const older = makeProposal({
      id: 'proposal-old',
      sourceSignalIds: ['signal-a'],
      updatedAt: '2026-05-07T11:00:00.000Z',
      controlState: { stage: 'entry-review', currentOwner: 'ceo', nextAction: 'approve-entry', pageMode: 'entry-review', headline: '', subline: '', milestones: [] },
    });
    const newer = makeProposal({
      id: 'proposal-new',
      sourceSignalIds: ['signal-a'],
      updatedAt: '2026-05-07T12:00:00.000Z',
      controlState: { stage: 'exit-review', currentOwner: 'ceo', nextAction: 'approve-exit', pageMode: 'exit-review', headline: '', subline: '', milestones: [] },
    });

    const candidates = buildImprovementCandidateViews([signal], [older, newer]);
    expect(candidates[0]?.proposal?.id).toBe('proposal-new');
    expect(candidates[0]?.proposalStatusLabel).toBe('待 CEO 准出');
  });

  it('maps runtime stages to compact candidate statuses', () => {
    const signal = makeSignal({ id: 'signal-a' });
    const candidate = buildImprovementCandidateViews([
      signal,
    ], [
      makeProposal({
        id: 'proposal-executing',
        sourceSignalIds: ['signal-a'],
        controlState: { stage: 'ai-executing', currentOwner: 'ai', nextAction: 'none', pageMode: 'progress', headline: '', subline: '', milestones: [] },
      }),
    ])[0];

    expect(candidate?.proposalStatusLabel).toBe('执行中');
  });

  it('only includes active story-top candidates in the pool', () => {
    const candidates = buildImprovementCandidateViews([
      makeSignal({ id: 'signal-story-top', source: 'user-story-gap' }),
      makeSignal({
        id: 'signal-file-gap',
        source: 'user-story-gap',
        metadata: {
          sourcePath: 'User Story/Settings/个人偏好.md',
          unsupportedStories: ['故事 A', '故事 B'],
        },
      }),
      makeSignal({
        id: 'signal-inactive',
        source: 'user-story-gap',
        metadata: {
          candidateKind: 'story-top',
          candidateActive: false,
        },
      }),
    ], []);

    expect(candidates.map((item) => item.signal.id)).toEqual(['signal-story-top']);
  });
});
