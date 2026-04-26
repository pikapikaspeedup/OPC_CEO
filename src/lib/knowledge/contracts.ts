import type {
  KnowledgeEvidence,
  KnowledgePromotionMetadata,
} from '../company-kernel/contracts';

export type KnowledgeScope = 'department' | 'organization';

export type KnowledgeCategory =
  | 'decision'
  | 'pattern'
  | 'lesson'
  | 'domain-knowledge'
  | 'workflow-proposal'
  | 'skill-proposal';

export type KnowledgeStatus = 'active' | 'stale' | 'conflicted' | 'proposal';

export interface KnowledgeReference {
  type: 'workspace' | 'run_id' | 'category' | 'scope' | 'source';
  value: string;
}

export interface KnowledgeAsset {
  id: string;
  scope: KnowledgeScope;
  workspaceUri?: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  source: {
    type: 'run' | 'manual' | 'ceo' | 'system';
    runId?: string;
    artifactPath?: string;
  };
  confidence?: number;
  tags?: string[];
  status?: KnowledgeStatus;
  evidence?: KnowledgeEvidence;
  promotion?: KnowledgePromotionMetadata;
  usageCount?: number;
  lastAccessedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeListQuery {
  workspaceUri?: string;
  scope?: KnowledgeScope;
  category?: KnowledgeCategory | KnowledgeCategory[];
  status?: KnowledgeStatus | KnowledgeStatus[];
  limit?: number;
}

export function buildKnowledgeSummary(content: string, maxLength = 180): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}
