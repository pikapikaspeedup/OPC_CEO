/**
 * Runtime Helpers — shared utility functions used across group-runtime modules.
 *
 * Pure functions and small side-effect helpers extracted from group-runtime.ts
 * to reduce file size and enable reuse without circular dependencies.
 */

import { grpc } from '../bridge/gateway';
import { getRun, updateRun } from './run-registry';
import { getCopiedArtifactPath } from './prompt-builder';
import type {
  AgentRunState, TaskResult, TaskEnvelope,
  RoleInputReadAudit, RoleReadEvidence, InputArtifactReadAuditEntry,
} from './group-types';
import { createLogger } from '../logger';
import * as path from 'path';

const log = createLogger('Runtime');

// ---------------------------------------------------------------------------
// Conversation guard
// ---------------------------------------------------------------------------

export function isAuthoritativeConversation(run: AgentRunState | null, conversationId: string): run is AgentRunState {
  return !!run && (!run.activeConversationId || run.activeConversationId === conversationId);
}

// ---------------------------------------------------------------------------
// Best-effort cascade cancellation
// ---------------------------------------------------------------------------

export async function cancelCascadeBestEffort(
  cascadeId: string | undefined,
  conn: { port: number; csrf: string },
  apiKey: string,
  shortRunId: string,
): Promise<void> {
  if (!cascadeId) return;
  try {
    await grpc.cancelCascade(conn.port, conn.csrf, apiKey, cascadeId);
  } catch (err: any) {
    log.warn({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8), err: err.message }, 'Best-effort cancel for superseded cascade failed');
  }
}

// ---------------------------------------------------------------------------
// Failure helpers
// ---------------------------------------------------------------------------

export function summarizeFailureText(text?: string): string | undefined {
  if (!text) return undefined;
  const firstMeaningfulLine = text
    .split('\n')
    .map(line => line.trim().replace(/^#+\s*/, ''))
    .find(line => line.length > 0);

  if (!firstMeaningfulLine) return undefined;
  return firstMeaningfulLine.length > 240
    ? `${firstMeaningfulLine.slice(0, 237)}...`
    : firstMeaningfulLine;
}

export function getFailureReason(result: TaskResult): string | undefined {
  return result.blockers[0] || summarizeFailureText(result.summary);
}

// ---------------------------------------------------------------------------
// Propagate termination — mark run and pending roles on failure
// ---------------------------------------------------------------------------

export function propagateTermination(
  runId: string,
  failStatus: 'failed' | 'blocked' | 'cancelled' | 'timeout',
  lastError?: string,
): void {
  const run = getRun(runId);
  if (run?.roles) {
    for (const role of run.roles) {
      if (role.status === 'queued' || role.status === 'starting') {
        role.status = 'cancelled';
      }
    }
    updateRun(runId, { roles: run.roles });
  }
  updateRun(runId, {
    status: failStatus,
    lastError: lastError ?? run?.lastError ?? (failStatus === 'timeout' ? 'Role exceeded timeout limit' : undefined),
  });
}

// ---------------------------------------------------------------------------
// Task envelope
// ---------------------------------------------------------------------------

export function getCanonicalTaskEnvelope(runId: string, fallback?: TaskEnvelope): TaskEnvelope | undefined {
  return getRun(runId)?.taskEnvelope || fallback;
}

// ---------------------------------------------------------------------------
// Path normalization & evidence
// ---------------------------------------------------------------------------

export function normalizeComparablePath(value: string | undefined): string {
  if (!value) return '';
  let normalized = value.trim();
  if (normalized.startsWith('file://')) {
    normalized = normalized.replace(/^file:\/\//, '');
  }
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep original if URI decoding fails
  }
  return path.normalize(normalized).replace(/\\/g, '/');
}

export function includesPathCandidate(haystack: string, candidate: string): boolean {
  if (!haystack || !candidate) return false;
  return haystack.replace(/\\/g, '/').includes(candidate.replace(/\\/g, '/'));
}

export function extractStepReadEvidence(steps: any[]): RoleReadEvidence[] {
  const evidence: RoleReadEvidence[] = [];

  steps.forEach((step, stepIndex) => {
    const stepType = typeof step?.type === 'string' ? step.type : 'unknown';
    const viewTarget = step?.viewFile?.absoluteUri || step?.viewFile?.absolutePathUri || step?.viewFile?.absolutePath;
    if (typeof viewTarget === 'string' && viewTarget.trim()) {
      evidence.push({ stepIndex, stepType, target: viewTarget });
    }

    const commandTarget = step?.runCommand?.commandLine || step?.runCommand?.command;
    if (typeof commandTarget === 'string' && commandTarget.trim()) {
      evidence.push({ stepIndex, stepType, target: commandTarget });
    }
  });

  return evidence;
}

export function filterEvidenceByCandidates(evidence: RoleReadEvidence[], candidates: string[]): RoleReadEvidence[] {
  const normalizedCandidates = candidates
    .map(candidate => normalizeComparablePath(candidate))
    .filter(Boolean);

  return evidence.filter((item) => {
    const normalizedTarget = normalizeComparablePath(item.target);
    return normalizedCandidates.some((candidate) =>
      normalizedTarget === candidate
      || includesPathCandidate(item.target, candidate)
      || includesPathCandidate(normalizedTarget, candidate));
  });
}

export function dedupeStringList(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

// ---------------------------------------------------------------------------
// Input read audit
// ---------------------------------------------------------------------------

export function buildRoleInputReadAudit(
  runId: string,
  artifactDir: string,
  taskEnvelope: TaskEnvelope | undefined,
  steps: any[],
): RoleInputReadAudit | undefined {
  const run = getRun(runId);
  if (!run) return undefined;

  const workspacePath = run.workspace.replace(/^file:\/\//, '');
  const taskEnvelopeRelPath = `${artifactDir}task-envelope.json`;
  const taskEnvelopeAbsPath = path.join(workspacePath, taskEnvelopeRelPath);
  const evidence = extractStepReadEvidence(steps);
  const taskEnvelopeEvidence = filterEvidenceByCandidates(evidence, [taskEnvelopeAbsPath, taskEnvelopeRelPath]);
  const inputArtifacts = taskEnvelope?.inputArtifacts || [];

  if (inputArtifacts.length === 0) {
    return {
      status: 'not_applicable',
      auditedAt: new Date().toISOString(),
      taskEnvelopePath: taskEnvelopeRelPath,
      taskEnvelopeRead: taskEnvelopeEvidence.length > 0,
      taskEnvelopeEvidence,
      requiredArtifactCount: 0,
      canonicalReadCount: 0,
      alternateReadCount: 0,
      missingCanonicalPaths: [],
      summary: 'No canonical input artifacts were required for this role.',
      entries: [],
    };
  }

  const entries: InputArtifactReadAuditEntry[] = inputArtifacts.map((artifact) => {
    const canonicalRelPath = `${artifactDir}${getCopiedArtifactPath(artifact)}`;
    const canonicalAbsPath = path.join(workspacePath, canonicalRelPath);
    const canonicalEvidence = filterEvidenceByCandidates(evidence, [canonicalAbsPath, canonicalRelPath]);

    const alternateCandidates: string[] = [];
    if (artifact.sourceRunId) {
      const sourceRun = getRun(artifact.sourceRunId);
      if (sourceRun?.artifactDir) {
        const sourceRelPath = `${sourceRun.artifactDir}${artifact.path}`;
        const sourceAbsPath = path.join(workspacePath, sourceRelPath);
        alternateCandidates.push(sourceAbsPath, sourceRelPath);
      }
    }

    const alternateEvidence = filterEvidenceByCandidates(evidence, alternateCandidates).filter((item) =>
      !canonicalEvidence.some((match) =>
        match.stepIndex === item.stepIndex
        && match.stepType === item.stepType
        && match.target === item.target));

    return {
      artifactId: artifact.id,
      title: artifact.title,
      kind: artifact.kind,
      sourceRunId: artifact.sourceRunId,
      originalPath: artifact.path,
      canonicalPath: canonicalRelPath,
      canonicalRead: canonicalEvidence.length > 0,
      evidence: canonicalEvidence,
      alternateReadPaths: dedupeStringList(alternateEvidence.map(item => item.target)),
    };
  });

  const canonicalReadCount = entries.filter(entry => entry.canonicalRead).length;
  const alternateReadCount = entries.filter(entry => (entry.alternateReadPaths || []).length > 0).length;
  const missingCanonicalPaths = entries
    .filter(entry => !entry.canonicalRead)
    .map(entry => entry.canonicalPath);

  const status = canonicalReadCount === inputArtifacts.length
    ? 'verified'
    : canonicalReadCount > 0
      ? 'partial'
      : 'missing';

  const summaryParts = [
    `Canonical inputs read: ${canonicalReadCount}/${inputArtifacts.length}.`,
    taskEnvelopeEvidence.length > 0 ? 'Task envelope read: yes.' : 'Task envelope read: no.',
  ];
  if (alternateReadCount > 0) {
    summaryParts.push(`Alternate/source-path reads observed for ${alternateReadCount} artifact(s).`);
  }
  if (missingCanonicalPaths.length > 0) {
    summaryParts.push(`Missing canonical reads: ${missingCanonicalPaths.join(', ')}.`);
  }

  return {
    status,
    auditedAt: new Date().toISOString(),
    taskEnvelopePath: taskEnvelopeRelPath,
    taskEnvelopeRead: taskEnvelopeEvidence.length > 0,
    taskEnvelopeEvidence,
    requiredArtifactCount: inputArtifacts.length,
    canonicalReadCount,
    alternateReadCount,
    missingCanonicalPaths,
    summary: summaryParts.join(' '),
    entries,
  };
}

// ---------------------------------------------------------------------------
// Canonical input read protocol enforcement
// ---------------------------------------------------------------------------

export function enforceCanonicalInputReadProtocol(
  roleId: string,
  result: TaskResult,
  audit: RoleInputReadAudit | undefined,
): TaskResult {
  if (!audit || result.status !== 'completed' || audit.status === 'not_applicable' || audit.status === 'verified') {
    return result;
  }

  const violation = audit.missingCanonicalPaths.length > 0
    ? `Protocol violation: role ${roleId} did not read required canonical input artifacts from this run: ${audit.missingCanonicalPaths.join(', ')}`
    : `Protocol violation: role ${roleId} did not verify required canonical input artifact reads.`;

  const blockers = dedupeStringList([...(result.blockers || []), violation, audit.summary]);
  const summary = result.summary ? `${result.summary}\n\n${violation}` : violation;

  return {
    ...result,
    status: 'blocked',
    summary,
    blockers,
  };
}
