import { createHash } from 'crypto';

import type { AgentRunState } from '../agents/group-types';
import { TERMINAL_STATUSES } from '../agents/group-types';
import { buildArtifactEvidenceRefs, buildEvidenceRef, buildRunEvidenceRef, dedupeEvidenceRefs } from './evidence';
import type { EvidenceRef, WorkingCheckpoint, WorkingCheckpointKind } from './contracts';

function checkpointId(input: {
  runId: string;
  kind: WorkingCheckpointKind;
  occurredAt: string;
  summary: string;
}): string {
  const hash = createHash('sha1')
    .update(`${input.runId}:${input.kind}:${input.occurredAt}:${input.summary}`)
    .digest('hex')
    .slice(0, 14);
  return `cp-${hash}`;
}

export function buildWorkingCheckpoint(input: {
  runId: string;
  kind: WorkingCheckpointKind;
  summary: string;
  occurredAt: string;
  evidenceRefs?: EvidenceRef[];
  metadata?: Record<string, unknown>;
}): WorkingCheckpoint {
  return {
    id: checkpointId(input),
    runId: input.runId,
    kind: input.kind,
    summary: input.summary,
    occurredAt: input.occurredAt,
    evidenceRefs: dedupeEvidenceRefs(input.evidenceRefs || []),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function terminalKind(status: AgentRunState['status']): WorkingCheckpointKind | null {
  if (status === 'completed') return 'run-completed';
  if (status === 'blocked') return 'run-blocked';
  if (status === 'failed' || status === 'timeout') return 'run-failed';
  if (status === 'cancelled') return 'run-cancelled';
  return null;
}

export function buildCheckpointsForRun(run: AgentRunState): WorkingCheckpoint[] {
  const checkpoints: WorkingCheckpoint[] = [];
  const runRef = buildRunEvidenceRef(run.runId, run.createdAt);

  checkpoints.push(buildWorkingCheckpoint({
    runId: run.runId,
    kind: 'run-created',
    summary: 'Run created',
    occurredAt: run.createdAt,
    evidenceRefs: [runRef],
    metadata: {
      stageId: run.pipelineStageId || run.stageId,
      projectId: run.projectId,
      executorKind: run.executorKind,
    },
  }));

  if (run.startedAt) {
    checkpoints.push(buildWorkingCheckpoint({
      runId: run.runId,
      kind: 'run-started',
      summary: 'Run started',
      occurredAt: run.startedAt,
      evidenceRefs: [runRef],
      metadata: {
        provider: run.provider,
        model: run.model,
      },
    }));
  }

  if (run.childConversationId || run.activeConversationId || run.sessionProvenance?.handle) {
    const occurredAt = run.sessionProvenance?.recordedAt || run.startedAt || run.createdAt;
    checkpoints.push(buildWorkingCheckpoint({
      runId: run.runId,
      kind: 'conversation-attached',
      summary: 'Execution conversation attached',
      occurredAt,
      evidenceRefs: [runRef],
      metadata: {
        childConversationId: run.childConversationId,
        activeConversationId: run.activeConversationId,
        sessionHandle: run.sessionProvenance?.handle,
        backendId: run.sessionProvenance?.backendId,
      },
    }));
  }

  if (run.result?.summary) {
    checkpoints.push(buildWorkingCheckpoint({
      runId: run.runId,
      kind: 'result-discovered',
      summary: run.result.summary.slice(0, 240),
      occurredAt: run.finishedAt || run.startedAt || run.createdAt,
      evidenceRefs: [runRef],
      metadata: {
        resultStatus: run.result.status,
        changedFileCount: run.result.changedFiles?.length || 0,
        blockerCount: run.result.blockers?.length || 0,
      },
    }));
  }

  if (run.resultEnvelope?.outputArtifacts?.length) {
    const artifactRefs = buildArtifactEvidenceRefs({
      runId: run.runId,
      artifacts: run.resultEnvelope.outputArtifacts,
      createdAt: run.finishedAt || run.startedAt || run.createdAt,
    });
    checkpoints.push(buildWorkingCheckpoint({
      runId: run.runId,
      kind: 'artifact-discovered',
      summary: `${artifactRefs.length} output artifact(s) discovered`,
      occurredAt: run.finishedAt || run.startedAt || run.createdAt,
      evidenceRefs: artifactRefs,
    }));
  }

  if (
    run.verificationPassed !== undefined
    || run.reportedEventDate
    || run.reportedEventCount !== undefined
    || run.reportApiResponse
  ) {
    checkpoints.push(buildWorkingCheckpoint({
      runId: run.runId,
      kind: 'verification-discovered',
      summary: 'Verification signal discovered',
      occurredAt: run.finishedAt || run.startedAt || run.createdAt,
      evidenceRefs: [
        buildEvidenceRef({
          type: run.reportApiResponse ? 'api-response' : 'run',
          runId: run.runId,
          label: 'Run verification signal',
          excerpt: run.reportApiResponse?.slice(0, 500),
          createdAt: run.finishedAt || run.startedAt || run.createdAt,
        }),
      ],
      metadata: {
        verificationPassed: run.verificationPassed,
        reportedEventDate: run.reportedEventDate,
        reportedEventCount: run.reportedEventCount,
      },
    }));
  }

  if (TERMINAL_STATUSES.has(run.status)) {
    const kind = terminalKind(run.status);
    if (kind) {
      checkpoints.push(buildWorkingCheckpoint({
        runId: run.runId,
        kind,
        summary: run.lastError || run.result?.summary || `Run ${run.status}`,
        occurredAt: run.finishedAt || run.startedAt || run.createdAt,
        evidenceRefs: [runRef],
        metadata: {
          status: run.status,
          reviewOutcome: run.reviewOutcome,
        },
      }));
    }
  }

  return checkpoints;
}

export function mergeCheckpoints(
  existing: WorkingCheckpoint[] = [],
  next: WorkingCheckpoint[] = [],
): WorkingCheckpoint[] {
  const map = new Map<string, WorkingCheckpoint>();
  for (const checkpoint of existing) {
    map.set(checkpoint.id, checkpoint);
  }
  for (const checkpoint of next) {
    map.set(checkpoint.id, checkpoint);
  }
  return Array.from(map.values())
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
}

