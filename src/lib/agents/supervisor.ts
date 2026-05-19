/**
 * Supervisor Loop — AI-powered run monitoring.
 *
 * Provider-neutral periodic monitor that reviews a run's recent steps and
 * detects stuck/looping behavior without assuming Antigravity gRPC.
 */

import { getRun, updateRun } from './run-registry';
import { TERMINAL_STATUSES } from './group-types';
import type { SupervisorReview, SupervisorDecision, SupervisorSummary } from './group-types';
import { resolveRunSessionHandle } from './session-handle';
import { createLogger } from '../logger';
import { resolveProvider } from '../providers';
import type { ProviderId } from '../providers';
import {
  applyBeforeRunMemoryHooks,
  consumeAgentSession,
  ensureBuiltInAgentBackends,
  getAgentBackend,
  getBackendDiagnosticsExtension,
  getBackendSessionMetadataExtension,
  registerAgentSession,
  type BackendRunConfig,
  type CancelledAgentEvent,
  type CompletedAgentEvent,
  type FailedAgentEvent,
} from '../backends';
import { readRunHistory } from './run-history';

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

function historyFallbackSteps(runId: string): unknown[] {
  return readRunHistory(runId)
    .filter((entry) => entry.eventType === 'conversation.message.user' || entry.eventType === 'conversation.message.assistant')
    .slice(-24)
    .map((entry) => entry.eventType === 'conversation.message.user'
      ? {
          type: 'CORTEX_STEP_TYPE_USER_INPUT',
          userInput: {
            items: [{ text: typeof entry.details.content === 'string' ? entry.details.content : '' }],
            media: [],
          },
        }
      : {
          type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
          plannerResponse: {
            response: typeof entry.details.content === 'string' ? entry.details.content : '',
          },
        });
}

async function readRecentSupervisorSteps(
  runId: string,
  handle: string,
  provider: ProviderId,
): Promise<unknown[]> {
  ensureBuiltInAgentBackends();
  const backend = getAgentBackend(provider);
  const diagnostics = getBackendDiagnosticsExtension(backend);
  if (!diagnostics) {
    return historyFallbackSteps(runId);
  }

  try {
    const steps = await diagnostics.getRecentSteps(handle);
    return steps.length > 0 ? steps : historyFallbackSteps(runId);
  } catch {
    return historyFallbackSteps(runId);
  }
}

function extractSupervisorResponse(
  completed: CompletedAgentEvent | null,
  failed: FailedAgentEvent | null,
  cancelled: CancelledAgentEvent | null,
): string {
  if (failed) return failed.error.message;
  if (cancelled) return cancelled.reason || 'Supervisor evaluation cancelled.';
  if (completed?.finalText?.trim()) return completed.finalText;

  const rawSteps = completed?.rawSteps as Array<Record<string, any>> | undefined;
  if (!rawSteps?.length) return '';
  for (let index = rawSteps.length - 1; index >= 0; index--) {
    const step = rawSteps[index];
    const planner = step?.plannerResponse || step?.response || {};
    const text = planner.modifiedResponse || planner.response || '';
    if (text) {
      return text;
    }
  }
  return '';
}

async function runSupervisorAssessment(options: {
  runId: string;
  workspacePath: string;
  handle: string;
  diagnosticsProvider: ProviderId;
  prompt: string;
}): Promise<SupervisorDecision | null> {
  ensureBuiltInAgentBackends();
  const configuredSupervisorProvider = resolveProvider('supervisor', options.workspacePath).provider as ProviderId;
  const evalProvider = configuredSupervisorProvider === 'antigravity' && options.diagnosticsProvider !== 'antigravity'
    ? options.diagnosticsProvider
    : configuredSupervisorProvider;
  const evalBackend = getAgentBackend(evalProvider);
  const evalRunId = `supervisor-${options.runId}-${Date.now()}`;
  const evalConfig = await applyBeforeRunMemoryHooks(evalProvider, {
    runId: evalRunId,
    workspacePath: options.workspacePath,
    prompt: options.prompt,
    model: SUPERVISOR_MODEL,
    parentConversationId: options.handle,
    executionTarget: { kind: 'prompt' },
    metadata: {
      stageId: 'supervisor-review',
      roleId: 'supervisor-review',
      executorKind: 'prompt',
    },
    timeoutMs: 90_000,
  } as BackendRunConfig);

  const evalSession = await evalBackend.start(evalConfig);
  registerAgentSession(evalSession);

  let completed: CompletedAgentEvent | null = null;
  let failed: FailedAgentEvent | null = null;
  let cancelled: CancelledAgentEvent | null = null;

  await consumeAgentSession(evalRunId, evalSession, {
    onStarted: async (event) => {
      updateRun(options.runId, { supervisorConversationId: event.handle });

      const metadataWriter = getBackendSessionMetadataExtension(evalBackend);
      if (!metadataWriter) {
        return;
      }

      await metadataWriter.annotateSession(event.handle, {
        'antigravity.task.type': 'supervisor-review',
        'antigravity.task.runId': options.runId,
        'antigravity.task.hidden': 'true',
      });
    },
    onCompleted: (event) => {
      completed = event;
    },
    onFailed: (event) => {
      failed = event;
    },
    onCancelled: (event) => {
      cancelled = event;
    },
  });

  const responseText = extractSupervisorResponse(completed, failed, cancelled);
  if (!responseText.trim()) {
    return null;
  }

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
    const decision = jsonMatch
      ? JSON.parse(jsonMatch[0]) as SupervisorDecision
      : { status: 'HEALTHY' as const, analysis: responseText.slice(0, 200) };
    if (!['HEALTHY', 'STUCK', 'LOOPING', 'DONE'].includes(decision.status)) {
      decision.status = 'HEALTHY';
    }
    return decision;
  } catch {
    return { status: 'HEALTHY' as const, analysis: `(Parse failed) ${responseText.slice(0, 200)}` };
  }
}

// ---------------------------------------------------------------------------
// Supervisor Loop
// ---------------------------------------------------------------------------

export async function startSupervisorLoop(
  runId: string,
  initialHandle: string,
  goal: string,
  _apiKey?: string,
  _server?: { port: number; csrf: string },
  _wsUri?: string,
) {
  void _apiKey;
  void _server;
  void _wsUri;

  const MAX_REVIEWS = 10;
  const REVIEW_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
  const STUCK_CANCEL_THRESHOLD = 3; // consecutive STUCK rounds before suggesting cancel

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

    const workspacePath = run.workspace.replace(/^file:\/\//, '');
    const currentHandle = resolveRunSessionHandle(run) || initialHandle;
    const diagnosticsProvider = (run.sessionProvenance?.backendId || run.provider) as ProviderId | undefined;
    if (!currentHandle || !diagnosticsProvider) {
      continue;
    }

    try {
      const allSteps = (await readRecentSupervisorSteps(runId, currentHandle, diagnosticsProvider)).filter((step: unknown) => step != null);

      const recentSteps = allSteps.slice(-8).map(summarizeStepForSupervisor);
      const recentStepsText = recentSteps.join('\n') || 'No recent actions.';

      const currentStepCount = allSteps.length;
      const currentLastStepType = run.liveState?.lastStepType
        || (typeof (allSteps[allSteps.length - 1] as any)?.type === 'string'
          ? String((allSteps[allSteps.length - 1] as any).type).replace('CORTEX_STEP_TYPE_', '')
          : 'None');
      const staleTimeMs = run.liveState?.staleSince
        ? Date.now() - new Date(run.liveState.staleSince).getTime()
        : 0;
      const cascadeStatus = run.liveState?.cascadeStatus || 'unknown';

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
- Cascade Status: ${cascadeStatus}
- Total steps executed: ${currentStepCount}
- Last activity type: ${currentLastStepType}
- Time since last step: ${Math.round(staleTimeMs / 1000)}s

Comparison with previous review:
${comparisonText}

Recent Actions (last 8 steps):
${recentStepsText}

Is the agent making meaningful progress toward the goal, stuck, looping, or done?
Reply with ONLY a JSON object: {"status": "HEALTHY|STUCK|LOOPING|DONE", "analysis": "brief reason"}`;

      const decision = await runSupervisorAssessment({
        runId,
        workspacePath,
        handle: currentHandle,
        diagnosticsProvider,
        prompt: reviewPrompt,
      });
      if (!decision) {
        log.warn({ runId: runId.slice(0, 8), round: i }, 'Supervisor review: no response within timeout');
        continue;
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
