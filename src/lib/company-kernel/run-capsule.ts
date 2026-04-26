import { createHash } from 'crypto';

import type { AgentRunState } from '../agents/group-types';
import { buildArtifactEvidenceRefs, buildEvidenceRef } from './evidence';
import type { RunCapsule } from './contracts';
import { buildCheckpointsForRun, mergeCheckpoints } from './working-checkpoint';

function capsuleId(runId: string): string {
  return `capsule-${createHash('sha1').update(runId).digest('hex').slice(0, 16)}`;
}

function compactText(value: string | undefined, maxLength = 500): string | undefined {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trim()}…`;
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => compactText(value)).filter((value): value is string => Boolean(value))));
}

function extractDecisionSentences(summary: string): string[] {
  const pattern = /(?:decided|chose|selected|switched to|using|adopted|opted for|went with|picked)\s+(.+?)(?:\.|。|$)/gi;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(summary)) !== null) {
    matches.push(match[0].trim());
  }
  return matches;
}

function buildVerifiedFacts(run: AgentRunState): string[] {
  const facts: string[] = [];
  if (run.result?.status) facts.push(`Result status: ${run.result.status}`);
  if (run.reviewOutcome) facts.push(`Review outcome: ${run.reviewOutcome}`);
  if (run.verificationPassed !== undefined) facts.push(`Verification passed: ${run.verificationPassed}`);
  if (run.reportedEventDate) facts.push(`Reported event date: ${run.reportedEventDate}`);
  if (run.reportedEventCount !== undefined) facts.push(`Reported event count: ${run.reportedEventCount}`);
  if (run.resultEnvelope?.summary) facts.push(`Result envelope summary: ${run.resultEnvelope.summary}`);
  if (run.resultEnvelope?.outputArtifacts?.length) {
    facts.push(`Output artifact count: ${run.resultEnvelope.outputArtifacts.length}`);
  }
  return unique(facts);
}

function buildReusableSteps(run: AgentRunState): string[] {
  const steps: string[] = [];
  if (run.resultEnvelope?.nextAction) {
    steps.push(`Next action: ${run.resultEnvelope.nextAction}`);
  }
  for (const artifact of run.resultEnvelope?.outputArtifacts || []) {
    if (artifact.kind.includes('workflow') || artifact.kind.includes('manifest') || artifact.kind.includes('delivery')) {
      steps.push(`Reusable artifact: ${artifact.title || artifact.path}`);
    }
  }
  if (run.resolvedWorkflowRef) {
    steps.push(`Resolved workflow: ${run.resolvedWorkflowRef}`);
  }
  for (const skillRef of run.resolvedSkillRefs || []) {
    steps.push(`Resolved skill: ${skillRef}`);
  }
  return unique(steps);
}

export function buildRunCapsuleFromRun(
  run: AgentRunState,
  existing?: RunCapsule | null,
): RunCapsule {
  const now = new Date().toISOString();
  const sourceRunUpdatedAt = run.finishedAt || run.startedAt || run.createdAt;
  const outputArtifacts = buildArtifactEvidenceRefs({
    runId: run.runId,
    artifacts: run.resultEnvelope?.outputArtifacts || [],
    createdAt: sourceRunUpdatedAt,
  });
  const hasDeliveryPacket = outputArtifacts.some((ref) => ref.type === 'delivery-packet');
  const reportApiEvidence = run.reportApiResponse
    ? [buildEvidenceRef({
      type: 'api-response',
      runId: run.runId,
      label: 'Report API response',
      excerpt: run.reportApiResponse.slice(0, 500),
      createdAt: sourceRunUpdatedAt,
    })]
    : [];

  const summary = run.result?.summary || run.resultEnvelope?.summary || '';

  return {
    capsuleId: existing?.capsuleId || capsuleId(run.runId),
    runId: run.runId,
    workspaceUri: run.workspace,
    ...(run.projectId ? { projectId: run.projectId } : {}),
    ...(run.provider ? { providerId: run.provider } : {}),
    ...(run.executionTarget ? { executionTarget: run.executionTarget } : {}),
    ...(run.triggerContext ? { triggerContext: run.triggerContext } : {}),
    ...(run.promptResolution ? { promptResolution: run.promptResolution } : {}),
    goal: run.taskEnvelope?.goal || run.prompt,
    prompt: run.prompt,
    status: run.status,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    checkpoints: mergeCheckpoints(existing?.checkpoints, buildCheckpointsForRun(run)),
    verifiedFacts: buildVerifiedFacts(run),
    decisions: unique(extractDecisionSentences(summary)),
    reusableSteps: buildReusableSteps(run),
    blockers: unique([
      ...(run.result?.blockers || []),
      run.lastError,
      ...(run.resultEnvelope?.risks || []),
      ...(run.resultEnvelope?.openQuestions || []),
    ]),
    changedFiles: Array.from(new Set(run.result?.changedFiles || [])),
    outputArtifacts: [...outputArtifacts, ...reportApiEvidence],
    qualitySignals: {
      ...(run.result?.status ? { resultStatus: run.result.status } : {}),
      ...(run.reviewOutcome ? { reviewOutcome: run.reviewOutcome } : {}),
      ...(run.verificationPassed !== undefined ? { verificationPassed: run.verificationPassed } : {}),
      ...(run.reportedEventDate ? { reportedEventDate: run.reportedEventDate } : {}),
      ...(run.reportedEventCount !== undefined ? { reportedEventCount: run.reportedEventCount } : {}),
      hasResultEnvelope: Boolean(run.resultEnvelope),
      hasArtifactManifest: Boolean(run.artifactManifestPath),
      hasDeliveryPacket,
    },
    ...(run.tokenUsage ? { tokenUsage: run.tokenUsage } : {}),
    sourceRunUpdatedAt,
    createdAt: existing?.createdAt || run.createdAt || now,
    updatedAt: now,
  };
}

