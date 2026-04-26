import { createHash, randomUUID } from 'crypto';

import { listKnowledgeAssets } from '../knowledge/store';
import type { KnowledgeAsset } from '../knowledge/contracts';
import type {
  GrowthProposal,
  GrowthProposalKind,
  GrowthProposalRisk,
  MemoryCandidate,
  RunCapsule,
} from './contracts';
import { listMemoryCandidates } from './memory-candidate-store';
import {
  findGrowthProposalByTarget,
  upsertGrowthProposal,
} from './growth-proposal-store';
import { listRunCapsules } from './run-capsule-store';

export interface GenerateGrowthProposalsInput {
  workspaceUri?: string;
  limit?: number;
}

function slugify(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
  return normalized || fallback;
}

function hashSuffix(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 8);
}

function targetRef(kind: GrowthProposalKind, name: string): string {
  if (kind === 'workflow') return `workflow:/${name}`;
  if (kind === 'skill') return `skill:${name}`;
  if (kind === 'script') return `script:${name}`;
  if (kind === 'rule') return `rule:${name}`;
  return `sop:${name}`;
}

function titleize(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function proposalRisk(kind: GrowthProposalKind, evidenceCount: number): GrowthProposalRisk {
  if (kind === 'script') return 'high';
  if (kind === 'rule') return evidenceCount >= 3 ? 'medium' : 'high';
  if (kind === 'skill') return evidenceCount >= 3 ? 'medium' : 'high';
  if (kind === 'workflow') return evidenceCount >= 3 ? 'medium' : 'high';
  return 'low';
}

function scoreProposal(input: {
  evidenceCount: number;
  sourceRuns: number;
  sourceKnowledge: number;
  risk: GrowthProposalRisk;
}): number {
  const riskPenalty = input.risk === 'high' ? 20 : input.risk === 'medium' ? 10 : 0;
  return Math.max(0, Math.min(100, Math.round(
    35
    + Math.min(30, input.evidenceCount * 8)
    + Math.min(20, input.sourceRuns * 4)
    + Math.min(15, input.sourceKnowledge * 5)
    - riskPenalty,
  )));
}

function buildWorkflowContent(input: {
  title: string;
  summary: string;
  examples: string[];
}): string {
  return [
    `# ${input.title}`,
    '',
    '## Purpose',
    input.summary,
    '',
    '## Trigger',
    'Use when a new company task matches the evidence examples below.',
    '',
    '## Procedure',
    '1. Read the related run capsule and promoted knowledge before acting.',
    '2. Confirm the target department, output contract, and safety constraints.',
    '3. Execute the workflow with explicit evidence and next actions.',
    '4. Emit a result envelope so the kernel can learn from the run.',
    '',
    '## Evidence Examples',
    ...input.examples.slice(0, 6).map((example) => `- ${example}`),
    '',
  ].join('\n');
}

function buildSkillContent(input: {
  title: string;
  summary: string;
  examples: string[];
}): string {
  return [
    `# ${input.title}`,
    '',
    input.summary,
    '',
    '## Inputs',
    '- goal',
    '- workspace context',
    '- relevant evidence refs',
    '',
    '## Method',
    '1. Inspect the evidence before generating output.',
    '2. Apply the repeated operating pattern.',
    '3. Return concise result, risks, and reusable lessons.',
    '',
    '## Evidence Examples',
    ...input.examples.slice(0, 6).map((example) => `- ${example}`),
    '',
  ].join('\n');
}

function buildSopContent(input: {
  title: string;
  summary: string;
  examples: string[];
}): string {
  return [
    `# ${input.title}`,
    '',
    input.summary,
    '',
    '## Steps',
    ...input.examples.slice(0, 8).map((example, index) => `${index + 1}. ${example}`),
    '',
    '## Control',
    '- Keep human approval for high-risk publication.',
    '- Re-evaluate after real use before promotion.',
    '',
  ].join('\n');
}

function buildScriptContent(input: {
  title: string;
  summary: string;
  examples: string[];
}): string {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'DRY_RUN="${DRY_RUN:-1}"',
    '',
    `# ${input.title}`,
    `# ${input.summary}`,
    '',
    'if [ "$DRY_RUN" = "1" ]; then',
    '  echo "[dry-run] validate inputs and planned side effects before execution"',
    '  exit 0',
    'fi',
    '',
    'echo "Implement the approved automation steps here."',
    '',
    '# Evidence examples:',
    ...input.examples.slice(0, 8).map((example) => `# - ${example}`),
    '',
  ].join('\n');
}

function buildRuleContent(input: {
  title: string;
  summary: string;
  examples: string[];
}): string {
  return [
    `# ${input.title}`,
    '',
    input.summary,
    '',
    '## Rule',
    'Apply this operating rule when a new task matches the evidence below.',
    '',
    '## Evidence',
    ...input.examples.slice(0, 8).map((example) => `- ${example}`),
    '',
  ].join('\n');
}

function makeProposal(input: {
  kind: GrowthProposalKind;
  workspaceUri?: string;
  rawName: string;
  title?: string;
  summary: string;
  content: string;
  sourceRunIds?: string[];
  sourceCapsuleIds?: string[];
  sourceKnowledgeIds?: string[];
  sourceCandidateIds?: string[];
  evidenceRefs?: GrowthProposal['evidenceRefs'];
}): GrowthProposal | null {
  const targetName = slugify(input.rawName, `${input.kind}-${hashSuffix(input.summary)}`);
  if (findGrowthProposalByTarget({
    kind: input.kind,
    targetName,
    ...(input.workspaceUri ? { workspaceUri: input.workspaceUri } : {}),
  })) {
    return null;
  }
  const sourceRunIds = Array.from(new Set(input.sourceRunIds || []));
  const sourceKnowledgeIds = Array.from(new Set(input.sourceKnowledgeIds || []));
  const risk = proposalRisk(input.kind, (input.evidenceRefs || []).length + sourceRunIds.length + sourceKnowledgeIds.length);
  const score = scoreProposal({
    evidenceCount: (input.evidenceRefs || []).length,
    sourceRuns: sourceRunIds.length,
    sourceKnowledge: sourceKnowledgeIds.length,
    risk,
  });
  const now = new Date().toISOString();
  return {
    id: `growth-proposal-${randomUUID()}`,
    kind: input.kind,
    status: 'draft',
    risk,
    score,
    ...(input.workspaceUri ? { workspaceUri: input.workspaceUri } : {}),
    title: input.title || titleize(targetName),
    summary: input.summary,
    targetName,
    targetRef: targetRef(input.kind, targetName),
    content: input.content,
    sourceRunIds,
    sourceCapsuleIds: Array.from(new Set(input.sourceCapsuleIds || [])),
    sourceKnowledgeIds,
    sourceCandidateIds: Array.from(new Set(input.sourceCandidateIds || [])),
    evidenceRefs: input.evidenceRefs || [],
    createdAt: now,
    updatedAt: now,
  };
}

function buildProposalFromCandidate(candidate: MemoryCandidate): GrowthProposal | null {
  const kind: GrowthProposalKind = candidate.kind === 'skill-proposal'
    ? 'skill'
    : candidate.kind === 'workflow-proposal'
      ? 'workflow'
      : 'sop';
  const title = candidate.title.replace(/^Review memory candidate:\s*/i, '');
  const content = kind === 'skill'
    ? buildSkillContent({ title, summary: candidate.content, examples: candidate.reasons })
    : kind === 'workflow'
      ? buildWorkflowContent({ title, summary: candidate.content, examples: candidate.reasons })
      : buildSopContent({ title, summary: candidate.content, examples: candidate.reasons });
  return makeProposal({
    kind,
    workspaceUri: candidate.workspaceUri,
    rawName: candidate.title,
    title,
    summary: candidate.content,
    content,
    sourceRunIds: [candidate.sourceRunId],
    sourceCapsuleIds: [candidate.sourceCapsuleId],
    sourceKnowledgeIds: candidate.promotedKnowledgeId ? [candidate.promotedKnowledgeId] : [],
    sourceCandidateIds: [candidate.id],
    evidenceRefs: candidate.evidenceRefs,
  });
}

function buildProposalFromKnowledge(asset: KnowledgeAsset): GrowthProposal | null {
  const kind: GrowthProposalKind | null = asset.category === 'skill-proposal'
    ? 'skill'
    : asset.category === 'workflow-proposal'
      ? 'workflow'
      : asset.category === 'pattern' || asset.category === 'lesson'
        ? 'sop'
        : null;
  if (!kind) return null;
  const title = asset.title;
  const examples = [
    asset.source.runId ? `Knowledge came from run ${asset.source.runId}` : 'Promoted knowledge asset',
    ...(asset.promotion?.sourceCapsuleIds || []).map((capsuleId) => `Promoted from capsule ${capsuleId}`),
    ...(asset.tags || []),
  ];
  const content = kind === 'skill'
    ? buildSkillContent({ title, summary: asset.content, examples })
    : kind === 'workflow'
      ? buildWorkflowContent({ title, summary: asset.content, examples })
      : buildSopContent({ title, summary: asset.content, examples: examples.length > 0 ? examples : [asset.content] });
  return makeProposal({
    kind,
    workspaceUri: asset.workspaceUri,
    rawName: asset.title,
    title,
    summary: asset.content,
    content,
    sourceRunIds: asset.source.runId ? [asset.source.runId] : [],
    sourceCapsuleIds: asset.promotion?.sourceCapsuleIds || [],
    sourceKnowledgeIds: [asset.id],
    sourceCandidateIds: asset.promotion?.sourceCandidateId ? [asset.promotion.sourceCandidateId] : [],
    evidenceRefs: asset.evidence?.refs || [],
  });
}

function reusableKey(capsule: RunCapsule): string {
  return slugify(
    `${capsule.reusableSteps[0] || capsule.goal || capsule.prompt}`.slice(0, 120),
    `run-pattern-${hashSuffix(capsule.runId)}`,
  );
}

function clusterText(cluster: RunCapsule[]): string {
  return cluster.map((capsule) => [
    capsule.goal,
    capsule.prompt,
    ...capsule.reusableSteps,
    ...capsule.decisions,
    ...capsule.outputArtifacts.map((artifact) => [
      artifact.label,
      artifact.artifactPath,
      artifact.filePath,
    ].filter(Boolean).join(' ')),
  ].join('\n')).join('\n').toLowerCase();
}

function shouldGenerateScriptProposal(cluster: RunCapsule[]): boolean {
  const text = clusterText(cluster);
  return /\.(?:sh|bash|py|js|mjs|ts)\b/.test(text)
    || /\b(script|cli|automation|cron|shell|python|node|fetch|upload|report)\b/.test(text)
    || /(脚本|自动化|抓取|上报|定时|日报|报告)/.test(text);
}

function shouldGenerateRuleProposal(cluster: RunCapsule[]): boolean {
  const text = clusterText(cluster);
  return /\b(must|should|always|never|required|policy|rule|constraint|approval)\b/.test(text)
    || /(必须|应该|总是|不要|禁止|规则|原则|约束|审批)/.test(text);
}

function buildProposalsFromRunClusters(workspaceUri?: string): GrowthProposal[] {
  const clusters = new Map<string, RunCapsule[]>();
  for (const capsule of listRunCapsules({
    ...(workspaceUri ? { workspaceUri } : {}),
    status: 'completed',
    limit: 300,
  })) {
    if (capsule.reusableSteps.length === 0 && capsule.decisions.length === 0) continue;
    const key = `${capsule.workspaceUri}:${reusableKey(capsule)}`;
    const cluster = clusters.get(key) || [];
    cluster.push(capsule);
    clusters.set(key, cluster);
  }

  const proposals: GrowthProposal[] = [];
  for (const cluster of clusters.values()) {
    if (cluster.length < 2) continue;
    const examples = cluster.flatMap((capsule) => capsule.reusableSteps.length > 0 ? capsule.reusableSteps : capsule.decisions).slice(0, 8);
    const title = titleize(reusableKey(cluster[0]));
    const summary = `Repeated successful run pattern detected across ${cluster.length} run capsules.`;
    const kind: GrowthProposalKind = cluster.length >= 3 ? 'workflow' : 'sop';
    const proposal = makeProposal({
      kind,
      workspaceUri: cluster[0].workspaceUri,
      rawName: title,
      title,
      summary,
      content: kind === 'workflow'
        ? buildWorkflowContent({ title, summary, examples })
        : buildSopContent({ title, summary, examples }),
      sourceRunIds: cluster.map((capsule) => capsule.runId),
      sourceCapsuleIds: cluster.map((capsule) => capsule.capsuleId),
      evidenceRefs: cluster.flatMap((capsule) => capsule.outputArtifacts).slice(0, 8),
    });
    if (proposal) proposals.push(proposal);
    if (shouldGenerateScriptProposal(cluster)) {
      const scriptProposal = makeProposal({
        kind: 'script',
        workspaceUri: cluster[0].workspaceUri,
        rawName: `${title} script`,
        title: `${title} Script`,
        summary: `Repeated task appears automatable across ${cluster.length} run capsules.`,
        content: buildScriptContent({ title: `${title} Script`, summary, examples }),
        sourceRunIds: cluster.map((capsule) => capsule.runId),
        sourceCapsuleIds: cluster.map((capsule) => capsule.capsuleId),
        evidenceRefs: cluster.flatMap((capsule) => capsule.outputArtifacts).slice(0, 8),
      });
      if (scriptProposal) proposals.push(scriptProposal);
    }
    if (shouldGenerateRuleProposal(cluster)) {
      const ruleProposal = makeProposal({
        kind: 'rule',
        workspaceUri: cluster[0].workspaceUri,
        rawName: `${title} rule`,
        title: `${title} Rule`,
        summary: `Repeated operating constraint detected across ${cluster.length} run capsules.`,
        content: buildRuleContent({ title: `${title} Rule`, summary, examples }),
        sourceRunIds: cluster.map((capsule) => capsule.runId),
        sourceCapsuleIds: cluster.map((capsule) => capsule.capsuleId),
        evidenceRefs: cluster.flatMap((capsule) => capsule.outputArtifacts).slice(0, 8),
      });
      if (ruleProposal) proposals.push(ruleProposal);
    }
  }
  return proposals.sort((a, b) => b.score - a.score);
}

export function generateGrowthProposals(input: GenerateGrowthProposalsInput = {}): GrowthProposal[] {
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit || 20)));
  const proposals: GrowthProposal[] = [];

  for (const candidate of listMemoryCandidates({
    ...(input.workspaceUri ? { workspaceUri: input.workspaceUri } : {}),
    kind: ['workflow-proposal', 'skill-proposal', 'pattern'],
    status: ['promoted', 'auto-promoted', 'pending-review'],
    limit: limit * 2,
  })) {
    const proposal = buildProposalFromCandidate(candidate);
    if (!proposal) continue;
    proposals.push(upsertGrowthProposal(proposal));
    if (proposals.length >= limit) return proposals;
  }

  for (const asset of listKnowledgeAssets({
    ...(input.workspaceUri ? { workspaceUri: input.workspaceUri } : {}),
    category: ['workflow-proposal', 'skill-proposal', 'pattern', 'lesson'],
    status: ['active', 'proposal'],
    limit: limit * 2,
  })) {
    const proposal = buildProposalFromKnowledge(asset);
    if (!proposal) continue;
    proposals.push(upsertGrowthProposal(proposal));
    if (proposals.length >= limit) return proposals;
  }

  for (const proposal of buildProposalsFromRunClusters(input.workspaceUri)) {
    proposals.push(upsertGrowthProposal(proposal));
    if (proposals.length >= limit) return proposals;
  }

  return proposals;
}
