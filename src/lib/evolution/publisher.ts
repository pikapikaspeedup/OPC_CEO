import {
  getCanonicalSkill,
  getCanonicalWorkflow,
  saveCanonicalSkill,
  saveCanonicalWorkflow,
} from '../agents/canonical-assets';
import { updateKnowledgeAssetMetadata } from '../knowledge/store';
import type {
  EvolutionProposal,
  EvolutionProposalRollout,
} from './contracts';
import { getEvolutionProposal, patchEvolutionProposal } from './store';
import { listRunRecords } from '../storage/gateway-db';

function buildPublishedArtifactPath(proposal: EvolutionProposal): string | undefined {
  if (proposal.kind === 'workflow') {
    return getCanonicalWorkflow(proposal.targetName)?.path;
  }
  return getCanonicalSkill(proposal.targetName)?.path;
}

export function buildEvolutionProposalRollout(proposal: EvolutionProposal): EvolutionProposalRollout | undefined {
  if (!proposal.publishedAt) return undefined;

  const publishedAtMs = new Date(proposal.publishedAt).getTime();
  const matchedRuns = listRunRecords().filter((run) => {
    if (new Date(run.createdAt).getTime() < publishedAtMs) return false;
    if (proposal.workspaceUri && run.workspace !== proposal.workspaceUri) return false;
    if (proposal.kind === 'workflow') return run.resolvedWorkflowRef === proposal.targetRef;
    return Boolean(run.resolvedSkillRefs?.includes(proposal.targetRef));
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

  if (proposal.kind === 'workflow') {
    saveCanonicalWorkflow(proposal.targetName, proposal.content);
  } else {
    saveCanonicalSkill(proposal.targetName, proposal.content);
  }

  for (const knowledgeId of proposal.sourceKnowledgeIds) {
    updateKnowledgeAssetMetadata(knowledgeId, { status: 'active' });
  }

  const publishedAt = new Date().toISOString();
  const rollout = buildEvolutionProposalRollout({ ...proposal, publishedAt });
  return patchEvolutionProposal(proposalId, {
    status: 'published',
    publishedAt,
    publishedArtifactPath: buildPublishedArtifactPath(proposal),
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
