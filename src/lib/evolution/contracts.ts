export type EvolutionProposalKind = 'workflow' | 'skill';

export type EvolutionProposalStatus =
  | 'draft'
  | 'evaluated'
  | 'pending-approval'
  | 'published'
  | 'rejected';

export interface EvolutionProposalEvidence {
  source: 'knowledge' | 'repeated-runs';
  label: string;
  detail: string;
  workspaceUri?: string;
  knowledgeId?: string;
  runIds?: string[];
  count?: number;
}

export interface EvolutionProposalEvaluation {
  evaluatedAt: string;
  sampleSize: number;
  matchedRunIds: string[];
  successRate: number;
  blockedRate: number;
  recommendation: 'publish' | 'revise' | 'hold';
  summary: string;
}

export interface EvolutionProposalRollout {
  observedAt: string;
  hitCount: number;
  matchedRunIds: string[];
  successRate: number | null;
  lastUsedAt?: string;
  summary: string;
}

export interface EvolutionProposal {
  id: string;
  kind: EvolutionProposalKind;
  status: EvolutionProposalStatus;
  workspaceUri?: string;
  title: string;
  targetName: string;
  targetRef: string;
  rationale: string;
  content: string;
  sourceKnowledgeIds: string[];
  evidence: EvolutionProposalEvidence[];
  evaluation?: EvolutionProposalEvaluation;
  approvalRequestId?: string;
  governanceNote?: string;
  publishedAt?: string;
  publishedArtifactPath?: string;
  rollout?: EvolutionProposalRollout;
  createdAt: string;
  updatedAt: string;
}

export interface EvolutionProposalListQuery {
  workspaceUri?: string;
  kind?: EvolutionProposalKind | EvolutionProposalKind[];
  status?: EvolutionProposalStatus | EvolutionProposalStatus[];
  limit?: number;
}

export function buildEvolutionTargetName(input: string, fallbackPrefix: EvolutionProposalKind): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (normalized) return normalized.slice(0, 80);
  return `${fallbackPrefix}-proposal`;
}

export function buildEvolutionTargetRef(kind: EvolutionProposalKind, targetName: string): string {
  return kind === 'workflow' ? `/${targetName}` : targetName;
}
