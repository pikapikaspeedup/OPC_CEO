/**
 * V2.5 Multi-Agent System — Group Runtime
 *
 * Core orchestrator: dispatch → child conversation → watch → compact → result.
 * V1.5: multi-role serial execution with review loop.
 * V2: envelope protocol, artifact manifest, advisory handoff.
 * V2.5: execution mode routing, source contract, work package, delivery finalization, scope audit.
 * V6: Multi-provider support (Antigravity gRPC + Codex MCP).
 * Directly calls bridge/gRPC layer (no HTTP roundtrip, no adapter abstraction).
 */

import {
  grpc,
} from '../bridge/gateway';
import { createRun, updateRun, getRun } from './run-registry';
import { checkTokenQuota, shouldAutoRequestQuota } from '../approval/token-quota';
import { submitApprovalRequest } from '../approval/handler';
import type {
  AgentRunState, TaskResult, GroupDefinition, GroupRoleDefinition,
  RoleProgress, ReviewDecision, ReviewOutcome,
  TaskEnvelope, ResultEnvelope, ArtifactManifest, ArtifactRef,
  GroupSourceContract, RunLiveState, SupervisorReview, SupervisorDecision, SupervisorSummary,
  RoleInputReadAudit, RoleReadEvidence, InputArtifactReadAuditEntry,
  SharedConversationState, TriggerContext,
} from './group-types';
import { TERMINAL_STATUSES } from './group-types';
import type { DevelopmentWorkPackage, DevelopmentDeliveryPacket, WriteScopeAudit } from './development-template-types';
import { ARTIFACT_ROOT_DIR } from './gateway-home';
import { createLogger } from '../logger';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ReviewEngine } from './review-engine';
import { AssetLoader } from './asset-loader';
import {
  applyProviderExecutionContext,
  buildTemplateProviderExecutionContext,
  resolveCapabilityAwareProvider,
} from './department-execution-resolver';
import {
  buildRolePrompt,
  buildRoleSwitchPrompt,
  buildDeliveryPrompt,
  formatPromptArtifactLines,
  extractReviewDecision,
  parseDecisionMarker,
  getCopiedArtifactPath,
} from './prompt-builder';
import { startSupervisorLoop, summarizeStepForSupervisor, SUPERVISOR_MODEL } from './supervisor';
import {
  copyUpstreamArtifacts,
  writeEnvelopeFile,
} from './run-artifacts';
import { readRunHistory } from './run-history';
import {
  isAuthoritativeConversation,
  cancelCascadeBestEffort,
  propagateTermination,
  getFailureReason,
  summarizeFailureText,
  getCanonicalTaskEnvelope,
  normalizeComparablePath,
  includesPathCandidate,
  extractStepReadEvidence,
  filterEvidenceByCandidates,
  dedupeStringList,
  buildRoleInputReadAudit,
  enforceCanonicalInputReadProtocol,
} from './runtime-helpers';
import { compactCodingResult } from './result-parser';
import { finalizeAdvisoryRun, finalizeDeliveryRun } from './finalization';
import { checkWriteScopeConflicts } from './scope-governor';
import { resolveProvider, type ProviderId } from '../providers';
import { canActivateStage, filterSourcesByContract, getDownstreamStages } from './pipeline/pipeline-registry';
import { getStageDefinition } from './stage-resolver';
import {
  applyAfterRunMemoryHooks,
  applyBeforeRunMemoryHooks,
  consumeAgentSession,
  createRunSessionHooks,
  ensureBuiltInAgentBackends,
  getBackendDiagnosticsExtension,
  getBackendRuntimeResolverExtension,
  getBackendSessionMetadataExtension,
  getAgentBackend,
  getAgentSession,
  markAgentSessionCancelRequested,
  registerAgentSession,
  removeAgentSession,
} from '../backends';
import type {
  AgentSession,
  BackendRunConfig,
  BackendSessionConsumerHooks,
  CancelledAgentEvent,
  CompletedAgentEvent,
  FailedAgentEvent,
} from '../backends';
import type { DepartmentRuntimeContract } from '../organization/contracts';
import { isExecutionProfile, type ExecutionProfile } from '../execution/contracts';
import {
  addRunToProject,
  getProject,
  trackStageDispatch,
  updatePipelineStage,
  updatePipelineStageByStageId,
} from './project-registry';

const log = createLogger('Runtime');

// ---------------------------------------------------------------------------
// V5.5: Shared Conversation Mode — feature flag
// ---------------------------------------------------------------------------

const SHARED_CONVERSATION_ENABLED = process.env.AG_SHARED_CONVERSATION === 'true';
/** When total estimated tokens in a shared conversation exceed this, fall back to isolated */
const SHARED_CONVERSATION_TOKEN_RESET = Number(process.env.AG_SHARED_CONVERSATION_TOKEN_RESET) || 100_000;

// ---------------------------------------------------------------------------
// Active run tracking (watchers + timers for cleanup on cancel/timeout)
// ---------------------------------------------------------------------------

interface ActiveRun {
  abortWatch: () => void;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

const activeRuns = new Map<string, ActiveRun>();

type RuntimeCarrier = {
  executionProfile?: ExecutionProfile;
  departmentRuntimeContract?: DepartmentRuntimeContract;
  runtimeContract?: DepartmentRuntimeContract;
};

function extractRuntimeCarrier(
  taskEnvelope?: TaskEnvelope,
): {
  executionProfile?: ExecutionProfile;
  runtimeContract?: DepartmentRuntimeContract;
} {
  const carrier = taskEnvelope as (TaskEnvelope & RuntimeCarrier) | undefined;
  return {
    executionProfile: isExecutionProfile(carrier?.executionProfile)
      ? carrier.executionProfile
      : undefined,
    runtimeContract: carrier?.departmentRuntimeContract ?? carrier?.runtimeContract,
  };
}

function joinResolutionReasons(...parts: Array<string | undefined>): string | undefined {
  const normalized = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  if (normalized.length === 0) {
    return undefined;
  }

  return normalized.join(' ');
}

function inferRequiredExecutionClassForGroup(
  executionMode: GroupDefinition['executionMode'],
  taskEnvelope?: TaskEnvelope,
): 'light' | 'artifact-heavy' | 'review-loop' | 'delivery' | undefined {
  const runtimeCarrier = extractRuntimeCarrier(taskEnvelope);
  if (runtimeCarrier.runtimeContract?.executionClass) {
    return runtimeCarrier.runtimeContract.executionClass;
  }

  if (executionMode === 'review-loop') {
    return 'review-loop';
  }

  if (executionMode === 'delivery-single-pass') {
    return 'delivery';
  }

  return undefined;
}

function bindRuntimeContractToArtifactRoot(
  contract: DepartmentRuntimeContract | undefined,
  artifactRoot: string,
): DepartmentRuntimeContract | undefined {
  if (!contract) {
    return undefined;
  }

  return {
    ...contract,
    artifactRoot,
  };
}

function resolveDepartmentExecutionProvider(options: {
  workspacePath: string;
  requestedProvider?: ProviderId;
  requestedModel?: string;
  explicitModel?: boolean;
  taskEnvelope?: TaskEnvelope;
  requiredExecutionClass?: 'light' | 'artifact-heavy' | 'review-loop' | 'delivery';
}): {
  provider: ProviderId;
  model?: string;
  routingReason: string;
  requestedProvider: ProviderId;
  requiredExecutionClass: 'light' | 'artifact-heavy' | 'review-loop' | 'delivery';
} {
  const preferredProvider = (options.requestedProvider || resolveProvider('execution', options.workspacePath).provider) as ProviderId;
  const runtimeCarrier = extractRuntimeCarrier(options.taskEnvelope);
  const routing = resolveCapabilityAwareProvider({
    workspacePath: options.workspacePath,
    requestedProvider: preferredProvider,
    requestedModel: options.requestedModel,
    explicitModel: options.explicitModel,
    runtimeContract: runtimeCarrier.runtimeContract,
    executionProfile: runtimeCarrier.executionProfile,
    requiredExecutionClass: options.requiredExecutionClass,
  });

  return {
    provider: routing.selectedProvider,
    model: routing.selectedModel,
    routingReason: routing.reason,
    requestedProvider: routing.requestedProvider,
    requiredExecutionClass: routing.requiredExecutionClass,
  };
}

function resolveNativeRuntimeForWorkspace(workspacePath: string, workspaceUri: string) {
  ensureBuiltInAgentBackends();
  const backend = getAgentBackend('antigravity');
  const runtimeResolver = getBackendRuntimeResolverExtension(backend);
  if (!runtimeResolver) {
    throw new Error('Provider \"antigravity\" does not expose runtime resolver support');
  }

  return runtimeResolver.resolveWorkspaceRuntime(workspacePath, workspaceUri);
}

/**
 * Resolve the best available session handle for a run.
 * Priority: sessionProvenance.handle → activeConversationId → childConversationId → role-level fallback.
 */
function resolveSessionHandle(run: AgentRunState, targetRoleId?: string): string | undefined {
  // 1. Provenance-first: most authoritative source
  if (run.sessionProvenance?.handle) {
    return run.sessionProvenance.handle;
  }
  // 2. Active conversation (set during execution)
  if (run.activeConversationId) {
    return run.activeConversationId;
  }
  // 3. Role-level fallback (for multi-role runs)
  if (targetRoleId && run.roles?.length) {
    const matchingRoles = run.roles.filter(r => r.roleId === targetRoleId && r.childConversationId);
    const latest = matchingRoles[matchingRoles.length - 1];
    if (latest?.childConversationId) return latest.childConversationId;
  }
  // 4. Run-level fallback
  return run.childConversationId || undefined;
}

interface RoleSessionExecutionOptions {
  runId: string;
  provider: ProviderId;
  group: GroupDefinition;
  role: GroupRoleDefinition;
  round: number;
  stageId: string;
  workspacePath: string;
  prompt: string;
  model: string;
  artifactDir: string;
  timeoutMs: number;
  parentConversationId?: string;
  projectId?: string;
  onSessionReady?(session: AgentSession): void | Promise<void>;
}

interface AttachedRoleSessionExecutionOptions extends RoleSessionExecutionOptions {
  existingHandle: string;
  promptSnapshot?: string;
  registerRoleProgress?: boolean;
}

interface ConsumedRoleSessionExecutionOptions extends RoleSessionExecutionOptions {
  promptSnapshot?: string;
  registerRoleProgress?: boolean;
  initialSessionAction?(session: AgentSession): Promise<void>;
}

interface RoleSessionExecutionResult {
  handle: string;
  providerId: ProviderId;
  steps: any[];
  result: TaskResult;
  terminalKind: 'completed' | 'failed' | 'cancelled' | 'timeout';
  liveState?: RunLiveState;
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

function findRoleProgressIndexByConversation(roles: RoleProgress[], conversationId: string): number {
  for (let index = roles.length - 1; index >= 0; index--) {
    if (roles[index]?.childConversationId === conversationId) {
      return index;
    }
  }

  return -1;
}

function updateRoleProgressByConversation(
  runId: string,
  conversationId: string,
  updates: Partial<RoleProgress>,
): void {
  const run = getRun(runId);
  const roles = [...(run?.roles || [])];
  const roleIndex = findRoleProgressIndexByConversation(roles, conversationId);
  if (roleIndex < 0) {
    return;
  }

  roles[roleIndex] = {
    ...roles[roleIndex],
    ...updates,
  };
  updateRun(runId, { roles });
}

function hasTerminalErrorSteps(steps: any[]): boolean {
  return steps.some((step) => {
    const stepType = step?.type;
    return typeof stepType === 'string'
      && (stepType.includes('ERROR') || stepType.includes('CANCELED'));
  });
}

function extractErrorDetailsFromSteps(steps: any[]): string | undefined {
  const errorMessages: string[] = [];
  for (let i = steps.length - 1; i >= 0 && errorMessages.length < 3; i--) {
    const step = steps[i];
    if (!step) continue;
    const stepType = step.type as string | undefined;
    if (!stepType) continue;
    if (stepType.includes('ERROR_MESSAGE') || stepType.includes('ERROR')) {
      const text = step.errorMessage?.message
        || step.content?.text
        || step.plannerResponse?.modifiedResponse
        || step.plannerResponse?.response;
      if (text && typeof text === 'string') {
        errorMessages.push(text.slice(0, 500));
      } else if (step.status && typeof step.status === 'string' && step.status.includes('ERROR')) {
        errorMessages.push(`Tool error at step ${i}: ${stepType} (${step.status})`);
      }
    }
  }
  return errorMessages.length > 0 ? errorMessages.join(' | ') : undefined;
}

function normalizeRoleSessionResult(
  providerId: ProviderId,
  event: CompletedAgentEvent,
  artifactAbsDir: string,
  role: GroupRoleDefinition,
): TaskResult {
  if (providerId !== 'antigravity') {
    return event.result;
  }

  const steps = (event.rawSteps || []) as any[];
  const result = compactCodingResult(steps, artifactAbsDir, role);
  if (hasTerminalErrorSteps(steps) && result.status !== 'completed') {
    result.status = 'failed';
    const errorDetail = extractErrorDetailsFromSteps(steps);
    if (errorDetail) {
      if (!result.summary || result.summary === 'Task completed (no summary extracted)') {
        result.summary = errorDetail;
      }
      if (result.blockers.length === 0) {
        result.blockers.push(errorDetail);
      }
    } else if (!result.summary || result.summary === 'Task completed (no summary extracted)') {
      result.summary = 'Child conversation ended with tool errors';
    }
  }

  return result;
}

async function buildRoleBackendConfig(options: RoleSessionExecutionOptions): Promise<BackendRunConfig> {
  const currentRun = getRun(options.runId);
  const runtimeCarrier = extractRuntimeCarrier(currentRun?.taskEnvelope);
  const runtimeContractForRun = bindRuntimeContractToArtifactRoot(
    runtimeCarrier.runtimeContract,
    path.join(options.workspacePath, options.artifactDir),
  );
  return applyBeforeRunMemoryHooks(options.provider, {
    runId: options.runId,
    workspacePath: options.workspacePath,
    prompt: options.prompt,
    model: options.model,
    artifactDir: options.artifactDir,
    parentConversationId: options.parentConversationId,
    executionTarget: {
      kind: 'template',
      templateId: options.group.templateId,
      stageId: options.stageId,
    },
    metadata: {
      projectId: options.projectId,
      stageId: options.stageId,
      roleId: options.role.id,
      executorKind: 'template',
      autoApprove: options.role.autoApprove,
    },
    timeoutMs: options.timeoutMs,
    ...(runtimeCarrier.executionProfile
      ? { executionProfile: runtimeCarrier.executionProfile }
      : {}),
    resolution: {
      ...(currentRun?.resolvedWorkflowRef ? { resolvedWorkflowRef: currentRun.resolvedWorkflowRef } : {}),
      ...(currentRun?.resolvedSkillRefs?.length ? { resolvedSkillRefs: currentRun.resolvedSkillRefs } : {}),
      ...(currentRun?.resolutionReason ? { resolutionReason: currentRun.resolutionReason } : {}),
      ...(currentRun?.provider ? { routedProvider: currentRun.provider } : {}),
      requiredExecutionClass: options.group.executionMode === 'review-loop'
        ? 'review-loop'
        : options.group.executionMode === 'delivery-single-pass'
          ? 'delivery'
          : runtimeCarrier.runtimeContract?.executionClass,
    },
    ...(runtimeContractForRun
      ? {
          runtimeContract: runtimeContractForRun,
          toolset: runtimeContractForRun.toolset,
          permissionMode: runtimeContractForRun.permissionMode,
          additionalWorkingDirectories: runtimeContractForRun.additionalWorkingDirectories,
          readRoots: runtimeContractForRun.readRoots,
          allowedWriteRoots: runtimeContractForRun.writeRoots,
          requiredArtifacts: runtimeContractForRun.requiredArtifacts,
        }
      : {}),
  } as BackendRunConfig);
}

async function consumeTrackedRoleAgentSession(
  options: ConsumedRoleSessionExecutionOptions,
  session: AgentSession,
): Promise<RoleSessionExecutionResult> {
  registerAgentSession(session);

  if (options.registerRoleProgress !== false) {
    const promptRecordedAt = new Date().toISOString();
    const currentRun = getRun(options.runId);
    const roles = [...(currentRun?.roles || [])];
    roles.push({
      roleId: options.role.id,
      round: options.round,
      childConversationId: session.handle,
      status: 'running',
      startedAt: promptRecordedAt,
      promptSnapshot: options.promptSnapshot || options.prompt,
      promptRecordedAt,
    });
    updateRun(options.runId, {
      roles,
      activeRoleId: options.role.id,
      ...(options.provider === 'antigravity'
        ? {
            childConversationId: session.handle,
            activeConversationId: session.handle,
          }
        : {}),
    });
  }

  await options.onSessionReady?.(session);

  if (options.initialSessionAction) {
    try {
      await options.initialSessionAction(session);
    } catch (error) {
      removeAgentSession(options.runId);
      throw error;
    }
  }

  let completedEvent: CompletedAgentEvent | null = null;
  let failedEvent: FailedAgentEvent | null = null;
  let cancelledEvent: CancelledAgentEvent | null = null;
  let timedOut = false;

  const sessionHooks: BackendSessionConsumerHooks = {
    onStarted: (event) => {
      const run = getRun(options.runId);
      if (!run || TERMINAL_STATUSES.has(run.status)) {
        return;
      }

      updateRun(options.runId, {
        status: 'running',
        activeRoleId: options.role.id,
        ...(options.provider === 'antigravity'
          ? {
              childConversationId: event.handle,
              activeConversationId: event.handle,
            }
          : {}),
      });

      if (options.registerRoleProgress !== false) {
        updateRoleProgressByConversation(options.runId, session.handle, {
          startedAt: event.startedAt,
          status: 'running',
        });
      }
    },
    onLiveState: (event) => {
      const run = getRun(options.runId);
      if (!run || TERMINAL_STATUSES.has(run.status)) {
        return;
      }
      updateRun(options.runId, { liveState: event.liveState });
    },
    onCompleted: (event) => {
      completedEvent = event;
      // V6.1: Persist tokenUsage immediately when available
      if (event.tokenUsage) {
        const run = getRun(options.runId);
        if (run && !TERMINAL_STATUSES.has(run.status)) {
          updateRun(options.runId, { tokenUsage: event.tokenUsage });
        }
      }
    },
    onFailed: (event) => {
      failedEvent = event;
      if (event.liveState) {
        const run = getRun(options.runId);
        if (run && !TERMINAL_STATUSES.has(run.status)) {
          updateRun(options.runId, { liveState: event.liveState });
        }
      }
    },
    onCancelled: (event) => {
      cancelledEvent = event;
    },
  };

  const timeoutTimer = options.timeoutMs > 0
    ? setTimeout(() => {
        const run = getRun(options.runId);
        if (!run || TERMINAL_STATUSES.has(run.status)) {
          return;
        }
        timedOut = true;
        markAgentSessionCancelRequested(options.runId);
        void session.cancel('timeout');
      }, options.timeoutMs)
    : undefined;

  await consumeAgentSession(options.runId, session, sessionHooks);

  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
  }

  if (timedOut) {
    return {
      handle: session.handle,
      providerId: session.providerId,
      steps: [],
      result: {
        status: 'timeout',
        summary: 'Run exceeded timeout limit',
        changedFiles: [],
        blockers: ['Run exceeded timeout limit'],
        needsReview: [],
      },
      terminalKind: 'timeout',
    };
  }

  // Build backendConfig for afterRun memory hooks (uses the same config as beforeRun)
  const backendConfig = await buildRoleBackendConfig(options);

  if (completedEvent) {
    const terminalEvent: CompletedAgentEvent = completedEvent;
    await applyAfterRunMemoryHooks(session.providerId, backendConfig, terminalEvent);
    return {
      handle: session.handle,
      providerId: session.providerId,
      steps: (terminalEvent.rawSteps || []) as any[],
      result: normalizeRoleSessionResult(
        session.providerId,
        terminalEvent,
        path.join(options.workspacePath, options.artifactDir),
        options.role,
      ),
      terminalKind: 'completed',
      tokenUsage: terminalEvent.tokenUsage,
    };
  }

  if (failedEvent) {
    const terminalEvent: FailedAgentEvent = failedEvent;
    await applyAfterRunMemoryHooks(session.providerId, backendConfig, terminalEvent);
    return {
      handle: session.handle,
      providerId: session.providerId,
      steps: (terminalEvent.rawSteps || []) as any[],
      result: {
        status: 'failed',
        summary: terminalEvent.error.message,
        changedFiles: [],
        blockers: [terminalEvent.error.message],
        needsReview: [],
      },
      terminalKind: 'failed',
      liveState: terminalEvent.liveState,
    };
  }

  if (cancelledEvent) {
    const terminalEvent: CancelledAgentEvent = cancelledEvent;
    await applyAfterRunMemoryHooks(session.providerId, backendConfig, terminalEvent);
    return {
      handle: session.handle,
      providerId: session.providerId,
      steps: [],
      result: {
        status: 'cancelled',
        summary: terminalEvent.reason || 'Run cancelled',
        changedFiles: [],
        blockers: terminalEvent.reason ? [terminalEvent.reason] : [],
        needsReview: [],
      },
      terminalKind: 'cancelled',
    };
  }

  throw new Error('Agent session ended without a terminal event');
}

async function executeRoleViaAgentSession(options: RoleSessionExecutionOptions): Promise<RoleSessionExecutionResult> {
  ensureBuiltInAgentBackends();

  const backend = getAgentBackend(options.provider);
  const backendConfig = await buildRoleBackendConfig(options);
  const session = await backend.start(backendConfig);
  return consumeTrackedRoleAgentSession({
    ...options,
    promptSnapshot: options.prompt,
    registerRoleProgress: true,
  }, session);
}

async function executeAttachedRoleViaAgentSession(
  options: AttachedRoleSessionExecutionOptions,
): Promise<RoleSessionExecutionResult> {
  ensureBuiltInAgentBackends();

  const backend = getAgentBackend(options.provider);
  if (!backend.attach) {
    throw new Error(`Provider '${options.provider}' does not support attaching to an existing session`);
  }

  const backendConfig = await buildRoleBackendConfig(options);
  const session = await backend.attach(backendConfig, options.existingHandle);
  return consumeTrackedRoleAgentSession({
    ...options,
    promptSnapshot: options.promptSnapshot || options.prompt,
    registerRoleProgress: options.registerRoleProgress ?? true,
    initialSessionAction: async (activeSession) => {
      await activeSession.append({
        prompt: options.prompt,
        model: options.model,
        workspacePath: options.workspacePath,
      });
    },
  }, session);
}

function extractLatestPlannerResponseText(steps: any[], minIndex = 0): string {
  for (let index = steps.length - 1; index >= minIndex; index--) {
    const step = steps[index];
    if (step?.type !== 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
      continue;
    }

    const planner = step.plannerResponse || step.response || {};
    const text = planner.modifiedResponse || planner.response || '';
    if (text) {
      return text;
    }
  }

  return '';
}

function registerSessionTimeout(
  runId: string,
  timeoutMs: number | undefined,
  onTimeout: () => void,
): void {
  if (!timeoutMs || timeoutMs <= 0) {
    return;
  }

  const active = activeRuns.get(runId);
  if (active?.timeoutTimer) {
    clearTimeout(active.timeoutTimer);
  }

  const timeoutTimer = setTimeout(onTimeout, timeoutMs);
  activeRuns.set(runId, {
    abortWatch: active?.abortWatch || (() => undefined),
    timeoutTimer,
  });
}

async function attachExistingRunSession(
  runId: string,
  run: AgentRunState,
  handle: string,
): Promise<AgentSession | null> {
  const workspacePath = run.workspace.replace(/^file:\/\//, '');
  const runtimeCarrier = extractRuntimeCarrier(run.taskEnvelope);
  const runtimeContractForRun = bindRuntimeContractToArtifactRoot(
    runtimeCarrier.runtimeContract,
    path.join(workspacePath, run.artifactDir || ''),
  );
  // Phase 4: use provenance backendId when available, fallback to route resolution
  const provider = (run.sessionProvenance?.backendId
    || run.provider
    || resolveDepartmentExecutionProvider({
      workspacePath,
      taskEnvelope: run.taskEnvelope,
    }).provider) as ProviderId;

  ensureBuiltInAgentBackends();
  const backend = getAgentBackend(provider);
  if (!backend.attach) {
    return null;
  }

  const backendConfig = await applyBeforeRunMemoryHooks(provider, {
    runId,
    workspacePath,
    prompt: run.prompt || run.taskEnvelope?.goal || 'Continue existing run',
    model: run.model,
    artifactDir: run.artifactDir,
    parentConversationId: run.parentConversationId,
    metadata: {
      projectId: run.projectId,
      stageId: run.pipelineStageId || run.stageId,
      roleId: run.activeRoleId || run.roles?.[run.roles.length - 1]?.roleId,
      executorKind: run.executorKind,
    },
    ...(runtimeCarrier.executionProfile
      ? { executionProfile: runtimeCarrier.executionProfile }
      : {}),
    ...(runtimeContractForRun
      ? {
          runtimeContract: runtimeContractForRun,
          toolset: runtimeContractForRun.toolset,
          permissionMode: runtimeContractForRun.permissionMode,
          additionalWorkingDirectories: runtimeContractForRun.additionalWorkingDirectories,
          readRoots: runtimeContractForRun.readRoots,
          allowedWriteRoots: runtimeContractForRun.writeRoots,
          requiredArtifacts: runtimeContractForRun.requiredArtifacts,
        }
      : {}),
  } as BackendRunConfig);

  return backend.attach(backendConfig, handle);
}

// isAuthoritativeConversation, cancelCascadeBestEffort — moved to runtime-helpers.ts

// ---------------------------------------------------------------------------
// DispatchRunInput — V2 unified input type
// ---------------------------------------------------------------------------

export interface DispatchRunInput {
  stageId: string;
  workspace: string;
  prompt?: string;
  model?: string;
  parentConversationId?: string;
  taskEnvelope?: TaskEnvelope;
  sourceRunIds?: string[];
  projectId?: string;
  pipelineId?: string;
  templateId?: string;
  pipelineStageId?: string;
  pipelineStageIndex?: number;
  /** V5.5: Override conversation mode for this run. 'shared' = reuse cascade, 'isolated' = default */
  conversationMode?: 'shared' | 'isolated';
  /** V6.1: Explicit provider override (bypasses resolveProvider). */
  provider?: string;
  promptPreamble?: string;
  resolvedWorkflowRef?: string;
  resolvedSkillRefs?: string[];
  resolutionReason?: string;
  triggerContext?: TriggerContext;
}

// ---------------------------------------------------------------------------
// V2.5: Source Contract Resolution
// ---------------------------------------------------------------------------

interface ResolvedSourceContext {
  sourceRuns: AgentRunState[];
  inputArtifacts: ArtifactRef[];
}

function resolveSourceContext(
  group: GroupDefinition,
  input: DispatchRunInput,
  workspacePath: string,
): ResolvedSourceContext {
  const contract = group.sourceContract;
  if (!contract) {
    return { sourceRuns: [], inputArtifacts: input.taskEnvelope?.inputArtifacts || [] };
  }

  if (!input.sourceRunIds || input.sourceRunIds.length === 0) {
    throw new Error(`Group ${group.id} requires sourceRunIds per its source contract`);
  }

  const requiredOutcomes = contract.requireReviewOutcome || ['approved'];
  const resolvedRuns: AgentRunState[] = [];
  const upstreamRunIds = new Set<string>();

  // Validate direct source runs against contract
  for (const srcRunId of input.sourceRunIds) {
    const srcRun = getRun(srcRunId);
    if (!srcRun) throw new Error(`Source run ${srcRunId} not found`);

    const sourceStageId = srcRun.pipelineStageId || srcRun.stageId;
    if (!sourceStageId || !contract.acceptedSourceStageIds.includes(sourceStageId)) {
      throw new Error(`Source run ${srcRunId} has stageId '${sourceStageId || 'unknown'}', but stage '${group.id}' only accepts: ${contract.acceptedSourceStageIds.join(', ')}`);
    }

    if (!srcRun.reviewOutcome || !requiredOutcomes.includes(srcRun.reviewOutcome)) {
      throw new Error(`Source run ${srcRunId} reviewOutcome is '${srcRun.reviewOutcome || 'none'}', required: ${requiredOutcomes.join(', ')}`);
    }

    const srcWs = srcRun.workspace.replace(/^file:\/\//, '');
    if (srcWs !== workspacePath) {
      throw new Error(`Source run ${srcRunId} belongs to workspace ${srcWs}, but target is ${workspacePath}`);
    }

    resolvedRuns.push(srcRun);

    // Collect upstream transitive sourceRunIds
    if (contract.autoIncludeUpstreamSourceRuns && srcRun.sourceRunIds) {
      for (const upId of srcRun.sourceRunIds) upstreamRunIds.add(upId);
    }
  }

  // Add transitive upstream runs (e.g., product-spec via architecture-advisory)
  for (const upId of upstreamRunIds) {
    if (input.sourceRunIds.includes(upId)) continue; // already direct
    const upRun = getRun(upId);
    if (upRun) resolvedRuns.push(upRun);
  }

  // Auto-build inputArtifacts from all resolved source runs
  let inputArtifacts = input.taskEnvelope?.inputArtifacts || [];
  if (contract.autoBuildInputArtifactsFromSources && inputArtifacts.length === 0) {
    const built: ArtifactRef[] = [];
    for (const run of resolvedRuns) {
      if (run.resultEnvelope?.outputArtifacts) {
        built.push(...run.resultEnvelope.outputArtifacts);
      }
    }
    inputArtifacts = built;
  }

  // For non-autoBuild contracts, validate caller-provided inputArtifacts
  if (!contract.autoBuildInputArtifactsFromSources) {
    if (inputArtifacts.length === 0) {
      throw new Error(`Group ${group.id} requires inputArtifacts — source contract does not auto-build`);
    }
    const sourceRunIdSet = new Set(input.sourceRunIds);
    for (const art of inputArtifacts) {
      if (!art.sourceRunId) {
        throw new Error(`Input artifact "${art.path}" has no sourceRunId — provenance required`);
      }
      if (!sourceRunIdSet.has(art.sourceRunId)) {
        throw new Error(`Input artifact "${art.path}" references source run ${art.sourceRunId} which is not in sourceRunIds`);
      }
      const srcRun = getRun(art.sourceRunId);
      if (srcRun?.artifactDir) {
        const artAbsPath = path.join(workspacePath, srcRun.artifactDir, art.path);
        if (!fs.existsSync(artAbsPath)) {
          throw new Error(`Input artifact "${art.path}" does not exist at ${artAbsPath}`);
        }
      }
    }
  }

  return { sourceRuns: resolvedRuns, inputArtifacts };
}

// ---------------------------------------------------------------------------
// V2.5: Work Package Builder
// ---------------------------------------------------------------------------

function buildDevelopmentWorkPackage(
  runId: string,
  goal: string,
  sourceArchitectureRun: AgentRunState,
  sourceProductRuns: AgentRunState[],
  inputArtifacts: ArtifactRef[],
  workspacePath: string,
  artifactAbsDir: string,
): DevelopmentWorkPackage {
  const taskId = `wp_${runId.slice(0, 8)}`;

  // Try to read write-scope-plan.json from architecture source
  let allowedWriteScope: DevelopmentWorkPackage['allowedWriteScope'] = [];
  if (sourceArchitectureRun.artifactDir) {
    const scopePath = path.join(workspacePath, sourceArchitectureRun.artifactDir, 'architecture', 'write-scope-plan.json');
    try {
      if (fs.existsSync(scopePath)) {
        const raw = JSON.parse(fs.readFileSync(scopePath, 'utf-8'));
        if (Array.isArray(raw)) {
          allowedWriteScope = raw.map((entry: any) => ({
            path: String(entry.path || entry.file || ''),
            operation: (['create', 'modify', 'delete'].includes(entry.operation) ? entry.operation : 'modify') as 'create' | 'modify' | 'delete',
          })).filter((e: any) => e.path);
        } else if (raw.files || raw.scope) {
          const arr = raw.files || raw.scope || [];
          allowedWriteScope = (Array.isArray(arr) ? arr : []).map((entry: any) => ({
            path: String(typeof entry === 'string' ? entry : entry.path || entry.file || ''),
            operation: 'modify' as const,
          })).filter((e: any) => e.path);
        }
      }
    } catch {
      log.warn({ runId: runId.slice(0, 8) }, 'Failed to parse write-scope-plan.json, defaulting to empty scope');
    }
  }

  const workPackage: DevelopmentWorkPackage = {
    templateId: 'development-template-1',
    taskId,
    goal,
    sourceArchitectureRunId: sourceArchitectureRun.runId,
    sourceProductRunIds: sourceProductRuns.map(r => r.runId),
    requestedDeliverables: [
      'delivery/implementation-summary.md',
      'delivery/test-results.md',
      'delivery/delivery-packet.json',
    ],
    successCriteria: [
      'All requested changes implemented',
      'Type checking passes (npx tsc --noEmit)',
      'delivery-packet.json written with status and summary',
    ],
    referencedArtifacts: inputArtifacts,
    allowedWriteScope,
  };

  // Write work-package.json
  const wpDir = path.join(artifactAbsDir, 'work-package');
  if (!fs.existsSync(wpDir)) fs.mkdirSync(wpDir, { recursive: true });
  fs.writeFileSync(path.join(wpDir, 'work-package.json'), JSON.stringify(workPackage, null, 2), 'utf-8');
  log.info({ runId: runId.slice(0, 8), taskId }, 'Work package written');

  return workPackage;
}

// ---------------------------------------------------------------------------
// dispatchRun
// ---------------------------------------------------------------------------

export async function dispatchRun(input: DispatchRunInput): Promise<{ runId: string }> {
  const resolvedStageId = input.pipelineStageId || input.stageId;
  const templateId = input.templateId || input.pipelineId;
  if (!resolvedStageId || !templateId) {
    throw new Error('dispatchRun requires templateId and stageId');
  }

  // 1. Validate stage
  const group = getStageDefinition(templateId, resolvedStageId);
  if (!group) {
    throw new Error(`Unknown stage: ${templateId}/${resolvedStageId}`);
  }
  if (group.executionMode === 'orchestration') {
    const err: any = new Error(`Stage '${resolvedStageId}' is an orchestration node and cannot be dispatched directly`);
    err.statusCode = 400;
    throw err;
  }

  // 2. Validate input: must have either prompt or taskEnvelope
  const goal = input.taskEnvelope?.goal || input.prompt;
  if (!goal) {
    throw new Error('Either prompt or taskEnvelope.goal is required');
  }

  // 3. V2.5: Source contract validation (replaces hardcoded product-spec check)
  const workspacePath = input.workspace.replace(/^file:\/\//, '');

  if (!input.promptPreamble || !input.resolutionReason) {
    try {
      const templateContext = buildTemplateProviderExecutionContext(workspacePath, templateId);
      input.promptPreamble ??= templateContext.promptPreamble;
      input.resolutionReason ??= templateContext.resolutionReason;
    } catch (err) {
      throw err;
    }
  }

  let resolvedSource: ResolvedSourceContext = { sourceRuns: [], inputArtifacts: [] };

  if (group.sourceContract) {
    resolvedSource = resolveSourceContext(group, input, workspacePath);
  } else if (group.capabilities?.requiresInputArtifacts) {
    // Legacy V2 path: caller must provide inputArtifacts directly
    const inputArtifacts = input.taskEnvelope?.inputArtifacts;
    if (!inputArtifacts || inputArtifacts.length === 0) {
      throw new Error(`Stage ${resolvedStageId} requires inputArtifacts from an approved source run`);
    }
    if (!input.sourceRunIds || input.sourceRunIds.length === 0) {
      throw new Error(`Stage ${resolvedStageId} requires sourceRunIds`);
    }
    resolvedSource = { sourceRuns: [], inputArtifacts };
  }

  // 4. Check token quota before dispatching
  const quotaCheck = checkTokenQuota(workspacePath);
  if (!quotaCheck.allowed) {
    // Auto-generate approval request for quota increase
    try {
      await submitApprovalRequest({
        type: 'token_increase' as const,
        workspace: workspacePath,
        title: `Token 配额超限: ${resolvedStageId}`,
        description: `部门 ${workspacePath} 的 Token 配额已用尽，无法执行新任务。`,
        urgency: 'high' as const,
      });
    } catch { /* non-fatal */ }
    throw new Error(`Token quota exceeded for workspace ${workspacePath}. An approval request has been submitted.`);
  }
  if (shouldAutoRequestQuota(workspacePath)) {
    try {
      await submitApprovalRequest({
        type: 'token_increase' as const,
        workspace: workspacePath,
        title: `Token 配额预警: ${resolvedStageId}`,
        description: `部门 ${workspacePath} 的 Token 使用量即将达到上限（剩余 ${quotaCheck.remaining}），建议增加配额。`,
        urgency: 'normal' as const,
      });
    } catch { /* non-fatal */ }
  }

  // 5. Build or synthesize TaskEnvelope
  let envelope = input.taskEnvelope;
  if (!envelope) {
    // Synthesize default envelope for legacy prompt path
    envelope = {
      templateId: group.templateId,
      goal: input.prompt!,
    };
  }

  const templateRuntimeContext = buildTemplateProviderExecutionContext(workspacePath, templateId);
  const templateRuntimeCarrier = extractRuntimeCarrier(envelope);
  if (!templateRuntimeCarrier.executionProfile && templateRuntimeContext.executionProfile) {
    envelope = {
      ...envelope,
      executionProfile: templateRuntimeContext.executionProfile,
    };
  }
  if (!templateRuntimeCarrier.runtimeContract && templateRuntimeContext.runtimeContract) {
    envelope = {
      ...envelope,
      departmentRuntimeContract: templateRuntimeContext.runtimeContract,
    };
  }

  envelope = {
    ...envelope,
    goal: envelope.goal || input.prompt!,
  };

  // V2.5: Populate resolved inputArtifacts into envelope if auto-built
  if (resolvedSource.inputArtifacts.length > 0 && (!envelope.inputArtifacts || envelope.inputArtifacts.length === 0)) {
    envelope = { ...envelope, inputArtifacts: resolvedSource.inputArtifacts };
  }

  const providerRouting = resolveDepartmentExecutionProvider({
    workspacePath,
    requestedProvider: input.provider as ProviderId | undefined,
    requestedModel: input.model || group.defaultModel,
    explicitModel: Boolean(input.model),
    taskEnvelope: envelope as TaskEnvelope,
    requiredExecutionClass: inferRequiredExecutionClassForGroup(
      group.executionMode,
      envelope as TaskEnvelope,
    ),
  });
  const provider = providerRouting.provider;
  const finalModel = input.model || providerRouting.model || group.defaultModel || 'MODEL_PLACEHOLDER_M26';
  input.resolutionReason = joinResolutionReasons(input.resolutionReason, providerRouting.routingReason);

  let server: { port: number; csrf: string; workspace?: string } | undefined;
  let apiKey: string | undefined;

  if (provider === 'antigravity') {
    // Antigravity requires a running language server
    const nativeRuntime = await resolveNativeRuntimeForWorkspace(workspacePath, input.workspace);
    server = nativeRuntime;
    apiKey = nativeRuntime.apiKey;
  } else {
    log.info({ workspace: workspacePath, provider }, 'Using non-language-server provider for Department execution');
    server = { port: 0, csrf: '' };
    apiKey = '';
  }

  // V2.5: Merge all resolved source run IDs
  const allSourceRunIds = [
    ...(input.sourceRunIds || []),
    ...resolvedSource.sourceRuns
      .filter(r => !input.sourceRunIds?.includes(r.runId))
      .map(r => r.runId),
  ];

  // 6. Create run record
  const run = createRun({
    stageId: resolvedStageId,
    workspace: input.workspace,
    prompt: goal,
    model: finalModel,
    parentConversationId: input.parentConversationId,
    templateId: group.templateId,
    taskEnvelope: envelope,
    sourceRunIds: allSourceRunIds.length > 0 ? allSourceRunIds : input.sourceRunIds,
    projectId: input.projectId,
    pipelineId: input.pipelineId,
    pipelineStageId: input.pipelineStageId,
    pipelineStageIndex: input.pipelineStageIndex,
    executorKind: 'template',
    executionTarget: {
      kind: 'template',
      templateId: group.templateId,
      stageId: resolvedStageId,
    },
    triggerContext: input.triggerContext,
    provider,
    resolvedWorkflowRef: input.resolvedWorkflowRef,
    resolvedSkillRefs: input.resolvedSkillRefs,
    resolutionReason: input.resolutionReason,
  });

  const runId = run.runId;
  const shortRunId = runId.slice(0, 8);

  try {
    const wsUri = input.workspace.startsWith('file://') ? input.workspace : `file://${input.workspace}`;

    // V2.5: Route by executionMode
    if (group.executionMode === 'legacy-single') {
      // V3.5 Fix: Run-scoped artifact paths for legacy-single too
      const artifactDir = run.projectId
        ? `${ARTIFACT_ROOT_DIR}/projects/${run.projectId}/runs/${runId}/`
        : `${ARTIFACT_ROOT_DIR}/runs/${runId}/`;
      const artifactAbsDir = path.join(workspacePath, artifactDir);
      if (!fs.existsSync(artifactAbsDir)) {
        fs.mkdirSync(artifactAbsDir, { recursive: true });
      }
      updateRun(runId, {
        artifactDir,
        status: 'starting',
        activeRoleId: group.roles[0].id,
      });

      const workflowContent = AssetLoader.resolveWorkflowContent(group.roles[0].workflow);
      const composedPrompt = applyProviderExecutionContext(
        `${workflowContent}\n\n${goal}`,
        input.promptPreamble
          ? {
              promptPreamble: input.promptPreamble,
              resolutionReason: input.resolutionReason || '',
              resolvedWorkflowRef: input.resolvedWorkflowRef,
              resolvedSkillRefs: input.resolvedSkillRefs,
            }
          : undefined,
      );
      ensureBuiltInAgentBackends();
      const runtimeCarrier = extractRuntimeCarrier(envelope);
      const runtimeContractForRun = bindRuntimeContractToArtifactRoot(
        runtimeCarrier.runtimeContract,
        artifactAbsDir,
      );

      const backend = getAgentBackend(provider);
      const backendConfig = await applyBeforeRunMemoryHooks(provider, {
        runId,
        workspacePath,
        prompt: composedPrompt,
        model: finalModel,
        artifactDir,
        parentConversationId: input.parentConversationId,
        executionTarget: {
          kind: 'template',
          templateId: group.templateId,
          stageId: resolvedStageId,
        },
        triggerContext: input.triggerContext,
        metadata: {
          projectId: input.projectId,
          stageId: resolvedStageId,
          roleId: group.roles[0].id,
          executorKind: 'template',
          autoApprove: group.roles[0].autoApprove,
        },
        timeoutMs: group.roles[0].timeoutMs,
        ...(runtimeCarrier.executionProfile
          ? { executionProfile: runtimeCarrier.executionProfile }
          : {}),
        resolution: {
          ...(input.resolvedWorkflowRef ? { resolvedWorkflowRef: input.resolvedWorkflowRef } : {}),
          ...(input.resolvedSkillRefs?.length ? { resolvedSkillRefs: input.resolvedSkillRefs } : {}),
          ...(input.resolutionReason ? { resolutionReason: input.resolutionReason } : {}),
          requestedProvider: providerRouting.requestedProvider,
          routedProvider: provider,
          providerRoutingReason: providerRouting.routingReason,
          requiredExecutionClass: providerRouting.requiredExecutionClass,
        },
        ...(runtimeContractForRun
          ? {
              runtimeContract: runtimeContractForRun,
              toolset: runtimeContractForRun.toolset,
              permissionMode: runtimeContractForRun.permissionMode,
              additionalWorkingDirectories: runtimeContractForRun.additionalWorkingDirectories,
              readRoots: runtimeContractForRun.readRoots,
              allowedWriteRoots: runtimeContractForRun.writeRoots,
              requiredArtifacts: runtimeContractForRun.requiredArtifacts,
            }
          : {}),
      } as BackendRunConfig);
      const session = await backend.start(backendConfig);

      registerAgentSession(session);
      registerSessionTimeout(runId, group.roles[0].timeoutMs, () => {
        const currentRun = getRun(runId);
        if (!currentRun || TERMINAL_STATUSES.has(currentRun.status)) {
          cleanup(runId);
          return;
        }

        updateRun(runId, {
          status: 'timeout',
          lastError: 'Run exceeded timeout limit',
        });

        const activeSession = getAgentSession(runId);
        if (activeSession) {
          markAgentSessionCancelRequested(runId);
          void activeSession.session.cancel('timeout').finally(() => {
            cleanup(runId);
          });
          return;
        }

        cleanup(runId);
      });

      void consumeAgentSession(runId, session, createRunSessionHooks({
        runId,
        activeRoleId: group.roles[0].id,
        backendConfig,
        bindConversationHandleForProviders: ['antigravity'],
        onCompleted: (event) => {
          finalizeLegacySingleRun(runId, event.result);
          cleanup(runId);
        },
        onFailed: (event) => {
          const currentRun = getRun(runId);
          if (currentRun && !TERMINAL_STATUSES.has(currentRun.status)) {
            updateRun(runId, {
              status: 'failed',
              lastError: event.error.message,
              ...(event.liveState ? { liveState: event.liveState } : {}),
            });
          }
          cleanup(runId);
        },
        onCancelled: () => {
          const currentRun = getRun(runId);
          if (currentRun && !TERMINAL_STATUSES.has(currentRun.status)) {
            updateRun(runId, { status: 'cancelled' });
          }
          cleanup(runId);
        },
      }));

      log.info({ runId: shortRunId, provider }, 'Single-role run dispatched through AgentBackend');
    } else {
      // ── Envelope path: review-loop or delivery-single-pass (V1.5+/V2.5) ──
      log.info({ runId: shortRunId, mode: group.executionMode, roleCount: group.roles.length }, 'Starting envelope run');
      executeSerialEnvelopeRun(runId, group, server, apiKey, input, finalModel, resolvedSource).catch((err: any) => {
        log.error({ runId: shortRunId, err: err.message }, 'Envelope run failed');
        updateRun(runId, { status: 'failed', lastError: err.message });
      });
    }

    return { runId };
  } catch (err: any) {
    log.error({ runId: shortRunId, err: err.message }, 'Dispatch failed');
    updateRun(runId, { status: 'failed', lastError: err.message });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// V3.5: Run Intervention — same-run continuation for stale or failed roles
// ---------------------------------------------------------------------------

export type InterventionAction = 'nudge' | 'retry' | 'restart_role' | 'evaluate';

// V3.5 Fix 6: Atomic intervention lock — prevents concurrent interventions on the same run
const activeInterventions = new Set<string>();

export class InterventionConflictError extends Error {
  constructor(runId: string) {
    super(`Run ${runId} already has an active intervention in progress`);
    this.name = 'InterventionConflictError';
  }
}

export async function interveneRun(
  runId: string,
  action: InterventionAction,
  prompt?: string,
  roleId?: string,
): Promise<{ status: string; action: InterventionAction; cascadeId?: string }> {
  // V3.5 Fix 6: Atomic admission — no TOCTOU gap in single-threaded Node.js
  if (activeInterventions.has(runId)) {
    throw new InterventionConflictError(runId);
  }
  activeInterventions.add(runId);

  try {
    const run = getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const effectiveAction: InterventionAction = action === 'retry' ? 'restart_role' : action;
    const isTerminal = run.status === 'failed' || run.status === 'blocked' || run.status === 'timeout' || run.status === 'cancelled';
    const isStaleActive = (run.status === 'starting' || run.status === 'running') && !!run.liveState?.staleSince;
    // V3.5: evaluate is allowed on any status — it's a read-only diagnostic
    if (effectiveAction === 'evaluate') {
      // no status gate — allow on any state
    } else if (effectiveAction === 'nudge') {
      if (!isStaleActive) {
        throw new Error(`Cannot nudge run ${runId}: status '${run.status}' is not stale-active`);
      }
    } else if (!isTerminal && !isStaleActive) {
      throw new Error(`Cannot ${effectiveAction} run ${runId}: status '${run.status}' is not actionable`);
    }

    const currentStageId = run.pipelineStageId || run.stageId;
    const templateId = run.templateId || run.pipelineId;
    const group = currentStageId && templateId ? getStageDefinition(templateId, currentStageId) : null;
    if (!group) throw new Error(`Unknown stage: ${templateId || 'unknown'}/${currentStageId || 'unknown'}`);

    const shortRunId = runId.slice(0, 8);
    const workspacePath = run.workspace.replace(/^file:\/\//, '');

    // Find the last failed/completed role
    const roles = run.roles || [];
    const targetRoleId = roleId || roles[roles.length - 1]?.roleId;
    if (!targetRoleId) throw new Error('No role found to intervene on');

    const roleDef = group.roles.find(r => r.id === targetRoleId);
    if (!roleDef) throw new Error(`Role ${targetRoleId} not found in group ${group.id}`);

    const isReviewer = group.roles.indexOf(roleDef) > 0 && group.executionMode === 'review-loop';
    const wsUri = run.workspace.startsWith('file://') ? run.workspace : `file://${run.workspace}`;
    const artifactDir = run.artifactDir || (run.projectId ? `${ARTIFACT_ROOT_DIR}/projects/${run.projectId}/runs/${runId}/` : `${ARTIFACT_ROOT_DIR}/runs/${runId}/`);
    const artifactAbsDir = path.join(workspacePath, artifactDir);

    log.info({ runId: shortRunId, action, targetRoleId, isReviewer }, 'Intervening on run');

    if (effectiveAction === 'nudge') {
      // ── NUDGE: send a follow-up message to the existing child conversation ──
      // V6: provenance-first handle resolution
      const matchingRoles = roles.filter(r => r.roleId === targetRoleId && r.childConversationId);
      const latestRole = matchingRoles[matchingRoles.length - 1];
      const cascadeId = resolveSessionHandle(run, targetRoleId);
      if (!cascadeId) throw new Error('No child conversation found to nudge');

      updateRun(runId, {
        status: run.status === 'starting' ? 'starting' : 'running',
        lastError: undefined,
        activeConversationId: cascadeId,
        activeRoleId: targetRoleId,
      });

      const nudgePrompt = prompt || (isReviewer
        ? 'You forgot to output a DECISION marker at the end of your review. Please review your analysis above and output exactly one of: DECISION: APPROVED, DECISION: REVISE, or DECISION: REJECTED. Output it now as the last line of your response.'
        : 'Your previous output was incomplete. Please complete your task and write result.json as specified in your workflow instructions.');

      const activeSession = getAgentSession(runId);
      if (activeSession && activeSession.handle === cascadeId) {
        if (activeSession.session.capabilities.supportsAppend) {
          log.info({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8), promptLength: nudgePrompt.length }, 'Sending nudge via AgentSession.append');
          await activeSession.session.append({
            prompt: nudgePrompt,
            model: run.model,
            workspacePath,
          });
          return { status: 'running', action, cascadeId };
        }

        if (activeSession.providerId !== 'antigravity') {
          throw new Error(`Cannot nudge run ${runId}: provider '${activeSession.providerId}' does not support append`);
        }
      }

      log.info({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8), promptLength: nudgePrompt.length }, 'Sending nudge via attached AgentSession');

      const provider = (run.provider
        || resolveDepartmentExecutionProvider({
          workspacePath,
          requestedModel: run.model,
          explicitModel: Boolean(run.model),
          taskEnvelope: run.taskEnvelope,
          requiredExecutionClass: inferRequiredExecutionClassForGroup(
            group.executionMode,
            run.taskEnvelope,
          ),
        }).provider) as ProviderId;
      const roleExecution = await executeAttachedRoleViaAgentSession({
        runId,
        provider,
        group,
        role: roleDef,
        round: latestRole?.round || run.currentRound || 1,
        stageId: run.pipelineStageId || run.stageId || group.id,
        workspacePath,
        prompt: nudgePrompt,
        model: run.model || 'MODEL_PLACEHOLDER_M26',
        artifactDir,
        timeoutMs: roleDef.timeoutMs,
        parentConversationId: run.parentConversationId,
        projectId: run.projectId,
        existingHandle: cascadeId,
        registerRoleProgress: false,
      });

      const steps = roleExecution.steps;
      const result = roleExecution.result;

      // Update role progress — find by cascadeId, not blindly last
      const nudgeTaskEnvelope = getCanonicalTaskEnvelope(runId, run.taskEnvelope);
      const nudgeAudit = buildRoleInputReadAudit(runId, artifactDir, nudgeTaskEnvelope, steps);
      const nudgeResult = enforceCanonicalInputReadProtocol(targetRoleId, result, nudgeAudit);
      const rolesAfter = getRun(runId)?.roles || [];
      const matchIdx = rolesAfter.findIndex(r => r.childConversationId === cascadeId);
      const targetIdx = matchIdx >= 0 ? matchIdx : rolesAfter.length - 1;
      if (targetIdx >= 0) {
        rolesAfter[targetIdx] = {
          ...rolesAfter[targetIdx],
          status: nudgeResult.status,
          finishedAt: new Date().toISOString(),
          result: nudgeResult,
          inputReadAudit: nudgeAudit,
        };
        updateRun(runId, { roles: rolesAfter });
      }

      // Process result
      await processInterventionResult(runId, run, group, roleDef, isReviewer, nudgeResult, steps, artifactAbsDir);

      return { status: 'completed', action, cascadeId };

    } else if (effectiveAction === 'evaluate') {
      // ── EVALUATE: on-demand AI supervisor assessment — read-only, no state change ──
      const goal = run.taskEnvelope?.goal || run.prompt;
      // V6: provenance-first handle resolution
      const cascadeId = resolveSessionHandle(run);
      const diagnosticsProvider = (getAgentSession(runId)?.providerId
        || run.sessionProvenance?.backendId
        || run.provider
        || resolveProvider('execution', workspacePath).provider) as ProviderId;

      // Fetch recent steps from the last known conversation
      let recentStepsText = 'No conversation data available.';
      if (cascadeId) {
        ensureBuiltInAgentBackends();
        const diagnosticsBackend = getAgentBackend(diagnosticsProvider);
        const diagnostics = getBackendDiagnosticsExtension(diagnosticsBackend);

        try {
          if (diagnostics) {
            const recentSteps = await diagnostics.getRecentSteps(cascadeId, { limit: 12 });
            const summarizedSteps = recentSteps.map(summarizeStepForSupervisor);
            recentStepsText = summarizedSteps.join('\n') || 'No recent actions.';
          }
        } catch {
          recentStepsText = 'Failed to fetch conversation steps.';
        }
      }

      if (recentStepsText === 'No conversation data available.' || recentStepsText === 'Failed to fetch conversation steps.') {
        const fallbackSteps = readRunHistory(runId)
          .filter((entry) => entry.eventType === 'conversation.message.user' || entry.eventType === 'conversation.message.assistant')
          .slice(-12)
          .map((entry) => entry.eventType === 'conversation.message.user'
            ? { type: 'CORTEX_STEP_TYPE_USER_INPUT' }
            : {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                plannerResponse: {
                  response: typeof entry.details.content === 'string' ? entry.details.content : '',
                },
              },
          );
        if (fallbackSteps.length > 0) {
          recentStepsText = fallbackSteps.map(summarizeStepForSupervisor).join('\n');
        }
      }

      // Build diagnostic prompt
      const evalPrompt = `[On-Demand Diagnostic Assessment]
Task Goal: ${goal}

Current Run State:
- Status: ${run.status}
- Active Role: ${run.activeRoleId || 'unknown'}
- Last Error: ${run.lastError || 'none'}
- Total Roles Executed: ${(run.roles || []).length}

Recent Actions (last 12 steps):
${recentStepsText}

Please analyze this run and provide:
1. What the agent was trying to do
2. What went wrong (if failed)
3. Whether a retry/restart is likely to succeed
4. Recommended action

      Reply with ONLY a JSON object: {"status": "HEALTHY|STUCK|LOOPING|DONE", "analysis": "detailed diagnosis"}`;

      ensureBuiltInAgentBackends();
      const evalSessionRunId = `eval-${runId}-${randomUUID()}`;
      const configuredSupervisorProvider = resolveProvider('supervisor', workspacePath).provider as ProviderId;
      const evalProvider = configuredSupervisorProvider === 'antigravity' && diagnosticsProvider !== 'antigravity'
        ? diagnosticsProvider
        : configuredSupervisorProvider;
      const evalBackend = getAgentBackend(evalProvider);
      const evalConfig = await applyBeforeRunMemoryHooks(evalProvider, {
        runId: evalSessionRunId,
        workspacePath,
        prompt: evalPrompt,
        model: SUPERVISOR_MODEL,
        parentConversationId: cascadeId,
        executionTarget: { kind: 'prompt' },
        metadata: {
          projectId: run.projectId,
          stageId: run.pipelineStageId || run.stageId || group.id,
          roleId: 'supervisor-evaluate',
          executorKind: 'prompt',
        },
        timeoutMs: 90_000,
      });

      const evalSession = await evalBackend.start(evalConfig);
      registerAgentSession(evalSession);

      let evalCompleted: CompletedAgentEvent | null = null;
      let evalFailed: FailedAgentEvent | null = null;
      let evalCancelled: CancelledAgentEvent | null = null;

      await consumeAgentSession(evalSessionRunId, evalSession, {
        onStarted: async (event) => {
          updateRun(runId, { supervisorConversationId: event.handle });

          const metadataWriter = getBackendSessionMetadataExtension(evalBackend);
          if (!metadataWriter) {
            return;
          }

          await metadataWriter.annotateSession(event.handle, {
            'antigravity.task.type': 'supervisor-evaluate',
            'antigravity.task.runId': runId,
            'antigravity.task.hidden': 'false',
          });
        },
        onCompleted: (event) => {
          evalCompleted = event;
        },
        onFailed: (event) => {
          evalFailed = event;
        },
        onCancelled: (event) => {
          evalCancelled = event;
        },
      });

      const completedEvaluationRawSteps = (evalCompleted as any)?.rawSteps as any[] | undefined;
      const responseText = extractLatestPlannerResponseText((completedEvaluationRawSteps || []) as any[]);
      const failedEvaluationEvent = evalFailed as FailedAgentEvent | null;
      const cancelledEvaluationEvent = evalCancelled as CancelledAgentEvent | null;

      // Parse decision
      let decision: SupervisorDecision;
      if (failedEvaluationEvent) {
        decision = { status: 'STUCK', analysis: failedEvaluationEvent.error.message };
      } else if (cancelledEvaluationEvent) {
        decision = { status: 'STUCK', analysis: cancelledEvaluationEvent.reason || 'Supervisor evaluation cancelled.' };
      } else if (!responseText) {
        decision = { status: 'STUCK', analysis: 'Supervisor evaluation timed out — no response received.' };
      } else {
        try {
          const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
          decision = jsonMatch ? JSON.parse(jsonMatch[0]) : { status: 'STUCK', analysis: responseText.slice(0, 500) };
          if (!['HEALTHY', 'STUCK', 'LOOPING', 'DONE'].includes(decision.status)) {
            decision.status = 'STUCK';
          }
        } catch {
          decision = { status: 'STUCK', analysis: `(Parse failed) ${responseText.slice(0, 500)}` };
        }
      }

      // Write review result — does NOT change run status
      const review: SupervisorReview = {
        id: `eval-${Date.now()}`,
        timestamp: new Date().toISOString(),
        round: -1, // negative round = on-demand evaluation
        stepCount: (run.roles || []).length,
        decision,
      };
      const currentRun = getRun(runId);
      if (currentRun) {
        const reviews = [...(currentRun.supervisorReviews || []), review];
        updateRun(runId, { supervisorReviews: reviews });
      }

      log.info({ runId: shortRunId, decision: decision.status }, 'On-demand supervisor evaluation completed');
      return { status: 'evaluated', action };

    } else {
      // ── RESTART ROLE: create a fresh child conversation for this role ──
      const goal = run.taskEnvelope?.goal || run.prompt;
      const round = run.currentRound || 1;
      // V6: provenance-first handle resolution
      const previousCascadeId = resolveSessionHandle(run);
      const nativeRuntime = await resolveNativeRuntimeForWorkspace(workspacePath, run.workspace);
      const { apiKey, ...server } = nativeRuntime;

      const retryTaskEnvelope = getCanonicalTaskEnvelope(runId, run.taskEnvelope);
      const retryPrompt = applyProviderExecutionContext(
        prompt || buildRetryPrompt(roleDef, goal, artifactDir, round, isReviewer, retryTaskEnvelope),
        run.resolutionReason || run.resolvedWorkflowRef || (run.resolvedSkillRefs?.length ?? 0) > 0
          ? {
              promptPreamble: '',
              resolutionReason: run.resolutionReason || '',
              resolvedWorkflowRef: run.resolvedWorkflowRef,
              resolvedSkillRefs: run.resolvedSkillRefs,
            }
          : undefined,
      );

      updateRun(runId, {
        status: 'running',
        lastError: undefined,
        activeRoleId: targetRoleId,
      });
      const provider = (run.provider
        || resolveDepartmentExecutionProvider({
          workspacePath,
          requestedModel: run.model,
          explicitModel: Boolean(run.model),
          taskEnvelope: run.taskEnvelope,
          requiredExecutionClass: inferRequiredExecutionClassForGroup(
            group.executionMode,
            run.taskEnvelope,
          ),
        }).provider) as ProviderId;
      const roleExecution = await executeRoleViaAgentSession({
        runId,
        provider,
        group,
        role: roleDef,
        round,
        stageId: run.pipelineStageId || run.stageId || group.id,
        workspacePath,
        prompt: retryPrompt,
        model: run.model || 'MODEL_PLACEHOLDER_M26',
        artifactDir,
        timeoutMs: roleDef.timeoutMs,
        parentConversationId: run.parentConversationId,
        projectId: run.projectId,
        onSessionReady: async () => {
          await cancelCascadeBestEffort(previousCascadeId, { port: server.port, csrf: server.csrf }, apiKey, shortRunId);
        },
      });

      const cascadeId = roleExecution.handle;

      log.info({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8), roleId: targetRoleId }, 'Restart-role dispatched through AgentSession');

      // Update role progress
      const restartAudit = buildRoleInputReadAudit(runId, artifactDir, retryTaskEnvelope, roleExecution.steps);
      const restartResult = enforceCanonicalInputReadProtocol(targetRoleId, roleExecution.result, restartAudit);
      updateRoleProgressByConversation(runId, cascadeId, {
        status: restartResult.status,
        finishedAt: new Date().toISOString(),
        result: restartResult,
        inputReadAudit: restartAudit,
      });

      // Process result
      await processInterventionResult(runId, run, group, roleDef, isReviewer, restartResult, roleExecution.steps, artifactAbsDir);

      return { status: 'completed', action, cascadeId };
    }

  } finally {
    activeInterventions.delete(runId);
  }
}

/**
 * After an intervention completes, process the result the same way
 * the original review-loop or delivery path would.
 */
export async function processInterventionResult(
  runId: string,
  originalRun: AgentRunState,
  group: GroupDefinition,
  roleDef: GroupRoleDefinition,
  isReviewer: boolean,
  result: TaskResult,
  steps: any[],
  artifactAbsDir: string,
): Promise<void> {
  const shortRunId = runId.slice(0, 8);

  if (result.status !== 'completed') {
    const terminalStatus: AgentRunState['status'] = result.status === 'blocked'
      ? 'blocked'
      : result.status === 'cancelled'
        ? 'cancelled'
        : result.status === 'timeout'
          ? 'timeout'
          : 'failed';
    log.warn({ runId: shortRunId, roleId: roleDef.id, status: result.status }, 'Intervention did not complete successfully');
    updateRun(runId, {
      status: terminalStatus,
      result,
      lastError: getFailureReason(result) || `Intervention failed: role ${roleDef.id} status=${result.status}`,
    });
    return;
  }

  if (isReviewer) {
    // V3.5 Fix 4: Use fresh run state, not stale originalRun snapshot
    const freshRun = getRun(runId);
    let decision: string = extractReviewDecision(artifactAbsDir, freshRun?.currentRound || 1, steps, result);

    // Policy engine override
    const policy = group.reviewPolicyId ? AssetLoader.getReviewPolicy(group.reviewPolicyId) : undefined;
    if (policy && freshRun) {
      const engineDecision = ReviewEngine.evaluate(freshRun, policy);
      if (engineDecision === 'revise-exhausted' || engineDecision === 'rejected') {
        decision = engineDecision as any;
      }
    }

    log.info({ runId: shortRunId, decision }, 'Intervention review decision extracted');

    if (decision === 'approved') {
      updateRun(runId, { status: 'completed', result, reviewOutcome: 'approved' });
      finalizeAdvisoryRun(runId, group, artifactAbsDir, 'approved', result);
      // Pipeline auto-trigger
      const input: DispatchRunInput = {
        stageId: group.id,
        workspace: originalRun.workspace,
        projectId: originalRun.projectId,
        pipelineId: originalRun.pipelineId,
        templateId: originalRun.templateId,
        pipelineStageId: originalRun.pipelineStageId,
        pipelineStageIndex: originalRun.pipelineStageIndex,
      };
      void tryAutoTriggerNextStage(runId, originalRun.pipelineStageId || group.id, input);
    } else if (decision === 'rejected') {
      updateRun(runId, { status: 'blocked', result, reviewOutcome: 'rejected', lastError: 'Reviewer rejected the spec' });
      finalizeAdvisoryRun(runId, group, artifactAbsDir, 'rejected', result);
    } else if (decision === 'revise-exhausted') {
      updateRun(runId, { status: 'blocked', reviewOutcome: 'revise-exhausted', lastError: 'Exceeded max review rounds per policy' });
      finalizeAdvisoryRun(runId, group, artifactAbsDir, 'revise-exhausted', undefined);
    } else {
      // 'revise' — resume the review loop from the next round
      // V3.5 Fix 4: Use fresh run state for currentRound
      const currentRound = freshRun?.currentRound || 1;
      const nextRound = currentRound + 1;
      log.info({ runId: shortRunId, nextRound }, 'Intervention: reviewer requested revision, resuming review loop');
      updateRun(runId, { currentRound: nextRound });

      // Re-enter the review loop from the next round
      const workspacePath = originalRun.workspace.replace(/^file:\/\//, '');
      const wsUri = originalRun.workspace.startsWith('file://') ? originalRun.workspace : `file://${originalRun.workspace}`;
      let nativeRuntime;
      try {
        nativeRuntime = await resolveNativeRuntimeForWorkspace(workspacePath, originalRun.workspace);
      } catch (err: any) {
        updateRun(runId, { status: 'failed', lastError: `Cannot resume review loop: ${err.message}` });
        return;
      }
      const { apiKey, ...server } = nativeRuntime;

      const input: DispatchRunInput = {
        stageId: group.id,
        workspace: originalRun.workspace,
        prompt: originalRun.prompt,
        projectId: originalRun.projectId,
        pipelineId: originalRun.pipelineId,
        templateId: originalRun.templateId,
        pipelineStageId: originalRun.pipelineStageId,
        pipelineStageIndex: originalRun.pipelineStageIndex,
        taskEnvelope: originalRun.taskEnvelope,
      };

      // Fire-and-forget: resume the review loop asynchronously
      executeReviewLoop(
        runId, group, server, apiKey, wsUri,
        originalRun.taskEnvelope?.goal || originalRun.prompt,
        originalRun.model || 'MODEL_PLACEHOLDER_M26',
        input, artifactAbsDir.replace(workspacePath + '/', ''), artifactAbsDir,
      ).catch((err: any) => {
        log.error({ runId: shortRunId, err: err.message }, 'Resumed review loop failed');
        updateRun(runId, { status: 'failed', lastError: err.message });
      });
    }
  } else if (group.executionMode === 'review-loop') {
    // V3.5 Fix 2: Author recovered in a review-loop — resume from the NEXT role (reviewer)
    // instead of marking the whole run as completed and skipping the reviewer
    const freshRun = getRun(runId);
    const currentRound = freshRun?.currentRound || 1;
    const authorIndex = group.roles.findIndex(r => r.id === roleDef.id);
    const nextRoleIndex = authorIndex + 1;

    log.info({ runId: shortRunId, currentRound, authorIndex, nextRoleIndex }, 'Author recovered, resuming review round from next role');

    const workspacePath = originalRun.workspace.replace(/^file:\/\//, '');
    const wsUri = originalRun.workspace.startsWith('file://') ? originalRun.workspace : `file://${originalRun.workspace}`;
    let nativeRuntime;
    try {
      nativeRuntime = await resolveNativeRuntimeForWorkspace(workspacePath, originalRun.workspace);
    } catch (err: any) {
      updateRun(runId, { status: 'failed', lastError: `Cannot resume review round: ${err.message}` });
      return;
    }
    const { apiKey, ...server } = nativeRuntime;

    const input: DispatchRunInput = {
      stageId: group.id,
      workspace: originalRun.workspace,
      prompt: originalRun.prompt,
      projectId: originalRun.projectId,
      pipelineId: originalRun.pipelineId,
      templateId: originalRun.templateId,
      pipelineStageId: originalRun.pipelineStageId,
      pipelineStageIndex: originalRun.pipelineStageIndex,
      taskEnvelope: originalRun.taskEnvelope,
    };
    const artifactDirRel = artifactAbsDir.replace(workspacePath + '/', '');

    // Fire-and-forget: run the current round from the reviewer role
    executeReviewRound(
      runId, group, server, apiKey, wsUri,
      originalRun.taskEnvelope?.goal || originalRun.prompt,
      originalRun.model || 'MODEL_PLACEHOLDER_M26',
      input, artifactDirRel, artifactAbsDir, currentRound, nextRoleIndex,
    ).then(async (roundResult) => {
      if (roundResult.decision === 'revise') {
        const nextRound = currentRound + 1;
        updateRun(runId, { currentRound: nextRound });
        await executeReviewLoop(
          runId, group, server, apiKey, wsUri,
          originalRun.taskEnvelope?.goal || originalRun.prompt,
          originalRun.model || 'MODEL_PLACEHOLDER_M26',
          input, artifactDirRel, artifactAbsDir,
        );
      }
    }).catch((err: any) => {
      log.error({ runId: shortRunId, err: err.message }, 'Author recovery review round failed');
      updateRun(runId, { status: 'failed', lastError: err.message });
    });
  } else if (group.executionMode === 'delivery-single-pass') {
    // Delivery finalization
    finalizeDeliveryRun(runId, group, artifactAbsDir, result, undefined);
    const input: DispatchRunInput = {
      stageId: group.id,
      workspace: originalRun.workspace,
      projectId: originalRun.projectId,
      pipelineId: originalRun.pipelineId,
      templateId: originalRun.templateId,
      pipelineStageId: originalRun.pipelineStageId,
      pipelineStageIndex: originalRun.pipelineStageIndex,
    };
    void tryAutoTriggerNextStage(runId, originalRun.pipelineStageId || group.id, input);
  } else {
    // Non-review-loop, non-delivery author completed — mark success
    updateRun(runId, { status: 'completed', result });
  }
}

/**
 * Build a retry prompt for a role that is being re-executed.
 */
function buildRetryPrompt(
  role: GroupRoleDefinition,
  goal: string,
  artifactDir: string,
  round: number,
  isReviewer: boolean,
  taskEnvelope?: TaskEnvelope,
): string {
  const taskEnvelopePath = `${artifactDir}task-envelope.json`;
  const inputArtifactLines = formatPromptArtifactLines(artifactDir, taskEnvelope?.inputArtifacts || []);

  if (isReviewer) {
    return [
      AssetLoader.resolveWorkflowContent(role.workflow),
      '',
      'Retry context',
      '- This review role is being re-executed because the previous attempt failed to produce a valid output.',
      `- Task envelope: ${taskEnvelopePath}`,
      `- Review round: ${round}`,
      '',
      'Canonical upstream inputs',
      ...inputArtifactLines,
      '',
      'Critical instructions',
      '- Read the task envelope first, then the canonical upstream inputs listed above.',
      '- Review the author output files carefully before deciding.',
      '- You MUST end your review with exactly one of: DECISION: APPROVED, DECISION: REVISE, DECISION: REJECTED.',
      '',
      'Original goal',
      goal,
    ].join('\n');
  }

  return [
    AssetLoader.resolveWorkflowContent(role.workflow),
    '',
    'Retry context',
    '- This role is being re-executed because the previous attempt failed.',
    `- Task envelope: ${taskEnvelopePath}`,
    '',
    'Canonical upstream inputs',
    ...inputArtifactLines,
    '',
    'Critical instructions',
    '- Read the task envelope first, then the canonical upstream inputs listed above.',
    '- Complete the task as specified in your workflow instructions.',
    '',
    'Original goal',
    goal,
  ].join('\n');
}

// startSupervisorLoop, summarizeStepForSupervisor — moved to supervisor.ts

// ---------------------------------------------------------------------------
// executeSerialEnvelopeRun — unified envelope run for review-loop & delivery-single-pass
// V2: advisory review loop. V2.5: also delivery single-pass.
// ---------------------------------------------------------------------------

async function executeSerialEnvelopeRun(
  runId: string,
  group: GroupDefinition,
  server: { port: number; csrf: string; workspace?: string },
  apiKey: string,
  input: DispatchRunInput,
  finalModel: string,
  resolvedSource: ResolvedSourceContext = { sourceRuns: [], inputArtifacts: [] },
): Promise<void> {
  const shortRunId = runId.slice(0, 8);
  const goal = input.taskEnvelope?.goal || input.prompt || '';
  const wsUri = input.workspace.startsWith('file://') ? input.workspace : `file://${input.workspace}`;
  const workspacePath = input.workspace.replace(/^file:\/\//, '');
  // V3.5 Fix: Run-scoped artifact paths to prevent cross-run contamination
  const run = getRun(runId);
  const artifactDir = run?.projectId
    ? `${ARTIFACT_ROOT_DIR}/projects/${run.projectId}/runs/${runId}/`
    : `${ARTIFACT_ROOT_DIR}/runs/${runId}/`;
  const artifactAbsDir = path.join(workspacePath, artifactDir);

  updateRun(runId, {
    status: 'running',
    startedAt: new Date().toISOString(),
    artifactDir,
    currentRound: 1,
    roles: [],
  });

  const effectiveTaskEnvelope = getCanonicalTaskEnvelope(runId, input.taskEnvelope);
  const effectiveInput: DispatchRunInput = effectiveTaskEnvelope
    ? { ...input, taskEnvelope: effectiveTaskEnvelope }
    : input;

  // Shared: Write task-envelope.json + copy upstream artifacts
  if (group.capabilities?.emitsManifest) {
    writeEnvelopeFile(artifactAbsDir, 'task-envelope.json', getRun(runId)?.taskEnvelope);
  }
  if (group.capabilities?.requiresInputArtifacts) {
    const artsToCopy = resolvedSource.inputArtifacts.length > 0
      ? resolvedSource.inputArtifacts
      : (effectiveInput.taskEnvelope?.inputArtifacts || []);
    if (artsToCopy.length > 0) {
      copyUpstreamArtifacts(workspacePath, artifactAbsDir, artsToCopy, runId);
    }
  }

  // V2.5: Build work package for delivery groups
  let workPackage: DevelopmentWorkPackage | undefined;
  if (group.executionMode === 'delivery-single-pass' && group.capabilities?.delivery) {
    const archRuns = resolvedSource.sourceRuns.filter(r => (r.pipelineStageId || r.stageId) === 'architecture-advisory');
    const prodRuns = resolvedSource.sourceRuns.filter(r => (r.pipelineStageId || r.stageId) === 'product-spec');
    const archRun = archRuns[0];
    if (archRun) {
      workPackage = buildDevelopmentWorkPackage(
        runId, goal, archRun, prodRuns, resolvedSource.inputArtifacts, workspacePath, artifactAbsDir,
      );
      // Update task envelope with V2.5 active fields
      const run = getRun(runId);
      if (run?.taskEnvelope) {
        const updatedEnvelope: TaskEnvelope = {
          ...run.taskEnvelope,
          taskId: workPackage.taskId,
          requestedDeliverables: workPackage.requestedDeliverables,
          successCriteria: workPackage.successCriteria,
          governance: { reviewRequired: true },
        };
        updateRun(runId, { taskEnvelope: updatedEnvelope });
        writeEnvelopeFile(artifactAbsDir, 'task-envelope.json', updatedEnvelope);
      }
    }
  }

  try {
    if (group.executionMode === 'delivery-single-pass') {
      // ── Delivery single-pass: one role, then finalize ──────────────────
      await executeDeliverySinglePass(runId, group, server, apiKey, wsUri, goal, finalModel, effectiveInput, artifactDir, artifactAbsDir, workPackage);
    } else {
      // ── Review-loop: multi-round author/reviewer cycle ─────────────────
      await executeReviewLoop(runId, group, server, apiKey, wsUri, goal, finalModel, effectiveInput, artifactDir, artifactAbsDir);
    }
  } catch (err: any) {
    const errMsg = err.message || '';
    if (errMsg === 'timeout') {
      log.warn({ runId: shortRunId }, 'Envelope run timed out');
      propagateTermination(runId, 'timeout');
    } else if (errMsg === 'superseded') {
      log.info({ runId: shortRunId }, 'Envelope branch was superseded by a newer conversation');
    } else if (errMsg === 'cancelled') {
      log.info({ runId: shortRunId }, 'Envelope run was cancelled');
      propagateTermination(runId, 'cancelled');
    } else {
      log.error({ runId: shortRunId, err: errMsg }, 'Envelope execution failed');
      updateRun(runId, { status: 'failed', lastError: errMsg });
    }
  }
}

// ---------------------------------------------------------------------------
// executeDeliverySinglePass — V2.5 delivery exit strategy
// ---------------------------------------------------------------------------

async function executeDeliverySinglePass(
  runId: string,
  group: GroupDefinition,
  server: { port: number; csrf: string },
  apiKey: string,
  wsUri: string,
  goal: string,
  finalModel: string,
  input: DispatchRunInput,
  artifactDir: string,
  artifactAbsDir: string,
  workPackage?: DevelopmentWorkPackage,
): Promise<void> {
  const shortRunId = runId.slice(0, 8);
  const role = group.roles[0];
  const taskEnvelope = getCanonicalTaskEnvelope(runId, input.taskEnvelope);
  const workspacePath = wsUri.replace(/^file:\/\//, '');
  const provider = (getRun(runId)?.provider
    || resolveDepartmentExecutionProvider({
      workspacePath,
      requestedModel: finalModel,
      explicitModel: false,
      taskEnvelope,
      requiredExecutionClass: 'delivery',
    }).provider) as ProviderId;

  // Build delivery-specific prompt
  const prompt = applyProviderExecutionContext(
    buildDeliveryPrompt(role, goal, artifactDir, artifactAbsDir, taskEnvelope),
    input.promptPreamble
      ? {
          promptPreamble: input.promptPreamble,
          resolutionReason: input.resolutionReason || '',
          resolvedWorkflowRef: input.resolvedWorkflowRef,
          resolvedSkillRefs: input.resolvedSkillRefs,
        }
      : undefined,
  );

  const roleExecution = await executeRoleViaAgentSession({
    runId,
    provider,
    group,
    role,
    round: 1,
    stageId: input.pipelineStageId || input.stageId || group.id,
    workspacePath,
    prompt,
    model: finalModel,
    artifactDir,
    timeoutMs: role.timeoutMs,
    parentConversationId: input.parentConversationId,
    projectId: input.projectId,
    onSessionReady: (session) => {
      if (provider === 'antigravity') {
        void startSupervisorLoop(runId, session.handle, goal, apiKey, server, wsUri);
      }
    },
  });

  if (provider === 'antigravity' && !isAuthoritativeConversation(getRun(runId), roleExecution.handle)) {
    log.info({ runId: shortRunId, cascadeId: roleExecution.handle.slice(0, 8) }, 'Skipping delivery writeback for superseded branch');
    return;
  }

  if (roleExecution.terminalKind !== 'completed') {
    const terminationStatus: 'failed' | 'blocked' | 'cancelled' | 'timeout' =
      roleExecution.result.status === 'completed' ? 'failed' : roleExecution.result.status;
    updateRoleProgressByConversation(runId, roleExecution.handle, {
      status: roleExecution.result.status,
      finishedAt: new Date().toISOString(),
      result: roleExecution.result,
    });
    log.warn({ runId: shortRunId, roleId: role.id, terminalKind: roleExecution.terminalKind, status: roleExecution.result.status }, 'Delivery role ended before successful completion');
    propagateTermination(runId, terminationStatus, getFailureReason(roleExecution.result));
    return;
  }

  // Update role progress
  const audit = buildRoleInputReadAudit(runId, artifactDir, taskEnvelope, roleExecution.steps);
  const finalizedResult = enforceCanonicalInputReadProtocol(role.id, roleExecution.result, audit);
  updateRoleProgressByConversation(runId, roleExecution.handle, {
    status: finalizedResult.status,
    finishedAt: new Date().toISOString(),
    result: finalizedResult,
    inputReadAudit: audit,
  });

  // Gate: child must complete successfully before finalization
  if (finalizedResult.status !== 'completed') {
    const terminationStatus: 'failed' | 'blocked' | 'cancelled' | 'timeout' = finalizedResult.status;
    log.warn({ runId: shortRunId, roleId: role.id, status: finalizedResult.status }, 'Delivery child did not complete, stopping');
    propagateTermination(runId, terminationStatus, getFailureReason(finalizedResult));
    return;
  }

  // Finalize delivery (hard contract — missing packet = blocked)
  finalizeDeliveryRun(runId, group, artifactAbsDir, finalizedResult, workPackage);

  // Pipeline auto-trigger: dispatch next stage if this run belongs to a pipeline
  const runAfterFinalize = getRun(runId);
  if (runAfterFinalize?.status === 'completed' && runAfterFinalize.pipelineId) {
    void tryAutoTriggerNextStage(runId, input.pipelineStageId || group.id, input);
  }
}

// ---------------------------------------------------------------------------
// executeReviewLoop — extracted from old executeMultiRoleRun (V1.5/V2)
// ---------------------------------------------------------------------------

async function executeReviewLoop(
  runId: string,
  group: GroupDefinition,
  server: { port: number; csrf: string },
  apiKey: string,
  wsUri: string,
  goal: string,
  finalModel: string,
  input: DispatchRunInput,
  artifactDir: string,
  artifactAbsDir: string,
): Promise<void> {
  // V3.5 Bugfix: When resuming a loop via Intervention, respect the next round counter
  const initialRunState = getRun(runId);
  let round = initialRunState?.currentRound || 1;

  // V5.5: Carry shared conversation state across rounds when feature flag or per-run override enabled
  const useSharedConversation = input.conversationMode === 'shared' || (input.conversationMode !== 'isolated' && SHARED_CONVERSATION_ENABLED);
  let sharedState: SharedConversationState | undefined = useSharedConversation
    ? { estimatedTokens: 0 }
    : undefined;

  while (true) {
    updateRun(runId, { currentRound: round });
    const roundResult = await executeReviewRound(
      runId, group, server, apiKey, wsUri, goal, finalModel,
      input, artifactDir, artifactAbsDir, round, 0, sharedState,
    );

    if (roundResult.decision !== 'revise') return; // approved, rejected, revise-exhausted, or failed — loop ends
    sharedState = roundResult.sharedState;
    round++;
  }
}

// ---------------------------------------------------------------------------
// executeReviewRound — run one round of roles starting from startRoleIndex
// Returns the review decision or 'failed' if the round couldn't complete.
// ---------------------------------------------------------------------------

interface ReviewRoundOutput {
  decision: 'approved' | 'rejected' | 'revise' | 'revise-exhausted' | 'failed';
  sharedState?: SharedConversationState;
}

async function executeReviewRound(
  runId: string,
  group: GroupDefinition,
  server: { port: number; csrf: string },
  apiKey: string,
  wsUri: string,
  goal: string,
  finalModel: string,
  input: DispatchRunInput,
  artifactDir: string,
  artifactAbsDir: string,
  round: number,
  startRoleIndex: number,
  sharedState?: SharedConversationState,
): Promise<ReviewRoundOutput> {
  const shortRunId = runId.slice(0, 8);
  const policy = group.reviewPolicyId ? AssetLoader.getReviewPolicy(group.reviewPolicyId) : null;
  const taskEnvelope = getCanonicalTaskEnvelope(runId, input.taskEnvelope);

  // V5.5: Token safety-valve — if shared conversation exceeds threshold, drop back to isolated
  if (sharedState && sharedState.estimatedTokens > SHARED_CONVERSATION_TOKEN_RESET) {
    log.info({ runId: shortRunId, tokens: sharedState.estimatedTokens, threshold: SHARED_CONVERSATION_TOKEN_RESET }, 'Shared conversation token threshold exceeded, falling back to isolated mode');
    sharedState = undefined;
  }

  log.info({ runId: shortRunId, round, roleCount: group.roles.length, startRoleIndex, sharedConversation: !!sharedState }, 'Starting review round');

  for (let i = startRoleIndex; i < group.roles.length; i++) {
    const role = group.roles[i];
    const isReviewer = i === group.roles.length - 1 && group.reviewPolicyId !== undefined;

    const currentRun = getRun(runId);
    if (!currentRun || currentRun.status === 'cancelled') {
      log.info({ runId: shortRunId }, 'Run cancelled externally, stopping');
      return { decision: 'failed', sharedState };
    }

    log.info({ runId: shortRunId, roleId: role.id, round, isReviewer }, 'Dispatching role');

    const rolePrompt = applyProviderExecutionContext(
      buildRolePrompt(role, goal, artifactDir, artifactAbsDir, round, isReviewer, taskEnvelope?.inputArtifacts || []),
      input.promptPreamble
        ? {
            promptPreamble: input.promptPreamble,
            resolutionReason: input.resolutionReason || '',
            resolvedWorkflowRef: input.resolvedWorkflowRef,
            resolvedSkillRefs: input.resolvedSkillRefs,
          }
        : undefined,
    );

    // V6: Resolve provider for this workspace
    const workspacePath = wsUri.replace(/^file:\/\//, '');
    const provider = (currentRun.provider
      || resolveDepartmentExecutionProvider({
        workspacePath,
        requestedModel: finalModel,
        explicitModel: false,
        taskEnvelope,
        requiredExecutionClass: 'review-loop',
      }).provider) as ProviderId;

    // V5.5: Decide whether to reuse an existing cascade or create a new one
    const canReuse = sharedState?.authorCascadeId && !isReviewer && round > 1 && provider === 'antigravity';
    let cascadeId: string;
    let steps: any[] = [];
    let result: TaskResult;
    let terminalKind: RoleSessionExecutionResult['terminalKind'] = 'completed';

    if (canReuse) {
      // ── Shared mode: send role-switch prompt to existing cascade ──
      cascadeId = sharedState!.authorCascadeId!;
      const switchPrompt = buildRoleSwitchPrompt(role, round, artifactDir, artifactAbsDir, goal, taskEnvelope?.inputArtifacts || []);

      log.info({ runId: shortRunId, roleId: role.id, round, cascadeId: cascadeId.slice(0, 8), mode: 'shared' }, 'Reusing existing cascade for role');

      // Estimate tokens: switch prompt + overhead for model response
      sharedState = { ...sharedState!, estimatedTokens: sharedState!.estimatedTokens + switchPrompt.length / 4 + 2000 };

      const roleExecution = await executeAttachedRoleViaAgentSession({
        runId,
        provider,
        group,
        role,
        round,
        stageId: input.pipelineStageId || input.stageId || group.id,
        workspacePath,
        prompt: switchPrompt,
        promptSnapshot: `[shared-conversation] ${rolePrompt.slice(0, 200)}...`,
        model: finalModel,
        artifactDir,
        timeoutMs: role.timeoutMs,
        parentConversationId: input.parentConversationId,
        projectId: input.projectId,
        existingHandle: cascadeId,
      });

      steps = roleExecution.steps;
      result = roleExecution.result;
      terminalKind = roleExecution.terminalKind;
    } else {
      const roleExecution = await executeRoleViaAgentSession({
        runId,
        provider,
        group,
        role,
        round,
        stageId: input.pipelineStageId || input.stageId || group.id,
        workspacePath,
        prompt: rolePrompt,
        model: finalModel,
        artifactDir,
        timeoutMs: role.timeoutMs,
        parentConversationId: input.parentConversationId,
        projectId: input.projectId,
        onSessionReady: (session) => {
          if (round === 1 && i === 0 && provider === 'antigravity') {
            void startSupervisorLoop(runId, session.handle, goal, apiKey, server, wsUri);
          }
        },
      });

      cascadeId = roleExecution.handle;
      terminalKind = roleExecution.terminalKind;
      steps = roleExecution.steps;
      result = roleExecution.result;

      if (sharedState && !isReviewer && provider === 'antigravity') {
        sharedState = {
          ...sharedState,
          authorCascadeId: cascadeId,
          estimatedTokens: rolePrompt.length / 4 + 5000,
        };
      }
    }

    if (!isAuthoritativeConversation(getRun(runId), cascadeId)) {
      log.info({ runId: shortRunId, roleId: role.id, cascadeId: cascadeId.slice(0, 8) }, 'Skipping review-loop writeback for superseded branch');
      return { decision: 'failed', sharedState };
    }

    if (terminalKind !== 'completed') {
      const terminationStatus: 'failed' | 'blocked' | 'cancelled' | 'timeout' =
        result.status === 'completed' ? 'failed' : result.status;
      updateRoleProgressByConversation(runId, cascadeId, {
        status: result.status,
        finishedAt: new Date().toISOString(),
        result,
      });
      log.warn({ runId: shortRunId, roleId: role.id, terminalKind, status: result.status }, 'Role session ended before successful completion');
      propagateTermination(runId, terminationStatus, getFailureReason(result));
      return { decision: 'failed', sharedState };
    }

    log.info({ runId: shortRunId, roleId: role.id, round, resultStatus: result.status, summaryLength: result.summary.length, changedFiles: result.changedFiles.length }, 'Role execution completed');

    const audit = buildRoleInputReadAudit(runId, artifactDir, taskEnvelope, steps);
    const finalizedResult = enforceCanonicalInputReadProtocol(role.id, result, audit);
    updateRoleProgressByConversation(runId, cascadeId, {
      status: finalizedResult.status,
      finishedAt: new Date().toISOString(),
      result: finalizedResult,
      inputReadAudit: audit,
    });

    if (finalizedResult.status !== 'completed') {
      const terminationStatus: 'failed' | 'blocked' | 'cancelled' | 'timeout' = finalizedResult.status;
      log.warn({ runId: shortRunId, roleId: role.id, status: finalizedResult.status }, 'Role did not complete, stopping chain');
      propagateTermination(runId, terminationStatus, getFailureReason(finalizedResult));
      return { decision: 'failed', sharedState };
    }

    // V2.5.1: After author role completes, validate that output files were actually created
    if (!isReviewer) {
      const outputDir = role.id.includes('architect') ? 'architecture' : 'specs';
      const outputAbsPath = path.join(artifactAbsDir, outputDir);
      const hasOutput = fs.existsSync(outputAbsPath) && fs.readdirSync(outputAbsPath).length > 0;
      // Fallback: delivery roles may also write to delivery/ instead of specs/
      const deliveryFallback = !hasOutput && outputDir === 'specs'
        ? (fs.existsSync(path.join(artifactAbsDir, 'delivery')) && fs.readdirSync(path.join(artifactAbsDir, 'delivery')).length > 0)
        : false;
      if (deliveryFallback) {
        // Move delivery/ contents to specs/ so the reviewer can find them
        const deliveryPath = path.join(artifactAbsDir, 'delivery');
        const specsPath = path.join(artifactAbsDir, 'specs');
        if (!fs.existsSync(specsPath)) fs.mkdirSync(specsPath, { recursive: true });
        for (const file of fs.readdirSync(deliveryPath)) {
          fs.renameSync(path.join(deliveryPath, file), path.join(specsPath, file));
        }
        log.info({ runId: shortRunId, roleId: role.id }, 'Moved delivery/ contents to specs/ for reviewer compatibility');
      } else if (!hasOutput) {
        log.error({ runId: shortRunId, roleId: role.id, round, expectedOutput: outputAbsPath }, 'Author role completed but produced no output files — reviewer cannot proceed');
        updateRun(runId, {
          status: 'failed',
          lastError: `Author role ${role.id} completed without producing output files in ${outputDir}/. The child conversation may have errored during file creation.`,
        });
        return { decision: 'failed', sharedState };
      }
      log.info({ runId: shortRunId, roleId: role.id, round, outputDir }, 'Author output directory validated');
    }

    if (isReviewer) {
      let decision: string = extractReviewDecision(artifactAbsDir, round, steps, finalizedResult);

      // Allow policy engine to override LLM decision based on rules (e.g. max rounds)
      const runState = getRun(runId);
      if (policy && runState) {
        const engineDecision = ReviewEngine.evaluate(runState, policy);
        if (engineDecision === 'revise-exhausted' || engineDecision === 'rejected') {
          decision = engineDecision as any;
        }
      }

      updateRoleProgressByConversation(runId, cascadeId, { reviewDecision: decision as any });

      log.info({ runId: shortRunId, round, decision }, 'Review decision extracted');

      if (decision === 'approved') {
        updateRun(runId, { status: 'completed', result: finalizedResult, reviewOutcome: 'approved' });
        finalizeAdvisoryRun(runId, group, artifactAbsDir, 'approved', finalizedResult);
        // Pipeline auto-trigger: dispatch next stage if this run belongs to a pipeline
        void tryAutoTriggerNextStage(runId, input.pipelineStageId || group.id, input);
        return { decision: 'approved', sharedState };
      }
      if (decision === 'rejected') {
        updateRun(runId, { status: 'blocked', result: finalizedResult, reviewOutcome: 'rejected', lastError: 'Reviewer rejected the spec' });
        finalizeAdvisoryRun(runId, group, artifactAbsDir, 'rejected', finalizedResult);
        return { decision: 'rejected', sharedState };
      }
      if (decision === 'revise-exhausted') {
        log.warn({ runId: shortRunId }, 'Review policy exhausted or forced termination');
        updateRun(runId, { status: 'blocked', reviewOutcome: 'revise-exhausted', lastError: 'Exceeded max review rounds per policy' });
        finalizeAdvisoryRun(runId, group, artifactAbsDir, 'revise-exhausted', undefined);
        return { decision: 'revise-exhausted', sharedState };
      }
      return { decision: 'revise', sharedState };
    }
  }

  // Should not reach here in normal flow, but handle gracefully
  return { decision: 'failed', sharedState };
}
// ---------------------------------------------------------------------------
// V3.5: Pipeline auto-trigger — dispatch next stage when current stage completes
// ---------------------------------------------------------------------------

async function tryAutoTriggerNextStage(
  runId: string,
  currentStageId: string,
  input: DispatchRunInput,
): Promise<void> {
  const run = getRun(runId);
  const templateId = run?.templateId || run?.pipelineId;
  if (!templateId || !run?.projectId) return;

  const shortRunId = runId.slice(0, 8);
  const downstreams = getDownstreamStages(templateId, currentStageId);
  if (downstreams.length === 0) {
    log.info({ runId: shortRunId, templateId }, 'Pipeline completed — no next stage');
    return;
  }

  const project = getProject(run.projectId);
  const template = AssetLoader.getTemplate(templateId);
  if (!project?.pipelineState || !template) return;
  const pipelineState = project.pipelineState;

  for (const stage of downstreams) {
    const stageId = stage.stageId || '';
    if (!stageId) {
      log.warn({ runId: shortRunId, templateId }, 'Skipping downstream stage with missing stageId');
      continue;
    }
    const nextStage = pipelineState.stages.find((item: any) => item.stageId === stageId);
    if (nextStage?.runId && nextStage.status !== 'pending') {
      log.info({
        runId: shortRunId,
        stageId,
        existingStatus: nextStage.status,
      }, 'Downstream stage already has a canonical run, skipping auto-trigger');
      continue;
    }

    if (!stage.autoTrigger) {
      log.info({ runId: shortRunId, stageId, nextStageId: stage.stageId }, 'Downstream stage exists but autoTrigger is false');
      continue;
    }

    if (stage.stageType === 'fan-out' || stage.stageType === 'join') {
      continue;
    }

    const { ready, missingUpstreams } = canActivateStage(template, stage, pipelineState);
    if (!ready) {
      log.info({ runId: shortRunId, stageId, missingUpstreams }, 'Downstream stage not ready');
      continue;
    }

    const upstreamStageIds = stage.upstreamStageIds?.length ? stage.upstreamStageIds : [currentStageId];
    const allSourceRunIds = upstreamStageIds
      .map(upstreamStageId => pipelineState.stages.find((item: any) => item.stageId === upstreamStageId)?.runId)
      .filter(Boolean) as string[];
    const filteredSourceRunIds = filterSourcesByContract(templateId, stageId, allSourceRunIds);

    log.info({
      runId: shortRunId,
      templateId,
      nextStageId: stageId,
      stageId,
      sourceRunCount: filteredSourceRunIds.length,
    }, 'Auto-triggering downstream pipeline stage');

    try {
      const nextInput: DispatchRunInput = {
        stageId,
        workspace: input.workspace,
        prompt: stage.promptTemplate || run.prompt,
        model: input.model || run.model,
        projectId: run.projectId,
        sourceRunIds: filteredSourceRunIds,
        pipelineId: templateId,
        templateId,
        pipelineStageId: stageId,
        taskEnvelope: run.taskEnvelope ? {
          ...run.taskEnvelope,
          goal: stage.promptTemplate || run.taskEnvelope.goal,
        } : undefined,
      };
      const result = await dispatchRun(nextInput);
      if (result?.runId) {
        addRunToProject(run.projectId, result.runId);
        trackStageDispatch(run.projectId, stageId, result.runId);
      }
    } catch (err: any) {
      log.error({ runId: shortRunId, stageId, nextStageId: stageId, err: err.message }, 'Failed to auto-trigger downstream pipeline stage');
    }
  }
}

// readDeliveryPacket, buildWriteScopeAudit, scanArtifactManifest,
// copyUpstreamArtifacts, buildResultEnvelope, writeEnvelopeFile — moved to run-artifacts.ts

// getCanonicalTaskEnvelope, normalizeComparablePath, includesPathCandidate,
// extractStepReadEvidence, filterEvidenceByCandidates, dedupeStringList,
// buildRoleInputReadAudit, enforceCanonicalInputReadProtocol,
// summarizeFailureText, getFailureReason, propagateTermination
// — moved to runtime-helpers.ts
function finalizeLegacySingleRun(runId: string, result: TaskResult): void {
  const currentRun = getRun(runId);
  if (!currentRun || TERMINAL_STATUSES.has(currentRun.status)) {
    return;
  }

  updateRun(runId, {
    status: result.status,
    result,
    lastError: result.status === 'completed'
      ? undefined
      : getFailureReason(result) || result.blockers[0] || result.summary,
  });
}


// ---------------------------------------------------------------------------
// cancelRun
// ---------------------------------------------------------------------------

export async function cancelRun(runId: string): Promise<void> {
  const run = getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.status === 'cancelled' || run.status === 'completed') {
    throw new Error(`Run ${runId} is already ${run.status}`);
  }

  const activeSession = getAgentSession(runId);
  if (activeSession) {
    markAgentSessionCancelRequested(runId);
    if (run.projectId && (run.pipelineStageId || run.pipelineStageIndex !== undefined)) {
      if (run.pipelineStageId) {
        updatePipelineStageByStageId(run.projectId, run.pipelineStageId, { status: 'cancelled', runId });
      } else {
        updatePipelineStage(run.projectId, run.pipelineStageIndex!, { status: 'cancelled', runId });
      }
    }
    updateRun(runId, { status: 'cancelled' });
    cleanup(runId);
    await activeSession.session.cancel('cancelled_by_user');
    return;
  }

  const activeCascadeId = resolveSessionHandle(run);
  if (activeCascadeId) {
    const attachedSession = await attachExistingRunSession(runId, run, activeCascadeId);
    if (attachedSession) {
      if (run.projectId && (run.pipelineStageId || run.pipelineStageIndex !== undefined)) {
        if (run.pipelineStageId) {
          updatePipelineStageByStageId(run.projectId, run.pipelineStageId, { status: 'cancelled', runId });
        } else {
          updatePipelineStage(run.projectId, run.pipelineStageIndex!, { status: 'cancelled', runId });
        }
      }
      updateRun(runId, { status: 'cancelled' });
      cleanup(runId);
      await attachedSession.cancel('cancelled_by_user');
      return;
    }
  }

  if (run.projectId && (run.pipelineStageId || run.pipelineStageIndex !== undefined)) {
    if (run.pipelineStageId) {
      updatePipelineStageByStageId(run.projectId, run.pipelineStageId, { status: 'cancelled', runId });
    } else {
      updatePipelineStage(run.projectId, run.pipelineStageIndex!, { status: 'cancelled', runId });
    }
  }
  updateRun(runId, { status: 'cancelled' });
  cleanup(runId);
}

// ---------------------------------------------------------------------------
// cleanup — stop watching + clear timeout
// ---------------------------------------------------------------------------

function cleanup(runId: string): void {
  const active = activeRuns.get(runId);
  if (active) {
    active.abortWatch();
    if (active.timeoutTimer) clearTimeout(active.timeoutTimer);
    activeRuns.delete(runId);
  }
}

/**
 * V3: 从 architecture run 的 write-scope-plan.json 拆分出多个 Work Package 的 scope
 * 这是一个辅助函数供 Governor 调用
 */
export function splitWriteScopeForMultiWP(
  writeScopePlanPath: string,
  workPackageGoals: { taskId: string; goalDescription: string; suggestedFiles?: string[] }[]
): { taskId: string; writeScope: { path: string; operation: string }[] }[] {
  try {
    const raw = fs.readFileSync(writeScopePlanPath, "utf-8");
    const fullScope: { path: string; operation: string }[] = JSON.parse(raw);

    return workPackageGoals.map(wp => {
      // If suggestedFiles provided, use them; otherwise include all
      const scope = wp.suggestedFiles
        ? fullScope.filter(entry => wp.suggestedFiles!.some(f => entry.path.includes(f)))
        : fullScope;
      return { taskId: wp.taskId, writeScope: scope };
    });
  } catch {
    return workPackageGoals.map(wp => ({ taskId: wp.taskId, writeScope: [] }));
  }
}
