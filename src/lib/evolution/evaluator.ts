import type { AgentRunState } from '../agents/group-types';
import { listRunRecords } from '../storage/gateway-db';
import type {
  EvolutionProposal,
  EvolutionProposalEvaluation,
} from './contracts';
import { getEvolutionProposal, patchEvolutionProposal } from './store';

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function scoreRunAgainstProposal(run: AgentRunState, proposal: EvolutionProposal): number {
  let score = 0;
  const titleTokens = tokenize(proposal.title);
  const targetTokens = tokenize(proposal.targetName);
  const promptText = `${run.prompt}\n${run.result?.summary || ''}`.toLowerCase();

  if (proposal.workspaceUri && run.workspace === proposal.workspaceUri) {
    score += 2;
  }

  if (proposal.kind === 'workflow' && run.resolvedWorkflowRef === proposal.targetRef) {
    score += 10;
  }
  if (proposal.kind === 'skill' && run.resolvedSkillRefs?.includes(proposal.targetRef)) {
    score += 10;
  }

  for (const token of [...titleTokens, ...targetTokens]) {
    if (promptText.includes(token)) score += 1;
  }

  for (const evidence of proposal.evidence) {
    if (evidence.runIds?.includes(run.runId)) {
      score += 8;
    }
  }

  return score;
}

function matchRunsForProposal(proposal: EvolutionProposal): AgentRunState[] {
  return listRunRecords()
    .map((run) => ({ run, score: scoreRunAgainstProposal(run, proposal) }))
    .filter((entry) => entry.score >= 3)
    .sort((a, b) => b.score - a.score || b.run.createdAt.localeCompare(a.run.createdAt))
    .map((entry) => entry.run);
}

export function buildEvolutionProposalEvaluation(proposal: EvolutionProposal): EvolutionProposalEvaluation {
  const matchedRuns = matchRunsForProposal(proposal);
  const sampleSize = matchedRuns.length;
  const completed = matchedRuns.filter((run) => run.status === 'completed').length;
  const blocked = matchedRuns.filter((run) => ['blocked', 'failed', 'timeout', 'cancelled'].includes(run.status)).length;
  const successRate = sampleSize > 0 ? completed / sampleSize : 0;
  const blockedRate = sampleSize > 0 ? blocked / sampleSize : 0;

  let recommendation: EvolutionProposalEvaluation['recommendation'] = 'hold';
  if (sampleSize >= 2 && successRate >= 0.6) recommendation = 'publish';
  else if (sampleSize > 0) recommendation = 'revise';

  return {
    evaluatedAt: new Date().toISOString(),
    sampleSize,
    matchedRunIds: matchedRuns.map((run) => run.runId),
    successRate,
    blockedRate,
    recommendation,
    summary: sampleSize === 0
      ? 'No historical runs matched this proposal yet.'
      : `Matched ${sampleSize} historical runs, ${Math.round(successRate * 100)}% completed, ${Math.round(blockedRate * 100)}% blocked/failed.`,
  };
}

export function evaluateEvolutionProposal(proposalId: string): EvolutionProposal | null {
  const proposal = getEvolutionProposal(proposalId);
  if (!proposal) return null;

  const evaluation = buildEvolutionProposalEvaluation(proposal);
  return patchEvolutionProposal(proposalId, {
    evaluation,
    status: proposal.status === 'published' ? 'published' : 'evaluated',
  });
}
