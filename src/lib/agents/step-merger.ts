/**
 * V1 Multi-Agent System — Step Merger
 *
 * Shared step delta merge logic extracted from server.ts.
 * Used by both the WebSocket server and watch-conversation.ts.
 */

// ---------------------------------------------------------------------------
// mergeStepsUpdate
// ---------------------------------------------------------------------------

/**
 * Merge a delta step update into the full steps array.
 * Handles two modes:
 *   1. Index-based delta: stepsUpdate has `indices` array mapping each new step to its position
 *   2. Full replace: no indices, just replace if the new array is >= current length
 *
 * Returns the new full steps array (may be the same reference mutated, or a fresh copy).
 */
export function mergeStepsUpdate(
  fullSteps: any[],
  stepsUpdate: { steps?: any[]; indices?: number[]; totalLength?: number },
): any[] {
  const indices: number[] = stepsUpdate.indices || [];
  const newSteps: any[] = stepsUpdate.steps || [];
  const totalLength: number = stepsUpdate.totalLength || 0;

  if (indices.length > 0 && indices.length === newSteps.length) {
    // Index-based delta merge
    if (totalLength > fullSteps.length) {
      fullSteps.length = totalLength;
    }
    for (let i = 0; i < indices.length; i++) {
      fullSteps[indices[i]] = newSteps[i];
    }
    return fullSteps;
  } else if (newSteps.length >= fullSteps.length) {
    // Full replace
    return [...newSteps];
  }

  return fullSteps;
}

// ---------------------------------------------------------------------------
// extractLastTaskBoundary
// ---------------------------------------------------------------------------

export interface TaskBoundaryInfo {
  mode?: string;
  taskName?: string;
  taskStatus?: string;
  taskSummary?: string;
}

/**
 * Scan steps from the end to find the latest TASK_BOUNDARY step.
 * Returns the task boundary info, or null if none found.
 */
export function extractLastTaskBoundary(steps: any[]): TaskBoundaryInfo | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i]?.type === 'CORTEX_STEP_TYPE_TASK_BOUNDARY') {
      return steps[i].taskBoundary ?? null;
    }
  }
  return null;
}
