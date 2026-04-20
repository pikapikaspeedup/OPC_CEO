import { createHash, randomUUID } from 'crypto';

import type { AgentRunState } from '../agents/group-types';
import { getCanonicalSkill, getCanonicalWorkflow } from '../agents/canonical-assets';
import { listKnowledgeAssets } from '../knowledge';
import type { KnowledgeAsset } from '../knowledge/contracts';
import { listRunRecords } from '../storage/gateway-db';
import {
  buildEvolutionTargetName,
  buildEvolutionTargetRef,
  type EvolutionProposal,
  type EvolutionProposalKind,
} from './contracts';
import { findEvolutionProposalByTarget, upsertEvolutionProposal } from './store';

function extractKnowledgeReason(asset: KnowledgeAsset): string {
  const reasonLine = asset.content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().startsWith('reason:'));
  if (reasonLine) return reasonLine.replace(/^reason:\s*/i, '').trim();
  return asset.content.split('\n').map((line) => line.trim()).find(Boolean) || 'Proposal derived from knowledge asset.';
}

function titleizeName(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function hashSuffix(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 6);
}

function pickTargetName(rawTitle: string, kind: EvolutionProposalKind, scopeSeed: string): string {
  const normalized = buildEvolutionTargetName(rawTitle, kind);
  if (normalized !== `${kind}-proposal`) return normalized;
  return `${kind}-${hashSuffix(scopeSeed)}`;
}

function buildWorkflowDraft(input: {
  title: string;
  rationale: string;
  workspaceUri?: string;
  samplePrompts?: string[];
}): string {
  const bullets = (input.samplePrompts || [])
    .slice(0, 3)
    .map((prompt) => `- ${prompt}`);
  return [
    '---',
    `description: "Draft workflow generated for ${input.title}"`,
    'runtimeProfile: prompt-mode',
    '---',
    '',
    `# ${input.title}`,
    '',
    '## Purpose',
    input.rationale,
    '',
    '## When To Use',
    bullets.length > 0
      ? ['Use this workflow when the task resembles the following requests:', ...bullets].join('\n')
      : 'Use this workflow for recurring department work of the same shape.',
    '',
    '## Procedure',
    '1. Clarify the target deliverable, scope, and deadline.',
    '2. Retrieve relevant department knowledge and prior artifacts before acting.',
    '3. Execute the task in a stable format instead of ad-hoc prompting.',
    '4. Surface blockers, risks, and next actions explicitly.',
    '',
    '## Output Contract',
    '- concise summary',
    '- supporting evidence or references',
    '- open questions or next steps',
    '',
    '## Guardrails',
    '- Prefer existing canonical assets if they already solve the task.',
    '- Do not fabricate facts, files, or external results.',
    `- Escalate missing context instead of guessing.${input.workspaceUri ? ` Department: ${input.workspaceUri}` : ''}`,
    '',
  ].join('\n');
}

function buildSkillDraft(input: {
  title: string;
  rationale: string;
  workspaceUri?: string;
}): string {
  return [
    `# ${input.title}`,
    '',
    input.rationale,
    '',
    '## Inputs',
    '- task goal',
    '- relevant context and constraints',
    '- prior knowledge or artifacts if available',
    '',
    '## Procedure',
    '1. Restate the task clearly.',
    '2. Gather the minimum required evidence and dependencies.',
    '3. Execute the work with a consistent structure.',
    '4. Return the output with risks and follow-ups.',
    '',
    '## Output',
    '- result summary',
    '- evidence',
    '- follow-up actions',
    '',
    input.workspaceUri ? `Workspace Context: ${input.workspaceUri}` : '',
    '',
  ].join('\n');
}

function buildProposalFromKnowledge(asset: KnowledgeAsset): EvolutionProposal | null {
  const kind: EvolutionProposalKind = asset.category === 'skill-proposal' ? 'skill' : 'workflow';
  const targetName = pickTargetName(
    asset.title,
    kind,
    `${asset.workspaceUri || 'global'}:${asset.id}:${asset.title}`,
  );
  if (findEvolutionProposalByTarget({ kind, targetName, ...(asset.workspaceUri ? { workspaceUri: asset.workspaceUri } : {}) })) {
    return null;
  }
  if ((kind === 'workflow' && getCanonicalWorkflow(targetName)) || (kind === 'skill' && getCanonicalSkill(targetName))) {
    return null;
  }

  const rationale = extractKnowledgeReason(asset);
  const title = titleizeName(targetName);
  const content = kind === 'workflow'
    ? buildWorkflowDraft({ title, rationale, workspaceUri: asset.workspaceUri })
    : buildSkillDraft({ title, rationale, workspaceUri: asset.workspaceUri });
  const now = new Date().toISOString();

  return {
    id: `proposal-${randomUUID()}`,
    kind,
    status: 'draft',
    workspaceUri: asset.workspaceUri,
    title,
    targetName,
    targetRef: buildEvolutionTargetRef(kind, targetName),
    rationale,
    content,
    sourceKnowledgeIds: [asset.id],
    evidence: [{
      source: 'knowledge',
      label: asset.title,
      detail: asset.content,
      workspaceUri: asset.workspaceUri,
      knowledgeId: asset.id,
      ...(asset.source.runId ? { runIds: [asset.source.runId] } : {}),
      count: 1,
    }],
    createdAt: now,
    updatedAt: now,
  };
}

function normalizePromptForCluster(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .slice(0, 8)
    .join('-');
}

function listRepeatedPromptClusters(workspaceUri?: string): Array<{
  workspaceUri: string;
  key: string;
  runs: AgentRunState[];
}> {
  const clusters = new Map<string, { workspaceUri: string; key: string; runs: AgentRunState[] }>();
  const now = Date.now();
  for (const run of listRunRecords()) {
    if (run.status !== 'completed') continue;
    if (run.executionTarget?.kind !== 'prompt' && run.executorKind !== 'prompt') continue;
    if (run.resolvedWorkflowRef) continue;
    if (workspaceUri && run.workspace !== workspaceUri) continue;
    if (now - new Date(run.createdAt).getTime() > 30 * 24 * 60 * 60 * 1000) continue;

    const key = normalizePromptForCluster(run.prompt);
    if (!key) continue;
    const clusterKey = `${run.workspace}:${key}`;
    const cluster = clusters.get(clusterKey) || { workspaceUri: run.workspace, key, runs: [] };
    cluster.runs.push(run);
    clusters.set(clusterKey, cluster);
  }

  return Array.from(clusters.values())
    .filter((cluster) => cluster.runs.length >= 3)
    .sort((a, b) => b.runs.length - a.runs.length);
}

function buildProposalFromRunCluster(cluster: {
  workspaceUri: string;
  key: string;
  runs: AgentRunState[];
}): EvolutionProposal | null {
  const targetName = pickTargetName(
    cluster.key,
    'workflow',
    `${cluster.workspaceUri}:${cluster.key}:${cluster.runs.map((run) => run.runId).join(',')}`,
  );
  if (findEvolutionProposalByTarget({ kind: 'workflow', targetName, workspaceUri: cluster.workspaceUri })) {
    return null;
  }
  if (getCanonicalWorkflow(targetName)) return null;

  const samplePrompts = cluster.runs.slice(0, 3).map((run) => run.prompt.trim()).filter(Boolean);
  const title = titleizeName(targetName);
  const rationale = `Detected ${cluster.runs.length} similar prompt-mode executions in the last 30 days without a canonical workflow.`;
  const now = new Date().toISOString();

  return {
    id: `proposal-${randomUUID()}`,
    kind: 'workflow',
    status: 'draft',
    workspaceUri: cluster.workspaceUri,
    title,
    targetName,
    targetRef: buildEvolutionTargetRef('workflow', targetName),
    rationale,
    content: buildWorkflowDraft({ title, rationale, workspaceUri: cluster.workspaceUri, samplePrompts }),
    sourceKnowledgeIds: [],
    evidence: [{
      source: 'repeated-runs',
      label: `${cluster.runs.length} repeated prompt runs`,
      detail: samplePrompts.join('\n'),
      workspaceUri: cluster.workspaceUri,
      runIds: cluster.runs.map((run) => run.runId),
      count: cluster.runs.length,
    }],
    createdAt: now,
    updatedAt: now,
  };
}

export function generateEvolutionProposals(input?: {
  workspaceUri?: string;
  limit?: number;
}): EvolutionProposal[] {
  const generated: EvolutionProposal[] = [];

  const knowledgeAssets = listKnowledgeAssets({
    ...(input?.workspaceUri ? { workspaceUri: input.workspaceUri } : {}),
    category: ['workflow-proposal', 'skill-proposal'],
    status: 'proposal',
    limit: Math.max(input?.limit || 20, 20),
  });

  for (const asset of knowledgeAssets) {
    const proposal = buildProposalFromKnowledge(asset);
    if (!proposal) continue;
    generated.push(upsertEvolutionProposal(proposal));
    if (input?.limit && generated.length >= input.limit) return generated;
  }

  for (const cluster of listRepeatedPromptClusters(input?.workspaceUri)) {
    const proposal = buildProposalFromRunCluster(cluster);
    if (!proposal) continue;
    generated.push(upsertEvolutionProposal(proposal));
    if (input?.limit && generated.length >= input.limit) break;
  }

  return generated;
}
