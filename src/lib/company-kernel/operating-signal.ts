import { createHash } from 'crypto';

import type { ScheduledJob } from '../agents/scheduler-types';
import {
  buildEvidenceRef,
  buildRunEvidenceRef,
} from './evidence';
import type {
  EvidenceRef,
  MemoryCandidate,
  OperatingSignal,
  OperatingSignalKind,
  OperatingSignalSource,
  OperatingSignalStatus,
  RunCapsule,
} from './contracts';

export interface OperatingSignalInput {
  source: OperatingSignalSource;
  kind: OperatingSignalKind;
  title: string;
  summary: string;
  evidenceRefs?: EvidenceRef[];
  workspaceUri?: string;
  sourceRunId?: string;
  sourceJobId?: string;
  sourceCandidateId?: string;
  sourceApprovalId?: string;
  urgency?: number;
  value?: number;
  confidence?: number;
  risk?: number;
  estimatedCost?: {
    tokens?: number;
    minutes?: number;
  };
  dedupeKey?: string;
  status?: OperatingSignalStatus;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

function hashId(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

function clampMetric(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value as number)));
}

export function scoreOperatingSignal(input: {
  urgency: number;
  value: number;
  confidence: number;
  risk: number;
}): number {
  return clampMetric(
    input.urgency * 0.35
    + input.value * 0.3
    + input.confidence * 0.2
    + input.risk * 0.15,
    0,
  );
}

function buildSignalDedupeKey(input: OperatingSignalInput): string {
  if (input.dedupeKey) return input.dedupeKey;
  return [
    input.source,
    input.kind,
    input.workspaceUri || 'global',
    input.sourceRunId || '',
    input.sourceJobId || '',
    input.sourceCandidateId || '',
    input.sourceApprovalId || '',
    input.title,
  ].join(':');
}

export function buildOperatingSignal(input: OperatingSignalInput): OperatingSignal {
  const now = new Date().toISOString();
  const dedupeKey = buildSignalDedupeKey(input);
  const urgency = clampMetric(input.urgency, 50);
  const value = clampMetric(input.value, 50);
  const confidence = clampMetric(input.confidence, 70);
  const risk = clampMetric(input.risk, 30);
  const estimatedCost = {
    tokens: Math.max(0, Math.trunc(input.estimatedCost?.tokens || 0)),
    minutes: Math.max(0, Math.trunc(input.estimatedCost?.minutes || 0)),
  };

  return {
    id: `signal-${hashId(dedupeKey)}`,
    source: input.source,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    evidenceRefs: input.evidenceRefs || [],
    ...(input.workspaceUri ? { workspaceUri: input.workspaceUri } : {}),
    ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
    ...(input.sourceJobId ? { sourceJobId: input.sourceJobId } : {}),
    ...(input.sourceCandidateId ? { sourceCandidateId: input.sourceCandidateId } : {}),
    ...(input.sourceApprovalId ? { sourceApprovalId: input.sourceApprovalId } : {}),
    urgency,
    value,
    confidence,
    risk,
    estimatedCost,
    score: scoreOperatingSignal({ urgency, value, confidence, risk }),
    dedupeKey,
    status: input.status || 'observed',
    createdAt: input.createdAt || now,
    updatedAt: now,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function runEvidence(capsule: RunCapsule): EvidenceRef[] {
  const refs = [
    buildRunEvidenceRef(capsule.runId, capsule.updatedAt),
    ...capsule.outputArtifacts.slice(0, 3),
  ];
  return refs;
}

export function buildRunOperatingSignals(capsule: RunCapsule): OperatingSignal[] {
  const signals: OperatingSignal[] = [];
  const evidenceRefs = runEvidence(capsule);
  const runLabel = capsule.goal || capsule.prompt || capsule.runId;
  const tokenEstimate = capsule.tokenUsage?.totalTokens || 0;

  if (capsule.status === 'failed' || capsule.status === 'blocked' || capsule.status === 'timeout') {
    signals.push(buildOperatingSignal({
      source: 'run',
      kind: 'failure',
      title: `Run needs attention: ${runLabel.slice(0, 80)}`,
      summary: capsule.blockers.length > 0
        ? capsule.blockers.slice(0, 3).join('\n')
        : `Run ended with status ${capsule.status}.`,
      evidenceRefs,
      workspaceUri: capsule.workspaceUri,
      sourceRunId: capsule.runId,
      urgency: capsule.status === 'timeout' ? 85 : 75,
      value: 65,
      confidence: 90,
      risk: 80,
      estimatedCost: {
        tokens: tokenEstimate,
        minutes: 15,
      },
      dedupeKey: `run:${capsule.runId}:terminal:${capsule.status}`,
      metadata: {
        capsuleId: capsule.capsuleId,
        blockers: capsule.blockers,
      },
    }));
  }

  if (capsule.status === 'completed' && capsule.reusableSteps.length > 0) {
    signals.push(buildOperatingSignal({
      source: 'run',
      kind: 'learning',
      title: `Reusable work found: ${runLabel.slice(0, 80)}`,
      summary: capsule.reusableSteps.slice(0, 5).join('\n'),
      evidenceRefs,
      workspaceUri: capsule.workspaceUri,
      sourceRunId: capsule.runId,
      urgency: 45,
      value: 70,
      confidence: capsule.qualitySignals.verificationPassed === false ? 55 : 75,
      risk: 25,
      estimatedCost: {
        tokens: tokenEstimate,
        minutes: 5,
      },
      dedupeKey: `run:${capsule.runId}:reusable-steps`,
      metadata: {
        capsuleId: capsule.capsuleId,
        reusableSteps: capsule.reusableSteps,
      },
    }));
  }

  if (capsule.status === 'completed' && capsule.promptResolution?.workflowSuggestion) {
    const suggestion = capsule.promptResolution.workflowSuggestion;
    signals.push(buildOperatingSignal({
      source: 'run',
      kind: 'opportunity',
      title: `Workflow opportunity: ${suggestion.title}`,
      summary: suggestion.reason,
      evidenceRefs,
      workspaceUri: capsule.workspaceUri,
      sourceRunId: capsule.runId,
      urgency: 55,
      value: 85,
      confidence: 70,
      risk: 35,
      estimatedCost: {
        tokens: tokenEstimate,
        minutes: 20,
      },
      dedupeKey: `run:${capsule.runId}:workflow-suggestion:${suggestion.title}`,
      metadata: {
        capsuleId: capsule.capsuleId,
        workflowSuggestion: suggestion,
      },
    }));
  }

  return signals;
}

export function buildMemoryCandidateOperatingSignal(candidate: MemoryCandidate): OperatingSignal {
  const highConflict = candidate.conflicts.some((conflict) => conflict.severity === 'high');
  return buildOperatingSignal({
    source: 'knowledge',
    kind: highConflict ? 'risk' : candidate.kind === 'workflow-proposal' || candidate.kind === 'skill-proposal' ? 'opportunity' : 'learning',
    title: `Review memory candidate: ${candidate.title}`,
    summary: candidate.content,
    evidenceRefs: candidate.evidenceRefs,
    workspaceUri: candidate.workspaceUri,
    sourceRunId: candidate.sourceRunId,
    sourceCandidateId: candidate.id,
    urgency: candidate.status === 'pending-review' ? 65 : 35,
    value: candidate.score.reuse,
    confidence: candidate.score.evidence,
    risk: Math.max(candidate.score.risk, highConflict ? 85 : 0),
    estimatedCost: {
      tokens: 0,
      minutes: highConflict ? 20 : 8,
    },
    dedupeKey: `memory-candidate:${candidate.id}:${candidate.status}`,
    metadata: {
      sourceCapsuleId: candidate.sourceCapsuleId,
      candidateKind: candidate.kind,
      conflicts: candidate.conflicts,
      score: candidate.score,
    },
  });
}

export function buildSchedulerOperatingSignal(job: ScheduledJob, input?: {
  reason?: string;
  now?: string;
  kind?: OperatingSignalKind;
  urgency?: number;
  value?: number;
  confidence?: number;
  risk?: number;
  estimatedCost?: {
    tokens?: number;
    minutes?: number;
  };
  dedupeSuffix?: string;
}): OperatingSignal | null {
  if (!job.enabled && job.lastRunResult !== 'failed') {
    return null;
  }

  const workspaceUri = job.departmentWorkspaceUri
    || ('workspace' in job.action ? job.action.workspace : undefined);
  const failed = job.lastRunResult === 'failed';
  const riskyFastInterval = job.type === 'interval'
    && typeof job.intervalMs === 'number'
    && job.intervalMs > 0
    && job.intervalMs < 60_000;
  if (!failed && !riskyFastInterval && !input?.reason && !input?.kind) {
    return null;
  }

  const reason = input?.reason
    || (failed ? job.lastRunError || 'Last scheduler run failed.' : 'Interval is shorter than the safe operating cadence.');
  const kind = input?.kind || (failed ? 'failure' : riskyFastInterval ? 'risk' : 'routine');

  return buildOperatingSignal({
    source: 'scheduler',
    kind,
    title: `Scheduler attention: ${job.name || job.jobId}`,
    summary: reason,
    evidenceRefs: [buildEvidenceRef({
      type: 'log',
      label: `Scheduler job ${job.jobId}`,
      createdAt: input?.now || new Date().toISOString(),
      excerpt: reason,
      metadata: {
        jobId: job.jobId,
        type: job.type,
        intervalMs: job.intervalMs,
      },
    })],
    workspaceUri,
    sourceJobId: job.jobId,
    urgency: input?.urgency ?? (failed ? 70 : kind === 'routine' ? 60 : 55),
    value: input?.value ?? (kind === 'routine' ? 70 : 55),
    confidence: input?.confidence ?? 80,
    risk: input?.risk ?? (failed ? 75 : kind === 'routine' ? 30 : 65),
    estimatedCost: {
      tokens: input?.estimatedCost?.tokens ?? 0,
      minutes: input?.estimatedCost?.minutes ?? 10,
    },
    dedupeKey: `scheduler:${job.jobId}:${input?.dedupeSuffix || (failed ? 'failed' : kind === 'routine' ? 'routine' : 'cadence-risk')}`,
    metadata: {
      job,
    },
  });
}

export function buildApprovalOperatingSignal(input: {
  id: string;
  title: string;
  summary: string;
  workspaceUri?: string;
  createdAt?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'feedback';
  type?: string;
  risk?: number;
  value?: number;
}): OperatingSignal {
  const status = input.status || 'pending';
  const kind: OperatingSignalKind = status === 'approved'
    ? 'opportunity'
    : status === 'rejected'
      ? 'risk'
      : 'decision';
  return buildOperatingSignal({
    source: 'approval',
    kind,
    title: input.title,
    summary: input.summary,
    evidenceRefs: [buildEvidenceRef({
      type: 'approval',
      label: input.title,
      createdAt: input.createdAt || new Date().toISOString(),
      metadata: {
        approvalId: input.id,
      },
    })],
    workspaceUri: input.workspaceUri,
    sourceApprovalId: input.id,
    urgency: status === 'pending' ? 70 : 55,
    value: input.value || (status === 'approved' ? 75 : 65),
    confidence: 80,
    risk: input.risk || (status === 'rejected' ? 70 : 35),
    estimatedCost: {
      tokens: 0,
      minutes: 5,
    },
    dedupeKey: `approval:${input.id}:${status}`,
    metadata: {
      approvalStatus: status,
      approvalType: input.type,
    },
  });
}
