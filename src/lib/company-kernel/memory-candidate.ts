import { createHash } from 'crypto';

import { listKnowledgeAssets } from '../knowledge/store';
import type { KnowledgeAsset } from '../knowledge/contracts';
import type {
  EvidenceRef,
  KnowledgeVolatility,
  MemoryCandidate,
  MemoryCandidateConflict,
  MemoryCandidateKind,
  MemoryCandidateScore,
  RunCapsule,
} from './contracts';

function hashId(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): Set<string> {
  return new Set(value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2));
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap++;
  }
  return overlap / Math.min(a.size, b.size);
}

export function detectKnowledgeVolatility(content: string): KnowledgeVolatility {
  const normalized = content.toLowerCase();
  if (/(latency|延迟|today|current|当前|现在|今日|今天|昨天|明天|status|状态|运行中|暂时|临时)/i.test(normalized)) {
    return 'volatile';
  }
  if (/\b20\d{2}-\d{2}-\d{2}\b|\b\d{4}年\d{1,2}月\d{1,2}日\b/.test(content)) {
    return 'time-bound';
  }
  return 'stable';
}

function findConflicts(input: {
  workspaceUri?: string;
  title: string;
  content: string;
}): MemoryCandidateConflict[] {
  const tokenSet = tokenize(`${input.title} ${input.content}`);
  const assets = listKnowledgeAssets({
    ...(input.workspaceUri ? { workspaceUri: input.workspaceUri } : {}),
    status: ['active', 'proposal'],
    limit: 100,
  });

  return assets
    .map((asset: KnowledgeAsset): MemoryCandidateConflict | null => {
      const ratio = overlapRatio(tokenSet, tokenize(`${asset.title} ${asset.content}`));
      if (ratio < 0.45) return null;
      return {
        knowledgeId: asset.id,
        reason: `Similar to existing knowledge: ${asset.title}`,
        severity: ratio > 0.7 ? 'high' : ratio > 0.55 ? 'medium' : 'low',
      };
    })
    .filter((value): value is MemoryCandidateConflict => Boolean(value));
}

function scoreCandidate(input: {
  kind: MemoryCandidateKind;
  content: string;
  evidenceRefs: EvidenceRef[];
  volatility: KnowledgeVolatility;
  conflicts: MemoryCandidateConflict[];
}): MemoryCandidateScore {
  const evidence = Math.min(100, input.evidenceRefs.length * 30 + (input.evidenceRefs.some((ref) => ref.type === 'result-envelope') ? 20 : 0));
  const reuse = input.kind === 'pattern' || input.kind === 'workflow-proposal' || input.kind === 'skill-proposal' ? 80 : 50;
  const specificity = Math.min(100, Math.max(20, input.content.length / 4));
  const stability = input.volatility === 'stable' ? 90 : input.volatility === 'time-bound' ? 55 : 20;
  const novelty = input.conflicts.length === 0
    ? 85
    : input.conflicts.some((conflict) => conflict.severity === 'high') ? 20 : 55;
  const risk = input.volatility === 'volatile'
    ? 75
    : input.conflicts.some((conflict) => conflict.severity === 'high') ? 60 : 20;
  const total = Math.round(
    evidence * 0.3
    + reuse * 0.2
    + specificity * 0.15
    + stability * 0.15
    + novelty * 0.1
    - risk * 0.1,
  );

  return {
    total: Math.max(0, Math.min(100, total)),
    evidence,
    reuse,
    specificity,
    stability,
    novelty,
    risk,
  };
}

function candidateStatus(score: MemoryCandidateScore, volatility: KnowledgeVolatility, conflicts: MemoryCandidateConflict[]): MemoryCandidate['status'] {
  if (conflicts.some((conflict) => conflict.severity === 'high')) return 'pending-review';
  if (volatility === 'volatile') return 'candidate';
  return score.total >= 50 ? 'pending-review' : 'candidate';
}

function buildCandidate(input: {
  capsule: RunCapsule;
  kind: MemoryCandidateKind;
  title: string;
  content: string;
  evidenceRefs?: EvidenceRef[];
  reason: string;
  index: number;
}): MemoryCandidate {
  const content = normalizeText(input.content);
  const volatility = detectKnowledgeVolatility(content);
  const evidenceRefs = input.evidenceRefs?.length ? input.evidenceRefs : input.capsule.outputArtifacts.slice(0, 3);
  const conflicts = findConflicts({
    workspaceUri: input.capsule.workspaceUri,
    title: input.title,
    content,
  });
  const score = scoreCandidate({
    kind: input.kind,
    content,
    evidenceRefs,
    volatility,
    conflicts,
  });
  const now = new Date().toISOString();

  return {
    id: `memcand-${hashId(`${input.capsule.capsuleId}:${input.kind}:${input.index}:${input.title}:${content}`)}`,
    workspaceUri: input.capsule.workspaceUri,
    sourceRunId: input.capsule.runId,
    sourceCapsuleId: input.capsule.capsuleId,
    kind: input.kind,
    title: input.title,
    content,
    evidenceRefs,
    volatility,
    score,
    reasons: [input.reason],
    conflicts,
    status: candidateStatus(score, volatility, conflicts),
    createdAt: now,
    updatedAt: now,
  };
}

export function buildMemoryCandidatesFromRunCapsule(capsule: RunCapsule): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  const runLabel = capsule.runId.slice(0, 8);

  capsule.decisions.forEach((decision, index) => {
    candidates.push(buildCandidate({
      capsule,
      kind: 'decision',
      title: `Decision candidate from run ${runLabel} #${index + 1}`,
      content: decision,
      reason: 'Decision phrase detected in run capsule.',
      index,
    }));
  });

  capsule.reusableSteps.forEach((step, index) => {
    candidates.push(buildCandidate({
      capsule,
      kind: 'pattern',
      title: `Reusable pattern from run ${runLabel} #${index + 1}`,
      content: step,
      reason: 'Reusable step detected in run capsule.',
      index,
    }));
  });

  if ((capsule.status === 'blocked' || capsule.status === 'failed' || capsule.status === 'timeout') && capsule.blockers.length > 0) {
    candidates.push(buildCandidate({
      capsule,
      kind: 'lesson',
      title: `Lesson candidate from run ${runLabel}`,
      content: `Status: ${capsule.status}\n\nBlockers:\n${capsule.blockers.join('\n')}`,
      reason: 'Terminal non-success run produced blockers.',
      index: 0,
    }));
  }

  const workflowSuggestion = capsule.promptResolution?.workflowSuggestion;
  if (workflowSuggestion) {
    candidates.push(buildCandidate({
      capsule,
      kind: 'workflow-proposal',
      title: workflowSuggestion.title,
      content: [
        `Reason: ${workflowSuggestion.reason}`,
        `Source: ${workflowSuggestion.source}`,
        `Recommended Scope: ${workflowSuggestion.recommendedScope}`,
        `Matched workflows: ${workflowSuggestion.evidence.matchedWorkflowRefs.join(', ') || 'none'}`,
        `Matched skills: ${workflowSuggestion.evidence.matchedSkillRefs.join(', ') || 'none'}`,
      ].join('\n'),
      reason: 'Prompt resolution suggested creating a canonical workflow.',
      index: 0,
    }));
  }

  if (candidates.length === 0 && capsule.verifiedFacts.length > 0) {
    candidates.push(buildCandidate({
      capsule,
      kind: 'domain-knowledge',
      title: `Verified fact candidate from run ${runLabel}`,
      content: capsule.verifiedFacts.join('\n'),
      reason: 'Run capsule has verified facts but no stronger candidate type.',
      index: 0,
    }));
  }

  return candidates;
}

