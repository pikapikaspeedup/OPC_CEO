import type { KnowledgeAsset, KnowledgeCategory } from '../knowledge/contracts';
import { upsertKnowledgeAsset } from '../knowledge/store';
import type { KnowledgePromotionLevel, MemoryCandidate, RunCapsule } from './contracts';
import { buildMemoryCandidatesFromRunCapsule } from './memory-candidate';
import {
  getMemoryCandidate,
  updateMemoryCandidateStatus,
  upsertMemoryCandidate,
} from './memory-candidate-store';

function categoryFromCandidateKind(kind: MemoryCandidate['kind']): KnowledgeCategory {
  return kind;
}

function knowledgeStatusForCategory(category: KnowledgeCategory): KnowledgeAsset['status'] {
  return category === 'workflow-proposal' || category === 'skill-proposal' ? 'proposal' : 'active';
}

function isOpenCandidate(candidate: MemoryCandidate): boolean {
  return candidate.status === 'candidate' || candidate.status === 'pending-review';
}

function assertOpenCandidate(candidate: MemoryCandidate, action: 'promote' | 'reject'): void {
  if (!isOpenCandidate(candidate)) {
    throw new Error(`Cannot ${action} memory candidate ${candidate.id} from status ${candidate.status}`);
  }
}

export function shouldAutoPromoteCandidate(candidate: MemoryCandidate): boolean {
  return isOpenCandidate(candidate)
    && candidate.evidenceRefs.length > 0
    && candidate.score.evidence > 0
    && candidate.score.total >= 75
    && candidate.volatility !== 'volatile'
    && !candidate.conflicts.some((conflict) => conflict.severity === 'high');
}

export function promoteMemoryCandidate(input: {
  candidateId: string;
  promotedBy: 'system' | 'ceo' | 'manual';
  level?: KnowledgePromotionLevel;
  category?: KnowledgeCategory;
  title?: string;
  content?: string;
}): KnowledgeAsset {
  const candidate = getMemoryCandidate(input.candidateId);
  if (!candidate) {
    throw new Error(`Memory candidate not found: ${input.candidateId}`);
  }
  assertOpenCandidate(candidate, 'promote');

  const now = new Date().toISOString();
  const category = input.category || categoryFromCandidateKind(candidate.kind);
  const knowledge: KnowledgeAsset = {
    id: `knowledge-${candidate.id.replace(/^memcand-/, '')}`,
    scope: 'department',
    ...(candidate.workspaceUri ? { workspaceUri: candidate.workspaceUri } : {}),
    category,
    title: input.title || candidate.title,
    content: input.content || candidate.content,
    source: {
      type: 'run',
      runId: candidate.sourceRunId,
    },
    confidence: candidate.score.total / 100,
    tags: [
      `candidate:${candidate.id}`,
      `capsule:${candidate.sourceCapsuleId}`,
      `volatility:${candidate.volatility}`,
    ],
    status: knowledgeStatusForCategory(category),
    evidence: {
      refs: candidate.evidenceRefs,
      strength: candidate.score.evidence,
      verifiedAt: now,
    },
    promotion: {
      level: input.level || (category === 'workflow-proposal' || category === 'skill-proposal' ? 'l1-index' : 'l2-fact'),
      volatility: candidate.volatility,
      qualityScore: candidate.score.total,
      sourceCandidateId: candidate.id,
      sourceCapsuleIds: [candidate.sourceCapsuleId],
      promotedBy: input.promotedBy,
      promotedAt: now,
      ...(candidate.conflicts.length > 0 ? { conflictGroupId: candidate.conflicts.map((conflict) => conflict.knowledgeId).join(',') } : {}),
    },
    createdAt: now,
    updatedAt: now,
  };

  const stored = upsertKnowledgeAsset(knowledge);
  updateMemoryCandidateStatus(
    candidate.id,
    input.promotedBy === 'system' ? 'auto-promoted' : 'promoted',
    { promotedKnowledgeId: stored.id },
  );
  return stored;
}

export function rejectMemoryCandidate(input: {
  candidateId: string;
  reason: string;
  rejectedBy: 'ceo' | 'manual' | 'system';
}): MemoryCandidate {
  const candidate = getMemoryCandidate(input.candidateId);
  if (!candidate) {
    throw new Error(`Memory candidate not found: ${input.candidateId}`);
  }
  if (candidate.status === 'rejected') {
    return candidate;
  }
  assertOpenCandidate(candidate, 'reject');

  const updated = updateMemoryCandidateStatus(input.candidateId, 'rejected', {
    rejectedReason: `${input.rejectedBy}: ${input.reason}`,
  });
  if (!updated) throw new Error(`Memory candidate not found: ${input.candidateId}`);
  return updated;
}

export function processRunCapsuleForMemory(
  capsule: RunCapsule,
  options: { autoPromote?: boolean } = {},
): {
  candidates: MemoryCandidate[];
  promotedAssets: KnowledgeAsset[];
} {
  const candidates = buildMemoryCandidatesFromRunCapsule(capsule).map(upsertMemoryCandidate);
  const promotedAssets = options.autoPromote
    ? candidates
      .filter(shouldAutoPromoteCandidate)
      .map((candidate) => promoteMemoryCandidate({
        candidateId: candidate.id,
        promotedBy: 'system',
      }))
    : [];

  return { candidates, promotedAssets };
}
