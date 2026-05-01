/**
 * V2 Multi-Agent System — Run Registry
 *
 * In-memory store for AgentRunState with SQLite-backed persistence.
 * Survives dev-mode restarts. In-progress runs are marked failed on recovery.
 * V2: supports envelope fields, templateId, sourceRunIds.
 */

import { randomUUID } from 'crypto';
import type {
  AgentRunState,
  ExecutionTarget,
  ExecutorKind,
  RunStatus,
  TaskResult,
  TaskEnvelope,
  TriggerContext,
} from './group-types';
import { TERMINAL_STATUSES } from './group-types';
import type { PipelineStageProgress } from './project-types';
import { getProject, updatePipelineStage, updatePipelineStageByStageId } from './project-registry';
import { emitProjectEvent } from './project-events';
import { createLogger } from '../logger';
import { appendRunHistoryEntry } from './run-history';
import { listRunRecords, syncRunArtifactsToDeliverables, upsertRunRecord } from '../storage/gateway-db';
import { observeRunCapsuleForAgenda } from '../company-kernel/operating-integration';
import { observeRunFailureForPlatformEngineering } from '../company-kernel/platform-engineering-observer';
import { syncSystemImprovementProposalsForRun } from '../company-kernel/self-improvement-runtime-state';
import { finalizeBudgetForTerminalRun } from '../company-kernel/budget-gate';
import { recordRunTerminalForCircuitBreakers } from '../company-kernel/circuit-breaker';
import { buildRunCapsuleFromRun } from '../company-kernel/run-capsule';
import { getRunCapsuleByRunId, upsertRunCapsule } from '../company-kernel/run-capsule-store';

const log = createLogger('RunRegistry');

type ProcessWithBuiltinModule = NodeJS.Process & {
  getBuiltinModule?: (id: 'fs') => typeof import('fs');
};

const runtimeFs = (process as ProcessWithBuiltinModule).getBuiltinModule?.('fs');

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isReviewOutcome(value: unknown): value is AgentRunState['reviewOutcome'] {
  return value === 'approved' || value === 'rejected' || value === 'revise-exhausted';
}

function joinArtifactPath(base: string, artifactDir: string, subpath: string): string {
  const normalizedBase = base === '/' ? '/' : base.replace(/\/+$/, '');
  const relativePath = [artifactDir, subpath]
    .map((segment) => segment.replace(/^\/+/, ''))
    .filter(Boolean)
    .join('/');
  if (!normalizedBase) return relativePath;
  if (normalizedBase === '/') return `/${relativePath}`;
  return `${normalizedBase}/${relativePath}`;
}

// ---------------------------------------------------------------------------
// In-memory store (Preserved across Next.js HMR)
// ---------------------------------------------------------------------------

const globalForRegistry = globalThis as unknown as {
  __AGENT_RUNS_REGISTRY_MAP?: Map<string, AgentRunState>;
  __AGENT_RUNS_REGISTRY_INITIALIZED__?: boolean;
};

const runs = globalForRegistry.__AGENT_RUNS_REGISTRY_MAP || new Map<string, AgentRunState>();
let initialized = globalForRegistry.__AGENT_RUNS_REGISTRY_INITIALIZED__ || false;
if (process.env.NODE_ENV !== 'production') {
  globalForRegistry.__AGENT_RUNS_REGISTRY_MAP = runs;
  globalForRegistry.__AGENT_RUNS_REGISTRY_INITIALIZED__ = initialized;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function persistRun(run: AgentRunState): void {
  try {
    upsertRunRecord(run);
    log.debug({ runId: run.runId.slice(0, 8) }, 'Run persisted');
  } catch (err: unknown) {
    log.error({ err: getErrorMessage(err), runId: run.runId.slice(0, 8) }, 'Failed to persist run');
  }
}

function persistRunCapsuleSnapshot(run: AgentRunState): void {
  try {
    const capsule = upsertRunCapsule(buildRunCapsuleFromRun(run, getRunCapsuleByRunId(run.runId)));
    observeRunCapsuleForAgenda(capsule);
  } catch (err: unknown) {
    log.debug({ err: getErrorMessage(err), runId: run.runId.slice(0, 8) }, 'Failed to persist run capsule snapshot');
  }
}

function shouldCaptureRunCapsule(updates: Partial<Omit<AgentRunState, 'runId' | 'stageId' | 'workspace' | 'prompt' | 'createdAt'>>): boolean {
  return Boolean(
    updates.status
    || updates.startedAt
    || updates.finishedAt
    || updates.childConversationId
    || updates.activeConversationId
    || updates.sessionProvenance
    || updates.result
    || updates.resultEnvelope
    || updates.artifactManifestPath
    || updates.reviewOutcome
    || updates.reportedEventDate
    || updates.reportedEventCount !== undefined
    || updates.verificationPassed !== undefined
    || updates.reportApiResponse
    || updates.tokenUsage,
  );
}

function runtimeMinutesForRun(run: AgentRunState): number {
  const startedAt = run.startedAt || run.createdAt;
  const finishedAt = run.finishedAt || new Date().toISOString();
  const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.max(1, Math.ceil(durationMs / 60_000));
}

function artifactSignature(run: AgentRunState): string {
  return JSON.stringify(
    (run.resultEnvelope?.outputArtifacts || []).map((artifact) => ({
      path: artifact.path,
      title: artifact.title,
      kind: artifact.kind,
    })),
  );
}

function verificationSignature(run: AgentRunState): string {
  return JSON.stringify({
    verificationPassed: run.verificationPassed,
    reportedEventDate: run.reportedEventDate,
    reportedEventCount: run.reportedEventCount,
    reportApiResponse: run.reportApiResponse,
  });
}

/**
 * Attempt to recover a run from its artifacts.
 * @param force - if true, also attempts recovery on already-terminal runs (e.g. failed after restart).
 *                This is needed because loadFromDisk marks interrupted runs as failed,
 *                and the resume API's 'recover' action needs to re-check those.
 */
export function recoverInterruptedRun(entry: AgentRunState, force = false): boolean {
  // Without force, skip runs already in a terminal state
  if (!force && TERMINAL_STATUSES.has(entry.status)) return false;

  // Signal 1: resultEnvelope already completed
  if (entry.resultEnvelope?.status === 'completed') {
    entry.status = 'completed';
    entry.lastError = undefined;
    if (!entry.reviewOutcome && isReviewOutcome(entry.resultEnvelope.decision)) {
      entry.reviewOutcome = entry.resultEnvelope.decision;
    }
    return true;
  }

  // Signal 2 & 3: Check for generated result.json files
  // Resolve relative to the run's workspace (not process.cwd()),
  // falling back to cwd if workspace is missing
  const resolveBase = () => {
    if (entry.workspace) {
      return entry.workspace.replace(/^file:\/\//, '');
    }
    return process.cwd();
  };

  const checkResultFile = (subpath: string) => {
    if (!entry.artifactDir) return false;
    const fullPath = joinArtifactPath(resolveBase(), entry.artifactDir, subpath);
    if (!runtimeFs?.existsSync(fullPath)) return false;
    try {
      const data = JSON.parse(runtimeFs.readFileSync(fullPath, 'utf-8')) as TaskResult;
      if (data && data.status === 'completed') {
        entry.status = 'completed';
        entry.lastError = undefined;
        entry.result = data;
        return true;
      }
    } catch {
      // ignore parse errors
    }
    return false;
  };

  if (checkResultFile('result.json')) return true;
  if (checkResultFile('architecture/result.json')) return true;

  return false;
}

function loadFromDisk(): void {
  try {
    if (initialized) {
      return;
    }

    const entries = listRunRecords();
    let recovered = 0;
    let autoRecovered = 0;
    let skippedLegacy = 0;
    for (const entry of entries) {
      const canonicalStageId = entry.pipelineStageId || entry.stageId;
      if (!canonicalStageId) {
        skippedLegacy++;
        log.warn({ runId: entry.runId }, 'Skipping persisted run without stageId/pipelineStageId; legacy fallback removed');
        continue;
      }
      const normalizedEntry = {
        ...(entry as AgentRunState & { groupId?: string }),
        stageId: canonicalStageId,
        pipelineStageId: entry.pipelineStageId || canonicalStageId,
      };
      delete normalizedEntry.groupId;
      // In-progress runs that survived a true process restart.
      // Try to recover from completed artifacts, otherwise mark failed.
      let needsPersist = false;
      if (!TERMINAL_STATUSES.has(normalizedEntry.status)) {
        if (recoverInterruptedRun(normalizedEntry)) {
          autoRecovered++;
        } else {
          normalizedEntry.status = 'failed';
          normalizedEntry.lastError = 'Process restarted while run was in progress';
          normalizedEntry.finishedAt = new Date().toISOString();
        }
        recovered++;
        needsPersist = true;
      }
      runs.set(normalizedEntry.runId, normalizedEntry);
      if (needsPersist) {
        persistRun(normalizedEntry);
      }
      if (normalizedEntry.resultEnvelope?.outputArtifacts?.length) {
        syncRunArtifactsToDeliverables(normalizedEntry);
      }
    }
    initialized = true;
    globalForRegistry.__AGENT_RUNS_REGISTRY_INITIALIZED__ = true;
    log.info({ total: entries.length, recovered, autoRecovered, skippedLegacy }, 'Runs loaded from disk');

    // Post-load: sync any auto-recovered runs to their project pipeline
    for (const entry of runs.values()) {
      if (entry.status === 'completed' && entry.projectId && (entry.pipelineStageId || entry.pipelineStageIndex !== undefined)) {
        syncRunStatusToProject(entry);
      }
    }
  } catch (err: unknown) {
    log.warn({ err: getErrorMessage(err) }, 'Failed to load runs from disk');
  }
}

export function initializeRunRegistry(): void {
  loadFromDisk();
}

function ensureRunRegistryInitialized(): void {
  if (!initialized) {
    loadFromDisk();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createRun(input: {
  stageId: string;
  workspace: string;
  prompt: string;
  model?: string;
  parentConversationId?: string;
  // V2 fields
  templateId?: string;
  taskEnvelope?: TaskEnvelope;
  sourceRunIds?: string[];
  projectId?: string;
  // V3.5: Pipeline tracking
  pipelineId?: string;
  pipelineStageId?: string;
  pipelineStageIndex?: number;
  executorKind?: ExecutorKind;
  executionTarget?: ExecutionTarget;
  triggerContext?: TriggerContext;
  // V6.1: Provider tracking
  provider?: string;
  resolvedWorkflowRef?: string;
  resolvedSkillRefs?: string[];
  resolutionReason?: string;
  promptResolution?: AgentRunState['promptResolution'];
}): AgentRunState {
  ensureRunRegistryInitialized();
  const run: AgentRunState = {
    runId: randomUUID(),
    projectId: input.projectId,
    stageId: input.stageId,
    workspace: input.workspace,
    prompt: input.prompt,
    model: input.model,
    parentConversationId: input.parentConversationId,
    status: 'queued',
    createdAt: new Date().toISOString(),
    // V2 fields
    templateId: input.templateId,
    taskEnvelope: input.taskEnvelope,
    sourceRunIds: input.sourceRunIds,
    executorKind: input.executorKind,
    executionTarget: input.executionTarget,
    triggerContext: input.triggerContext,
    // V3.5: Pipeline tracking
    pipelineId: input.pipelineId,
    pipelineStageId: input.pipelineStageId ?? (input.templateId ? input.stageId : undefined),
    pipelineStageIndex: input.pipelineStageIndex,
    // V6.1: Provider tracking
    provider: input.provider,
    resolvedWorkflowRef: input.resolvedWorkflowRef,
    resolvedSkillRefs: input.resolvedSkillRefs,
    resolutionReason: input.resolutionReason,
    promptResolution: input.promptResolution,
  };
  // Runtime will backfill runId into taskEnvelope after creation
  if (run.taskEnvelope) {
    run.taskEnvelope.runId = run.runId;
  }
  runs.set(run.runId, run);
  persistRun(run);
  persistRunCapsuleSnapshot(run);
  appendRunHistoryEntry({
    runId: run.runId,
    provider: run.provider,
    eventType: 'run.created',
    details: {
      projectId: run.projectId,
      stageId: run.stageId,
      executorKind: run.executorKind,
      pipelineStageId: run.pipelineStageId,
    },
  });
  log.info({
    runId: run.runId.slice(0, 8),
    stageId: run.stageId,
    templateId: run.templateId,
    executorKind: run.executorKind || 'template',
  }, 'Run created');
  return run;
}

export function updateRun(
  runId: string,
  updates: Partial<Omit<AgentRunState, 'runId' | 'stageId' | 'workspace' | 'prompt' | 'createdAt'>>,
): AgentRunState | null {
  ensureRunRegistryInitialized();
  const run = runs.get(runId);
  if (!run) return null;

  const prevStatus = run.status;
  const prevSummary = run.result?.summary;
  const prevResultStatus = run.result?.status;
  const prevArtifacts = artifactSignature(run);
  const prevVerification = verificationSignature(run);
  Object.assign(run, updates);

  // Auto-set finishedAt for terminal statuses
  if (updates.status && TERMINAL_STATUSES.has(updates.status) && !run.finishedAt) {
    run.finishedAt = new Date().toISOString();
  }

  // V3.5 Fix: Clear finishedAt when recovering from terminal to non-terminal
  if (updates.status && !TERMINAL_STATUSES.has(updates.status) && run.finishedAt) {
    run.finishedAt = undefined;
  }

  persistRun(run);
  if (shouldCaptureRunCapsule(updates)) {
    persistRunCapsuleSnapshot(run);
  }
  log.debug({ runId: runId.slice(0, 8), status: run.status }, 'Run updated');

  if (run.resultEnvelope?.outputArtifacts?.length) {
    syncRunArtifactsToDeliverables(run);
  }

  // Pipeline state auto-sync: when a run transitions to terminal status,
  // propagate the change to the Project's pipelineState
  if (updates.status && updates.status !== prevStatus && run.projectId && (run.pipelineStageId || run.pipelineStageIndex !== undefined)) {
    syncRunStatusToProject(run);
  }

  if (updates.status && updates.status !== prevStatus && TERMINAL_STATUSES.has(run.status)) {
    try {
      finalizeBudgetForTerminalRun({
        runId,
        status: run.status,
        tokens: run.tokenUsage?.totalTokens,
        minutes: runtimeMinutesForRun(run),
        reason: run.status === 'completed' ? 'run completed' : run.lastError || `run ${run.status}`,
      });
    } catch (err: unknown) {
      log.debug({ runId: runId.slice(0, 8), err: getErrorMessage(err) }, 'Failed to finalize run budget ledger');
    }
    try {
      recordRunTerminalForCircuitBreakers(run);
    } catch (err: unknown) {
      log.debug({ runId: runId.slice(0, 8), err: getErrorMessage(err) }, 'Failed to update run circuit breakers');
    }
    try {
      observeRunFailureForPlatformEngineering(run);
    } catch (err: unknown) {
      log.debug({ runId: runId.slice(0, 8), err: getErrorMessage(err) }, 'Failed to observe platform engineering signal from terminal run');
    }
    void syncSystemImprovementProposalsForRun(run).catch((err: unknown) => {
      log.debug({ runId: runId.slice(0, 8), err: getErrorMessage(err) }, 'Failed to sync system improvement runtime state from terminal run');
    });
  }

  if (updates.status && updates.status !== prevStatus) {
    appendRunHistoryEntry({
      runId,
      provider: run.provider,
      sessionHandle: run.sessionProvenance?.handle,
      eventType: 'run.status_changed',
      details: {
        from: prevStatus,
        to: run.status,
        lastError: run.lastError,
      },
    });
  }

  if (run.result?.summary && (run.result.summary !== prevSummary || run.result.status !== prevResultStatus)) {
    appendRunHistoryEntry({
      runId,
      provider: run.provider,
      sessionHandle: run.sessionProvenance?.handle,
      eventType: 'result.discovered',
      details: {
        status: run.result.status,
        summary: run.result.summary,
      },
    });
  }

  if (run.resultEnvelope?.outputArtifacts?.length && artifactSignature(run) !== prevArtifacts) {
    appendRunHistoryEntry({
      runId,
      provider: run.provider,
      sessionHandle: run.sessionProvenance?.handle,
      eventType: 'artifact.discovered',
      details: {
        count: run.resultEnvelope.outputArtifacts.length,
        items: run.resultEnvelope.outputArtifacts.map((artifact) => ({
          title: artifact.title,
          kind: artifact.kind,
          path: artifact.path,
        })),
      },
    });
  }

  if (verificationSignature(run) !== prevVerification && (
    run.verificationPassed !== undefined
    || run.reportedEventDate
    || run.reportedEventCount !== undefined
    || run.reportApiResponse
  )) {
    appendRunHistoryEntry({
      runId,
      provider: run.provider,
      sessionHandle: run.sessionProvenance?.handle,
      eventType: 'verification.discovered',
      details: {
        verificationPassed: run.verificationPassed,
        reportedEventDate: run.reportedEventDate,
        reportedEventCount: run.reportedEventCount,
        reportApiResponse: run.reportApiResponse,
      },
    });
  }

  return run;
}

/**
 * Sync a run's terminal status to the Project's pipeline stage.
 * Called automatically by updateRun when status transitions.
 */
function syncRunStatusToProject(run: AgentRunState): void {
  const stageIdentifier = run.pipelineStageId || run.pipelineStageIndex;
  if (stageIdentifier === undefined) return;

  // Cancel is handled explicitly by the cancel flow to preserve operator intent.
  if (run.status === 'cancelled') {
    return;
  }

  const project = getProject(run.projectId!);
  const stage = project?.pipelineState?.stages.find((item: PipelineStageProgress) =>
    typeof stageIdentifier === 'string' ? item.stageId === stageIdentifier : item.stageIndex === stageIdentifier,
  );
  if (stage?.status === 'completed' && (run.status === 'running' || run.status === 'starting')) {
    log.warn({ runId: run.runId.slice(0, 8), stageId: stage.stageId }, 'Refusing to overwrite completed stage with running');
    return;
  }

  const applyStageUpdate = (updates: Record<string, unknown>) => {
    if (run.pipelineStageId) {
      updatePipelineStageByStageId(run.projectId!, run.pipelineStageId, updates);
    } else {
      updatePipelineStage(run.projectId!, run.pipelineStageIndex!, updates);
    }
  };

  if (run.status === 'running' || run.status === 'starting') {
    // V3.5 Fix 8: attempts is now managed by trackStageDispatch; only sync status here
    applyStageUpdate({
      status: 'running',
      runId: run.runId,
    });
  } else if (run.status === 'completed') {
    applyStageUpdate({
      status: 'completed',
      runId: run.runId,
      completedAt: run.finishedAt || new Date().toISOString(),
    });
  } else if (run.status === 'blocked') {
    applyStageUpdate({
      status: 'blocked',
      runId: run.runId,
      lastError: run.lastError,
    });
  } else if (run.status === 'failed' || run.status === 'timeout') {
    applyStageUpdate({
      status: 'failed',
      runId: run.runId,
      lastError: run.lastError,
    });
  }

  const updatedProject = getProject(run.projectId!);
  const resolvedStageId = typeof stageIdentifier === 'string'
    ? stageIdentifier
    : updatedProject?.pipelineState?.stages.find((item: PipelineStageProgress) => item.stageIndex === stageIdentifier)?.stageId;

  if (run.status === 'completed' && resolvedStageId) {
    emitProjectEvent({ type: 'stage:completed', projectId: run.projectId!, stageId: resolvedStageId, runId: run.runId });
  }

  // Emit stage:failed for failed/timeout/blocked runs so approval triggers can fire
  if ((run.status === 'failed' || run.status === 'timeout' || run.status === 'blocked') && resolvedStageId) {
    emitProjectEvent({
      type: 'stage:failed',
      projectId: run.projectId!,
      stageId: resolvedStageId,
      runId: run.runId,
      status: run.status === 'timeout' ? 'timeout' : run.status === 'blocked' ? 'blocked' : 'failed',
      error: run.lastError,
    });
  }

  if (updatedProject?.pipelineState?.status === 'completed') {
    emitProjectEvent({ type: 'project:completed', projectId: run.projectId! });
  }
}

export function getRun(runId: string): AgentRunState | null {
  ensureRunRegistryInitialized();
  return runs.get(runId) ?? null;
}

export function listRuns(filter?: { status?: RunStatus; stageId?: string; reviewOutcome?: string; projectId?: string; executorKind?: string; schedulerJobId?: string }): AgentRunState[] {
  ensureRunRegistryInitialized();
  let all = Array.from(runs.values());
  if (filter?.status) {
    all = all.filter(r => r.status === filter.status);
  }
  if (filter?.stageId) {
    all = all.filter(r => (r.pipelineStageId || r.stageId) === filter.stageId);
  }
  if (filter?.reviewOutcome) {
    all = all.filter(r => r.reviewOutcome === filter.reviewOutcome);
  }
  if (filter?.projectId) {
    all = all.filter(r => r.projectId === filter.projectId);
  }
  if (filter?.executorKind) {
    all = all.filter(r => r.executorKind === filter.executorKind);
  }
  if (filter?.schedulerJobId) {
    all = all.filter(r => r.triggerContext?.schedulerJobId === filter.schedulerJobId);
  }
  // Return newest first
  return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Returns all child conversation IDs from all runs.
 * Includes IDs from multi-role runs' role progress entries.
 * Used by the conversation filter to hide child conversations.
 */
export function getChildConversationIds(): Set<string> {
  ensureRunRegistryInitialized();
  const ids = new Set<string>();
  for (const run of runs.values()) {
    if (run.childConversationId) {
      ids.add(run.childConversationId);
    }
    // V1.5+: multi-role runs have child IDs in role progress
    if (run.roles) {
      for (const role of run.roles) {
        if (role.childConversationId) {
          ids.add(role.childConversationId);
        }
      }
    }
  }
  return ids;
}
