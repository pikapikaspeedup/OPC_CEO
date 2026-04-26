import { randomUUID } from 'crypto';

import {
  getCanonicalSkill,
  getCanonicalWorkflow,
  saveCanonicalSkill,
  saveCanonicalRule,
  saveCanonicalWorkflow,
  saveCanonicalWorkflowScript,
} from '../agents/canonical-assets';
import { upsertKnowledgeAsset } from '../knowledge/store';
import type { KnowledgeAsset } from '../knowledge/contracts';
import type { GrowthProposal } from './contracts';
import { getGrowthProposal, patchGrowthProposal } from './growth-proposal-store';

function buildSopKnowledgeAsset(proposal: GrowthProposal): KnowledgeAsset {
  const now = new Date().toISOString();
  return {
    id: `knowledge-growth-sop-${randomUUID()}`,
    scope: proposal.workspaceUri ? 'department' : 'organization',
    ...(proposal.workspaceUri ? { workspaceUri: proposal.workspaceUri } : {}),
    category: 'pattern',
    title: proposal.title,
    content: proposal.content,
    source: {
      type: 'system',
      ...(proposal.sourceRunIds[0] ? { runId: proposal.sourceRunIds[0] } : {}),
    },
    confidence: Math.min(1, proposal.score / 100),
    tags: ['growth-proposal', 'sop', proposal.targetName],
    status: 'active',
    evidence: {
      refs: proposal.evidenceRefs,
      strength: proposal.score,
      verifiedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function publishAsset(proposal: GrowthProposal): string {
  if (proposal.kind === 'workflow') {
    saveCanonicalWorkflow(proposal.targetName, proposal.content);
    return getCanonicalWorkflow(proposal.targetName)?.path || proposal.targetRef;
  }
  if (proposal.kind === 'skill') {
    saveCanonicalSkill(proposal.targetName, proposal.content);
    return getCanonicalSkill(proposal.targetName)?.path || proposal.targetRef;
  }
  if (proposal.kind === 'rule') {
    saveCanonicalRule(proposal.targetName, proposal.content);
    return proposal.targetRef;
  }
  if (proposal.kind === 'script') {
    return saveCanonicalWorkflowScript(proposal.targetName, proposal.content);
  }
  const asset = upsertKnowledgeAsset(buildSopKnowledgeAsset(proposal));
  return `knowledge:${asset.id}`;
}

export function publishGrowthProposal(id: string, input?: {
  force?: boolean;
}): GrowthProposal | null {
  const proposal = getGrowthProposal(id);
  if (!proposal) return null;
  if (proposal.status === 'rejected' || proposal.status === 'archived') {
    throw new Error(`Cannot publish proposal in ${proposal.status} status`);
  }
  if (proposal.risk === 'high' && proposal.status !== 'approved' && !input?.force) {
    throw new Error('High-risk growth proposal requires approval before publish');
  }
  const scriptDryRun = proposal.metadata?.scriptDryRun as { status?: string } | undefined;
  if (proposal.kind === 'script' && scriptDryRun?.status !== 'passed') {
    throw new Error('Script growth proposal requires approval and dry-run before publish');
  }
  if (proposal.status === 'approval-required' && !input?.force) {
    throw new Error('Growth proposal requires approval before publish');
  }

  const publishedAssetRef = publishAsset(proposal);
  const publishedAt = new Date().toISOString();
  return patchGrowthProposal(id, {
    status: 'published',
    publishedAt,
    publishedAssetRef,
  });
}
