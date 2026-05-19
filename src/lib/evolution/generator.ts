import { createHash, randomUUID } from 'crypto';

import type { AgentRunState } from '../agents/group-types';
import {
  getCanonicalRule,
  getCanonicalSkill,
  getCanonicalWorkflow,
  getCanonicalWorkflowScriptsDir,
} from '../agents/canonical-assets';
import { listKnowledgeAssets } from '../knowledge';
import type { KnowledgeAsset } from '../knowledge/contracts';
import type { MemoryCandidate, RunCapsule } from '../company-kernel/contracts';
import { listMemoryCandidates } from '../company-kernel/memory-candidate-store';
import { listRunCapsules } from '../company-kernel/run-capsule-store';
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

function canonicalAssetExists(kind: EvolutionProposalKind, targetName: string): boolean {
  if (kind === 'workflow') return Boolean(getCanonicalWorkflow(targetName));
  if (kind === 'skill') return Boolean(getCanonicalSkill(targetName));
  if (kind === 'rule') return Boolean(getCanonicalRule(targetName));
  if (kind === 'script') return Boolean(getCanonicalWorkflowScriptsDir(targetName));
  return false;
}

function shouldSkipProposal(input: {
  kind: EvolutionProposalKind;
  targetName: string;
  workspaceUri?: string;
}): boolean {
  return Boolean(findEvolutionProposalByTarget(input)) || canonicalAssetExists(input.kind, input.targetName);
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

function buildSopDraft(input: {
  title: string;
  rationale: string;
  examples?: string[];
}): string {
  const examples = (input.examples || []).slice(0, 8);
  return [
    `# ${input.title}`,
    '',
    input.rationale,
    '',
    '## Steps',
    ...(examples.length > 0
      ? examples.map((example, index) => `${index + 1}. ${example}`)
      : ['1. Review the source evidence before applying this SOP.']),
    '',
    '## Control',
    '- Keep the source evidence attached to future runs.',
    '- Re-evaluate after real use before promoting to workflow or skill.',
    '',
  ].join('\n');
}

function buildRuleDraft(input: {
  title: string;
  rationale: string;
  examples?: string[];
}): string {
  return [
    `# ${input.title}`,
    '',
    input.rationale,
    '',
    '## Rule',
    'Apply this operating rule when a new task matches the evidence below.',
    '',
    '## Evidence',
    ...(input.examples || []).slice(0, 8).map((example) => `- ${example}`),
    '',
  ].join('\n');
}

function buildScriptDraft(input: {
  title: string;
  rationale: string;
  examples?: string[];
}): string {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `# ${input.title}`,
    `# ${input.rationale}`,
    '',
    'DRY_RUN="${DRY_RUN:-1}"',
    'if [ "$DRY_RUN" = "1" ]; then',
    '  echo "[dry-run] validate inputs and planned side effects before execution"',
    '  exit 0',
    'fi',
    '',
    'echo "Implement the approved automation steps here."',
    '',
    '# Evidence examples:',
    ...(input.examples || []).slice(0, 8).map((example) => `# - ${example}`),
    '',
  ].join('\n');
}

function buildDraftContent(input: {
  kind: EvolutionProposalKind;
  title: string;
  rationale: string;
  workspaceUri?: string;
  examples?: string[];
}): string {
  if (input.kind === 'workflow') {
    return buildWorkflowDraft({
      title: input.title,
      rationale: input.rationale,
      workspaceUri: input.workspaceUri,
      samplePrompts: input.examples,
    });
  }
  if (input.kind === 'skill') {
    return buildSkillDraft({
      title: input.title,
      rationale: input.rationale,
      workspaceUri: input.workspaceUri,
    });
  }
  if (input.kind === 'rule') {
    return buildRuleDraft(input);
  }
  if (input.kind === 'script') {
    return buildScriptDraft(input);
  }
  return buildSopDraft(input);
}

function proposalKindForKnowledge(asset: KnowledgeAsset): EvolutionProposalKind | null {
  if (asset.category === 'skill-proposal') return 'skill';
  if (asset.category === 'workflow-proposal') return 'workflow';
  if (asset.category === 'pattern' || asset.category === 'lesson') return 'sop';
  return null;
}

function proposalKindForCandidate(candidate: MemoryCandidate): EvolutionProposalKind {
  if (candidate.kind === 'skill-proposal') return 'skill';
  if (candidate.kind === 'workflow-proposal') return 'workflow';
  return 'sop';
}

function buildProposalFromKnowledge(asset: KnowledgeAsset): EvolutionProposal | null {
  const kind = proposalKindForKnowledge(asset);
  if (!kind) return null;
  const targetName = pickTargetName(
    asset.title,
    kind,
    `${asset.workspaceUri || 'global'}:${asset.id}:${asset.title}`,
  );
  if (shouldSkipProposal({ kind, targetName, ...(asset.workspaceUri ? { workspaceUri: asset.workspaceUri } : {}) })) {
    return null;
  }

  const rationale = extractKnowledgeReason(asset);
  const title = titleizeName(targetName);
  const examples = [
    asset.source.runId ? `Knowledge came from run ${asset.source.runId}` : 'Promoted knowledge asset.',
    ...(asset.promotion?.sourceCapsuleIds || []).map((capsuleId) => `Promoted from capsule ${capsuleId}`),
    ...(asset.tags || []),
  ];
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
    content: buildDraftContent({ kind, title, rationale, workspaceUri: asset.workspaceUri, examples }),
    sourceKnowledgeIds: [asset.id],
    evidence: [{
      source: 'knowledge',
      label: asset.title,
      detail: asset.content,
      workspaceUri: asset.workspaceUri,
      knowledgeId: asset.id,
      ...(asset.promotion?.sourceCandidateId ? { candidateIds: [asset.promotion.sourceCandidateId] } : {}),
      ...(asset.promotion?.sourceCapsuleIds ? { capsuleIds: asset.promotion.sourceCapsuleIds } : {}),
      ...(asset.source.runId ? { runIds: [asset.source.runId] } : {}),
      count: 1,
    }],
    createdAt: now,
    updatedAt: now,
  };
}

function buildProposalFromCandidate(candidate: MemoryCandidate): EvolutionProposal | null {
  const kind = proposalKindForCandidate(candidate);
  const titleSeed = candidate.title.replace(/^Review memory candidate:\s*/i, '');
  const targetName = pickTargetName(
    titleSeed,
    kind,
    `${candidate.workspaceUri || 'global'}:${candidate.id}:${candidate.title}`,
  );
  if (shouldSkipProposal({ kind, targetName, ...(candidate.workspaceUri ? { workspaceUri: candidate.workspaceUri } : {}) })) {
    return null;
  }

  const title = titleizeName(targetName);
  const rationale = candidate.content;
  const now = new Date().toISOString();
  return {
    id: `proposal-${randomUUID()}`,
    kind,
    status: 'draft',
    workspaceUri: candidate.workspaceUri,
    title,
    targetName,
    targetRef: buildEvolutionTargetRef(kind, targetName),
    rationale,
    content: buildDraftContent({
      kind,
      title,
      rationale,
      workspaceUri: candidate.workspaceUri,
      examples: candidate.reasons,
    }),
    sourceKnowledgeIds: candidate.promotedKnowledgeId ? [candidate.promotedKnowledgeId] : [],
    evidence: [{
      source: 'memory-candidate',
      label: candidate.title,
      detail: candidate.content,
      workspaceUri: candidate.workspaceUri,
      candidateIds: [candidate.id],
      capsuleIds: [candidate.sourceCapsuleId],
      runIds: [candidate.sourceRunId],
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
  if (shouldSkipProposal({ kind: 'workflow', targetName, workspaceUri: cluster.workspaceUri })) {
    return null;
  }

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

function reusableKey(capsule: RunCapsule): string {
  return buildEvolutionTargetName(
    `${capsule.reusableSteps[0] || capsule.decisions[0] || capsule.goal || capsule.prompt}`,
    'sop',
  ) || `run-pattern-${hashSuffix(capsule.runId)}`;
}

function capsuleClusterText(cluster: RunCapsule[]): string {
  return cluster.map((capsule) => [
    capsule.goal,
    capsule.prompt,
    ...capsule.reusableSteps,
    ...capsule.decisions,
    ...capsule.outputArtifacts.map((artifact) => [
      artifact.label,
      artifact.artifactPath,
      artifact.filePath,
      artifact.excerpt,
    ].filter(Boolean).join(' ')),
  ].join('\n')).join('\n').toLowerCase();
}

function shouldGenerateScriptProposal(cluster: RunCapsule[]): boolean {
  const text = capsuleClusterText(cluster);
  return /\.(?:sh|bash|py|js|mjs|ts)\b/.test(text)
    || /\b(script|cli|automation|cron|shell|python|node|fetch|upload|report)\b/.test(text)
    || /(脚本|自动化|抓取|上报|定时|日报|报告)/.test(text);
}

function shouldGenerateRuleProposal(cluster: RunCapsule[]): boolean {
  const text = capsuleClusterText(cluster);
  return /\b(must|should|always|never|required|policy|rule|constraint|approval)\b/.test(text)
    || /(必须|应该|总是|不要|禁止|规则|原则|约束|审批)/.test(text);
}

function listRunCapsuleClusters(workspaceUri?: string): RunCapsule[][] {
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
  return Array.from(clusters.values())
    .filter((cluster) => cluster.length >= 2)
    .sort((a, b) => b.length - a.length);
}

function buildProposalFromRunCapsules(
  cluster: RunCapsule[],
  kind: Extract<EvolutionProposalKind, 'sop' | 'workflow' | 'script' | 'rule'>,
  nameSuffix = '',
): EvolutionProposal | null {
  const baseName = reusableKey(cluster[0]);
  const targetName = pickTargetName(
    `${baseName}${nameSuffix ? ` ${nameSuffix}` : ''}`,
    kind,
    `${cluster[0].workspaceUri}:${baseName}:${cluster.map((capsule) => capsule.runId).join(',')}:${kind}`,
  );
  if (shouldSkipProposal({ kind, targetName, workspaceUri: cluster[0].workspaceUri })) {
    return null;
  }

  const title = titleizeName(targetName);
  const examples = cluster
    .flatMap((capsule) => capsule.reusableSteps.length > 0 ? capsule.reusableSteps : capsule.decisions)
    .slice(0, 8);
  const rationale = kind === 'script'
    ? `Repeated task appears automatable across ${cluster.length} run capsules.`
    : kind === 'rule'
      ? `Repeated operating constraint detected across ${cluster.length} run capsules.`
      : `Repeated successful run pattern detected across ${cluster.length} run capsules.`;
  const now = new Date().toISOString();

  return {
    id: `proposal-${randomUUID()}`,
    kind,
    status: 'draft',
    workspaceUri: cluster[0].workspaceUri,
    title,
    targetName,
    targetRef: buildEvolutionTargetRef(kind, targetName),
    rationale,
    content: buildDraftContent({
      kind,
      title,
      rationale,
      workspaceUri: cluster[0].workspaceUri,
      examples,
    }),
    sourceKnowledgeIds: [],
    evidence: [{
      source: 'run-capsules',
      label: `${cluster.length} reusable run capsules`,
      detail: examples.join('\n'),
      workspaceUri: cluster[0].workspaceUri,
      capsuleIds: cluster.map((capsule) => capsule.capsuleId),
      runIds: cluster.map((capsule) => capsule.runId),
      count: cluster.length,
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

  const candidates = listMemoryCandidates({
    ...(input?.workspaceUri ? { workspaceUri: input.workspaceUri } : {}),
    kind: ['workflow-proposal', 'skill-proposal', 'pattern', 'lesson'],
    status: ['promoted', 'auto-promoted', 'pending-review'],
    limit: Math.max(input?.limit || 20, 20) * 2,
  });

  for (const candidate of candidates) {
    const proposal = buildProposalFromCandidate(candidate);
    if (!proposal) continue;
    generated.push(upsertEvolutionProposal(proposal));
    if (input?.limit && generated.length >= input.limit) return generated;
  }

  const knowledgeAssets = listKnowledgeAssets({
    ...(input?.workspaceUri ? { workspaceUri: input.workspaceUri } : {}),
    category: ['workflow-proposal', 'skill-proposal', 'pattern', 'lesson'],
    status: ['active', 'proposal'],
    limit: Math.max(input?.limit || 20, 20) * 2,
  });

  for (const asset of knowledgeAssets) {
    const proposal = buildProposalFromKnowledge(asset);
    if (!proposal) continue;
    generated.push(upsertEvolutionProposal(proposal));
    if (input?.limit && generated.length >= input.limit) return generated;
  }

  for (const cluster of listRunCapsuleClusters(input?.workspaceUri)) {
    const proposal = buildProposalFromRunCapsules(cluster, cluster.length >= 3 ? 'workflow' : 'sop');
    if (proposal) {
      generated.push(upsertEvolutionProposal(proposal));
      if (input?.limit && generated.length >= input.limit) return generated;
    }
    if (shouldGenerateScriptProposal(cluster)) {
      const scriptProposal = buildProposalFromRunCapsules(cluster, 'script', 'script');
      if (scriptProposal) {
        generated.push(upsertEvolutionProposal(scriptProposal));
        if (input?.limit && generated.length >= input.limit) return generated;
      }
    }
    if (shouldGenerateRuleProposal(cluster)) {
      const ruleProposal = buildProposalFromRunCapsules(cluster, 'rule', 'rule');
      if (ruleProposal) {
        generated.push(upsertEvolutionProposal(ruleProposal));
        if (input?.limit && generated.length >= input.limit) return generated;
      }
    }
  }

  for (const cluster of listRepeatedPromptClusters(input?.workspaceUri)) {
    const proposal = buildProposalFromRunCluster(cluster);
    if (!proposal) continue;
    generated.push(upsertEvolutionProposal(proposal));
    if (input?.limit && generated.length >= input.limit) break;
  }

  return generated;
}
