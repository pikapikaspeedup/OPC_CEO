/**
 * V2.5.1 Multi-Agent System — Conversation Watcher
 *
 * Watches a child conversation's step stream using the gRPC streaming API.
 * Uses the shared step-merger for delta merge.
 *
 * V2.5.1 enhancements:
 * - ERROR/CANCELED step detection as fallback idle signal
 * - Timer-based heartbeat poll (30s) to detect stale conversations
 *   because gRPC stream goes silent after initial delivery
 * - Propagates stepCount, lastStepAt, lastStepType, staleSince
 */

import { streamAgentState } from '../bridge/grpc';
import { mergeStepsUpdate, extractLastTaskBoundary, type TaskBoundaryInfo } from './step-merger';
import { createLogger } from '../logger';

const log = createLogger('Watcher');

/** Heartbeat poll interval: check for progress every 30s */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Stale detection threshold: flag as stale after 3 minutes of no new steps */
const STALE_THRESHOLD_MS = 180_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationWatchState {
  steps: any[];
  cascadeStatus: string;
  isActive: boolean;
  hasErrorSteps: boolean;
  lastTaskBoundary: TaskBoundaryInfo | null;
  // V2.5.1: step progress tracking
  stepCount: number;
  lastStepAt: string;
  lastStepType?: string;
  staleSince?: string;
}

export type WatchUpdateCallback = (state: ConversationWatchState) => void;
export type WatchErrorCallback = (err: Error) => void;

// ---------------------------------------------------------------------------
// Step-level error detection
// ---------------------------------------------------------------------------

/** Step types that should be skipped when scanning for error indicators */
const ERROR_SCAN_SKIP_TYPES = new Set([
  'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE',
  'CORTEX_STEP_TYPE_CONVERSATION_HISTORY',
  'CORTEX_STEP_TYPE_USER_INPUT',
  'CORTEX_STEP_TYPE_CHECKPOINT',
  'CORTEX_STEP_TYPE_FIND',
  'CORTEX_STEP_TYPE_VIEW_FILE',
  'CORTEX_STEP_TYPE_LIST_DIRECTORY',
  'CORTEX_STEP_TYPE_SEARCH',
  'CORTEX_STEP_TYPE_TOOL_CALL',
]);

/**
 * Check if the conversation's last steps indicate a terminal error state.
 * Fallback for when the cascade status never transitions to IDLE.
 * Returns { hasError, triggerStepIndex, triggerStepType, triggerStepStatus }.
 */
function detectStepLevelErrors(steps: any[]): {
  hasError: boolean;
  triggerStepIndex?: number;
  triggerStepType?: string;
  triggerStepStatus?: string;
} {
  if (steps.length === 0) return { hasError: false };

  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (!step) continue;
    const stepType = step.type || '';
    if (ERROR_SCAN_SKIP_TYPES.has(stepType)) continue;

    const status = step.status || '';
    const isError = (
      status === 'CORTEX_STEP_STATUS_ERROR' ||
      status === 'CORTEX_STEP_STATUS_CANCELED'
    );
    if (isError) {
      return { hasError: true, triggerStepIndex: i, triggerStepType: stepType, triggerStepStatus: status };
    }
    return { hasError: false };
  }
  return { hasError: false };
}

/**
 * Get the type of the last meaningful step.
 */
function getLastStepType(steps: any[]): string | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (!step?.type) continue;
    const t = step.type.replace('CORTEX_STEP_TYPE_', '');
    if (t === 'EPHEMERAL_MESSAGE' || t === 'CONVERSATION_HISTORY' || t === 'CHECKPOINT') continue;
    return t;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// watchConversation
// ---------------------------------------------------------------------------

export function watchConversation(
  conn: { port: number; csrf: string },
  cascadeId: string,
  onUpdate: WatchUpdateCallback,
  onError?: WatchErrorCallback,
  apiKey?: string,
): () => void {
  let fullSteps: any[] = [];
  let prevStepCount = 0;
  let lastCascadeStatus = '';
  let lastStepChangeTime = Date.now();
  let staleSince: string | undefined;
  let stopped = false;
  const shortId = cascadeId.slice(0, 8);

  log.info({ cascadeId: shortId, port: conn.port }, 'Watch started');

  /**
   * Emit an update to the callback with the current state.
   */
  const emitUpdate = (cleanSteps: any[], cascadeStatus: string, hasErrorSteps: boolean) => {
    const isActive = !hasErrorSteps && cascadeStatus !== 'idle';
    const lastTaskBoundary = extractLastTaskBoundary(cleanSteps);
    const lastStepType = getLastStepType(cleanSteps);

    onUpdate({
      steps: cleanSteps,
      cascadeStatus,
      isActive,
      hasErrorSteps,
      lastTaskBoundary,
      stepCount: cleanSteps.length,
      lastStepAt: new Date(lastStepChangeTime).toISOString(),
      lastStepType,
      staleSince,
    });
  };

  /**
   * Process steps and detect state changes.
   * Called both from stream updates and heartbeat polls.
   */
  let prevHasError = false;

  const processSteps = (cleanSteps: any[], cascadeStatus: string, source: string) => {
    const currentStepCount = cleanSteps.length;
    const now = Date.now();

    // Track step count changes
    if (currentStepCount !== prevStepCount) {
      const lastType = getLastStepType(cleanSteps);
      log.info({ cascadeId: shortId, steps: currentStepCount, lastStepType: lastType, source }, 'Steps updated');
      prevStepCount = currentStepCount;
      lastStepChangeTime = now;
      // Reset stale state on new progress
      if (staleSince) {
        log.info({ cascadeId: shortId, stepCount: currentStepCount, source }, 'Stale resolved: new steps arrived');
        staleSince = undefined;
      }
    }

    // Error step detection
    const errorResult = detectStepLevelErrors(cleanSteps);
    const hasErrorSteps = errorResult.hasError;

    // Log transition: false → true (this is the critical diagnostic for false-positive tracking)
    if (hasErrorSteps && !prevHasError) {
      log.warn({
        cascadeId: shortId,
        cascadeStatus,
        stepCount: currentStepCount,
        triggerIndex: errorResult.triggerStepIndex,
        triggerType: errorResult.triggerStepType,
        triggerStatus: errorResult.triggerStepStatus,
        source,
      }, 'ERROR detected — step that triggered error flag');
    } else if (!hasErrorSteps && prevHasError) {
      log.info({ cascadeId: shortId, stepCount: currentStepCount, source }, 'ERROR flag cleared — steps recovered');
    }
    prevHasError = hasErrorSteps;

    // Stale detection: no new steps while conversation supposedly active
    const isIdle = cascadeStatus === 'idle';
    const isActive = !isIdle && !hasErrorSteps;

    if (isActive && currentStepCount > 0) {
      const elapsedMs = now - lastStepChangeTime;
      if (elapsedMs >= STALE_THRESHOLD_MS && !staleSince) {
        staleSince = new Date(lastStepChangeTime + STALE_THRESHOLD_MS).toISOString();
        log.warn({ cascadeId: shortId, stepCount: currentStepCount, staleSec: Math.round(elapsedMs / 1000), cascadeStatus, source }, 'Child stale: no new steps');
      }
    }

    emitUpdate(cleanSteps, cascadeStatus, hasErrorSteps);
  };

  // -------------------------------------------------------------------------
  // Stream-based updates (may go silent — that's why we also have heartbeat)
  // -------------------------------------------------------------------------

  const abort = streamAgentState(
    conn.port,
    conn.csrf,
    cascadeId,
    (update: any) => {
      if (stopped) return;

      const stepsUpdate = update?.mainTrajectoryUpdate?.stepsUpdate;
      const status = update?.status || '';
      const cascadeStatus = status.replace('CASCADE_RUN_STATUS_', '').toLowerCase();

      if (stepsUpdate?.steps?.length) {
        fullSteps = mergeStepsUpdate(fullSteps, stepsUpdate);
      }

      // Log cascade status transitions
      if (cascadeStatus && cascadeStatus !== lastCascadeStatus) {
        log.info({ cascadeId: shortId, from: lastCascadeStatus || 'init', to: cascadeStatus, stepCount: prevStepCount }, 'Cascade status changed');
        lastCascadeStatus = cascadeStatus;
      }

      const cleanSteps = fullSteps.filter((s: any) => s != null);
      processSteps(cleanSteps, cascadeStatus || lastCascadeStatus, 'stream');
    },
    (err: Error) => {
      log.warn({ cascadeId: shortId, err: err.message }, 'Watch stream error');
      onError?.(err);
    },
  );

  // -------------------------------------------------------------------------
  // Heartbeat poll — timer-based safety net for when stream goes silent
  // -------------------------------------------------------------------------

  const heartbeat = setInterval(async () => {
    if (stopped || !apiKey) return;

    try {
      const { getTrajectorySteps } = await import('../bridge/grpc');
      const resp = await getTrajectorySteps(conn.port, conn.csrf, apiKey, cascadeId);
      const polledSteps = resp?.steps || [];

      if (polledSteps.length > 0) {
        const polledClean = polledSteps.filter((s: any) => s != null);
        log.debug({ cascadeId: shortId, polledSteps: polledClean.length, prevSteps: prevStepCount }, 'Heartbeat poll');
        processSteps(polledClean, lastCascadeStatus, 'heartbeat');
      }
    } catch (e: any) {
      log.warn({ cascadeId: shortId, err: e.message }, 'Heartbeat poll failed');
    }
  }, HEARTBEAT_INTERVAL_MS);

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  return () => {
    stopped = true;
    clearInterval(heartbeat);
    log.info({ cascadeId: shortId }, 'Watch aborted');
    abort();
  };
}
