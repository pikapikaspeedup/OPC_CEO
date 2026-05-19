import {
  getCanonicalRule,
  getCanonicalSkill,
  getCanonicalWorkflow,
  saveCanonicalRule,
  saveCanonicalSkill,
  saveCanonicalWorkflow,
  saveCanonicalWorkflowScript,
} from '../agents/canonical-assets';
import { updateKnowledgeAssetMetadata, upsertKnowledgeAsset } from '../knowledge/store';
import type {
  EvolutionProposal,
  EvolutionProposalRollout,
} from './contracts';
import { getEvolutionProposal, patchEvolutionProposal } from './store';
import { listRunRecords } from '../storage/gateway-db';
import type { KnowledgeAsset } from '../knowledge/contracts';

function buildSopKnowledgeAsset(proposal: EvolutionProposal): KnowledgeAsset {
  const now = new Date().toISOString();
  const firstRunId = proposal.evidence.flatMap((evidence) => evidence.runIds || [])[0];
  return {
    id: `knowledge-evolution-sop-${proposal.id}`,
    scope: proposal.workspaceUri ? 'department' : 'organization',
    ...(proposal.workspaceUri ? { workspaceUri: proposal.workspaceUri } : {}),
    category: 'pattern',
    title: proposal.title,
    content: proposal.content,
    source: {
      type: 'system',
      ...(firstRunId ? { runId: firstRunId } : {}),
    },
    tags: ['evolution-proposal', 'sop', proposal.targetName],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

function publishEvolutionAsset(proposal: EvolutionProposal): string | undefined {
  if (proposal.kind === 'workflow') {
    saveCanonicalWorkflow(proposal.targetName, proposal.content);
    return getCanonicalWorkflow(proposal.targetName)?.path;
  }
  if (proposal.kind === 'skill') {
    saveCanonicalSkill(proposal.targetName, proposal.content);
    return getCanonicalSkill(proposal.targetName)?.path;
  }
  if (proposal.kind === 'rule') {
    saveCanonicalRule(proposal.targetName, proposal.content);
    return getCanonicalRule(proposal.targetName)?.path;
  }
  if (proposal.kind === 'script') {
    return saveCanonicalWorkflowScript(proposal.targetName, proposal.content);
  }
  const asset = upsertKnowledgeAsset(buildSopKnowledgeAsset(proposal));
  return `knowledge:${asset.id}`;
}

export function buildEvolutionProposalRollout(proposal: EvolutionProposal): EvolutionProposalRollout | undefined {
  if (!proposal.publishedAt) return undefined;

  const publishedAtMs = new Date(proposal.publishedAt).getTime();
  const matchedRuns = listRunRecords().filter((run) => {
    if (new Date(run.createdAt).getTime() < publishedAtMs) return false;
    if (proposal.workspaceUri && run.workspace !== proposal.workspaceUri) return false;
    if (proposal.kind === 'workflow') return run.resolvedWorkflowRef === proposal.targetRef;
    if (proposal.kind === 'skill') return Boolean(run.resolvedSkillRefs?.includes(proposal.targetRef));
    return false;
  });

  const hitCount = matchedRuns.length;
  const completed = matchedRuns.filter((run) => run.status === 'completed').length;

  return {
    observedAt: new Date().toISOString(),
    hitCount,
    matchedRunIds: matchedRuns.map((run) => run.runId),
    successRate: hitCount > 0 ? completed / hitCount : null,
    ...(matchedRuns[0] ? { lastUsedAt: matchedRuns[0].createdAt } : {}),
    summary: hitCount > 0
      ? `${hitCount} runs adopted this proposal after publish.`
      : 'Published but no adoption has been observed yet.',
  };
}

export function publishEvolutionProposal(proposalId: string): EvolutionProposal | null {
  const proposal = getEvolutionProposal(proposalId);
  if (!proposal) return null;

  const publishedArtifactPath = publishEvolutionAsset(proposal);

  for (const knowledgeId of proposal.sourceKnowledgeIds) {
    updateKnowledgeAssetMetadata(knowledgeId, { status: 'active' });
  }

  const publishedAt = new Date().toISOString();
  const rollout = buildEvolutionProposalRollout({ ...proposal, publishedAt });
  return patchEvolutionProposal(proposalId, {
    status: 'published',
    publishedAt,
    ...(publishedArtifactPath ? { publishedArtifactPath } : {}),
    rollout,
  });
}

export function rejectEvolutionProposal(proposalId: string, governanceNote?: string): EvolutionProposal | null {
  const proposal = getEvolutionProposal(proposalId);
  if (!proposal) return null;

  for (const knowledgeId of proposal.sourceKnowledgeIds) {
    updateKnowledgeAssetMetadata(knowledgeId, { status: 'conflicted' });
  }

  return patchEvolutionProposal(proposalId, {
    status: 'rejected',
    ...(governanceNote ? { governanceNote } : {}),
  });
}

export function refreshEvolutionProposalRollout(proposalId: string): EvolutionProposal | null {
  const proposal = getEvolutionProposal(proposalId);
  if (!proposal) return null;
  const rollout = buildEvolutionProposalRollout(proposal);
  return patchEvolutionProposal(proposalId, {
    ...(rollout ? { rollout } : {}),
  });
}
