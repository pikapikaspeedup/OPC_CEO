/**
 * Supervisor Loop — AI-powered run monitoring.
 *
 * Extracted from group-runtime.ts for maintainability.
 * Creates a separate conversation to periodically review the active agent's progress
 * and detect stuck/looping behavior.
 */

import { grpc } from '../bridge/gateway';
import { getRun, updateRun } from './run-registry';
import { TERMINAL_STATUSES } from './group-types';
import type { SupervisorReview, SupervisorDecision, SupervisorSummary } from './group-types';
import { createLogger } from '../logger';
import { resolveProvider } from '../providers';

const log = createLogger('Supervisor');

const SUPERVISOR_MODEL_FALLBACK = 'MODEL_PLACEHOLDER_M47';
export const SUPERVISOR_MODEL = resolveProvider('supervisor').model ?? SUPERVISOR_MODEL_FALLBACK;

// ---------------------------------------------------------------------------
// Step summarization
// ---------------------------------------------------------------------------

/**
 * Summarize a single step into a human-readable one-liner for the supervisor prompt.
 */
export function summarizeStepForSupervisor(step: any): string {
  const type = (step.type || '').replace('CORTEX_STEP_TYPE_', '');
  switch (type) {
    case 'CODE_ACTION': {
      const spec = step.codeAction?.actionSpec || {};
      const file = (spec.createFile?.absoluteUri || spec.editFile?.absoluteUri || spec.deleteFile?.absoluteUri || '').split('/').pop() || '?';
      const action = spec.createFile ? 'create' : spec.deleteFile ? 'delete' : 'edit';
      return `[CODE_ACTION] ${action} ${file}`;
    }
    case 'VIEW_FILE':
      return `[VIEW_FILE] ${(step.viewFile?.absoluteUri || '').split('/').pop() || '?'}`;
    case 'GREP_SEARCH':
      return `[GREP_SEARCH] "${step.grepSearch?.query || step.grepSearch?.searchPattern || '?'}"`;
    case 'RUN_COMMAND':
      return `[RUN_COMMAND] ${(step.runCommand?.command || step.runCommand?.commandLine || '?').slice(0, 80)}`;
    case 'SEARCH_WEB':
      return `[SEARCH_WEB] "${step.searchWeb?.query || '?'}"`;
    case 'FIND':
      return `[FIND] pattern="${step.find?.pattern || '?'}" in ${(step.find?.searchDirectory || '').split('/').pop() || '/'}`;
    case 'LIST_DIRECTORY':
      return `[LIST_DIR] ${(step.listDirectory?.path || '').split('/').pop() || '/'}`;
    case 'PLANNER_RESPONSE': {
      const pr = step.plannerResponse || {};
      const text = pr.modifiedResponse || pr.response || '';
      return `[PLANNER_RESPONSE] ${text.slice(0, 120)}${text.length > 120 ? '...' : ''}`;
    }
    case 'USER_INPUT':
      return `[USER_INPUT]`;
    case 'ERROR_MESSAGE':
      return `[ERROR] ${(step.errorMessage?.message || '').slice(0, 80)}`;
    default:
      return `[${type}]`;
  }
}

// ---------------------------------------------------------------------------
// Supervisor Loop
// ---------------------------------------------------------------------------

export async function startSupervisorLoop(
  runId: string,
  cascadeId: string,
  goal: string,
  apiKey: string,
  server: { port: number; csrf: string },
  wsUri: string,
) {
  const MAX_REVIEWS = 10;
  const REVIEW_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
  const POLL_INTERVAL_MS = 5_000;
  const POLL_TIMEOUT_MS = 90_000; // max wait per review round
  const STUCK_CANCEL_THRESHOLD = 3; // consecutive STUCK rounds before suggesting cancel

  // Create a single supervisor conversation for all review rounds
  let supervisorCascadeId: string | undefined;

  // Track previous review state for comparison
  let prevStepCount = 0;
  let prevLastStepType = '';
  let prevDecision: string | undefined;

  // Track consecutive stuck/looping for escalation
  let consecutiveStuck = 0;
  let consecutiveStuckPeak = 0;
  let healthyCount = 0;
  let stuckCount = 0;
  let loopingCount = 0;
  let doneCount = 0;
  const suggestedActions: string[] = [];
  const loopStartedAt = new Date().toISOString();

  // Wait one interval before first review
  await new Promise(r => setTimeout(r, REVIEW_INTERVAL_MS));

  for (let i = 1; i <= MAX_REVIEWS; i++) {
    const run = getRun(runId);
    if (!run || TERMINAL_STATUSES.has(run.status)) {
      break;
    }
    if (!run.liveState) continue;

    // Dynamically track the current active conversation
    const currentCascadeId = run.activeConversationId || cascadeId;

    try {
      // 1. Collect context: fetch recent steps of the currently active agent
      const resp = await grpc.getTrajectorySteps(server.port, server.csrf, apiKey, currentCascadeId);
      const allSteps = (resp?.steps || []).filter((s: any) => s != null);

      const recentSteps = allSteps.slice(-8).map(summarizeStepForSupervisor);
      const recentStepsText = recentSteps.join('\n') || 'No recent actions.';

      const currentStepCount = allSteps.length;
      const currentLastStepType = run.liveState.lastStepType || 'None';
      const staleTimeMs = run.liveState.staleSince
        ? Date.now() - new Date(run.liveState.staleSince).getTime()
        : 0;

      const deltaSteps = currentStepCount - prevStepCount;
      const comparisonText = i === 1
        ? '(First review — no prior data to compare)'
        : `Previous review (#${i - 1}):
- Previous step count: ${prevStepCount} → Current: ${currentStepCount} (delta: ${deltaSteps > 0 ? '+' : ''}${deltaSteps})
- Previous last activity: ${prevLastStepType}
- Previous assessment: ${prevDecision || 'N/A'}
${deltaSteps === 0 ? '⚠️ NO NEW STEPS since last review — agent may be stuck!' : ''}`;

      // 2. Build review prompt
      const activeRoleId = run.activeRoleId || 'unknown';
      const reviewPrompt = `[Review Round #${i}]
Task Goal: ${goal}

Current State: 
- Active Role: ${activeRoleId}
- Cascade Status: ${run.liveState.cascadeStatus}
- Total steps executed: ${currentStepCount}
- Last activity type: ${currentLastStepType}
- Time since last step: ${Math.round(staleTimeMs / 1000)}s

Comparison with previous review:
${comparisonText}

Recent Actions (last 8 steps):
${recentStepsText}

Is the agent making meaningful progress toward the goal, stuck, looping, or done?
Reply with ONLY a JSON object: {"status": "HEALTHY|STUCK|LOOPING|DONE", "analysis": "brief reason"}`;

      // 3. Create or reuse the supervisor conversation
      if (!supervisorCascadeId) {
        const startResult = await grpc.startCascade(server.port, server.csrf, apiKey, wsUri);
        supervisorCascadeId = startResult?.cascadeId;
        if (!supervisorCascadeId) {
          log.warn({ runId: runId.slice(0, 8), round: i }, 'Supervisor review: startCascade returned no cascadeId');
          continue;
        }
        await grpc.updateConversationAnnotations(server.port, server.csrf, apiKey, supervisorCascadeId, {
          'antigravity.task.hidden': 'true',
          'antigravity.task.type': 'supervisor-review',
          'antigravity.task.runId': runId,
        });
      }

      await grpc.sendMessage(
        server.port, server.csrf, apiKey, supervisorCascadeId,
        reviewPrompt, SUPERVISOR_MODEL,
        false,
        undefined,
        'ARTIFACT_REVIEW_MODE_TURBO',
      );

      // 4. Poll for the model's response
      const pollStart = Date.now();
      let responseText = '';
      const preStepsResp = await grpc.getTrajectorySteps(server.port, server.csrf, apiKey, supervisorCascadeId);
      const preStepCount = (preStepsResp?.steps || []).filter((s: any) => s != null).length;

      while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

        const stepsResp = await grpc.getTrajectorySteps(server.port, server.csrf, apiKey, supervisorCascadeId);
        const steps = (stepsResp?.steps || []).filter((s: any) => s != null);

        for (let j = steps.length - 1; j >= preStepCount; j--) {
          const step = steps[j];
          if (step?.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
            const planner = step.plannerResponse || step.response || {};
            const text = planner.modifiedResponse || planner.response || '';
            if (text) {
              responseText = text;
              break;
            }
          }
        }
        if (responseText) break;
      }

      if (!responseText) {
        log.warn({ runId: runId.slice(0, 8), round: i }, 'Supervisor review: no response within timeout');
        continue;
      }

      // 5. Parse JSON from the model response
      let decision: SupervisorDecision;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
        decision = jsonMatch ? JSON.parse(jsonMatch[0]) : { status: 'HEALTHY', analysis: responseText.slice(0, 200) };
        if (!['HEALTHY', 'STUCK', 'LOOPING', 'DONE'].includes(decision.status)) {
          decision.status = 'HEALTHY';
        }
      } catch {
        decision = { status: 'HEALTHY', analysis: `(Parse failed) ${responseText.slice(0, 200)}` };
      }

      prevStepCount = currentStepCount;
      prevLastStepType = currentLastStepType;
      prevDecision = decision.status;

      let suggestedAction: 'none' | 'nudge' | 'cancel' = 'none';
      if (decision.status === 'STUCK' || decision.status === 'LOOPING') {
        consecutiveStuck++;
        if (consecutiveStuck > consecutiveStuckPeak) consecutiveStuckPeak = consecutiveStuck;
        if (consecutiveStuck >= STUCK_CANCEL_THRESHOLD) {
          suggestedAction = 'cancel';
          suggestedActions.push(`Round ${i}: suggest cancel (${consecutiveStuck} consecutive ${decision.status})`);
        } else {
          suggestedAction = 'nudge';
          suggestedActions.push(`Round ${i}: suggest nudge (${decision.status})`);
        }
      } else {
        consecutiveStuck = 0;
      }

      switch (decision.status) {
        case 'HEALTHY': healthyCount++; break;
        case 'STUCK': stuckCount++; break;
        case 'LOOPING': loopingCount++; break;
        case 'DONE': doneCount++; break;
      }

      decision.suggestedAction = suggestedAction;

      // 6. Write review result
      const review: SupervisorReview = {
        id: `rev-${Date.now()}`,
        timestamp: new Date().toISOString(),
        round: i,
        stepCount: currentStepCount,
        decision,
      };

      const currentRun = getRun(runId);
      if (currentRun) {
        const reviews = [...(currentRun.supervisorReviews || []), review];
        updateRun(runId, { supervisorReviews: reviews });
        log.info({ runId: runId.slice(0, 8), reviewRound: i, decision: decision.status, steps: currentStepCount, delta: deltaSteps }, 'Supervisor review completed');
      }
    } catch (err: any) {
      log.warn({ runId: runId.slice(0, 8), round: i, err: err.message }, 'Supervisor loop iteration failed');
    }

    if (i < MAX_REVIEWS) {
      await new Promise(r => setTimeout(r, REVIEW_INTERVAL_MS));
    }
  }

  // Write supervisor summary when loop exits
  const finalRun = getRun(runId);
  if (finalRun) {
    const totalRounds = (finalRun.supervisorReviews || []).length;
    const summary: SupervisorSummary = {
      totalRounds,
      healthyCount,
      stuckCount,
      loopingCount,
      doneCount,
      consecutiveStuckPeak,
      suggestedActions,
      startedAt: loopStartedAt,
      finishedAt: new Date().toISOString(),
    };
    updateRun(runId, { supervisorSummary: summary });
    log.info({ runId: runId.slice(0, 8), totalRounds, healthyCount, stuckCount, loopingCount, doneCount, consecutiveStuckPeak }, 'Supervisor loop finished');
  }
}
