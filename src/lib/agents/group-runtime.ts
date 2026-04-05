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
  discoverLanguageServers,
  getApiKey,
  refreshOwnerMap,
  preRegisterOwner,
  getOwnerConnection,
  grpc,
} from '../bridge/gateway';
import { extractAndPersistMemory } from './department-memory';
import { getGroup } from './group-registry';
import { createRun, updateRun, getRun } from './run-registry';
import { watchConversation, type ConversationWatchState } from './watch-conversation';
import type {
  AgentRunState, TaskResult, GroupDefinition, GroupRoleDefinition,
  RoleProgress, ReviewDecision, ReviewOutcome,
  TaskEnvelope, ResultEnvelope, ArtifactManifest, ArtifactRef,
  GroupSourceContract, RunLiveState, SupervisorReview, SupervisorDecision, SupervisorSummary,
  RoleInputReadAudit, RoleReadEvidence, InputArtifactReadAuditEntry,
  SharedConversationState,
} from './group-types';
import { TERMINAL_STATUSES } from './group-types';
import type { DevelopmentWorkPackage, DevelopmentDeliveryPacket, WriteScopeAudit } from './development-template-types';
import type { DepartmentConfig } from '../types';
import { ARTIFACT_ROOT_DIR } from './gateway-home';
import { createLogger } from '../logger';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ReviewEngine } from './review-engine';
import { AssetLoader } from './asset-loader';
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
  readDeliveryPacket,
  buildWriteScopeAudit,
  scanArtifactManifest,
  copyUpstreamArtifacts,
  buildResultEnvelope,
  writeEnvelopeFile,
} from './run-artifacts';
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
import { checkWriteScopeConflicts } from "./scope-governor";
import { getExecutor, resolveProvider } from '../providers';
import { canActivateStage, filterSourcesByContract, getDownstreamStages } from './pipeline-registry';

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

// isAuthoritativeConversation, cancelCascadeBestEffort — moved to runtime-helpers.ts

// ---------------------------------------------------------------------------
// DispatchRunInput — V2 unified input type
// ---------------------------------------------------------------------------

export interface DispatchRunInput {
  groupId: string;
  workspace: string;
  prompt?: string;
  model?: string;
  parentConversationId?: string;
  taskEnvelope?: TaskEnvelope;
  sourceRunIds?: string[];
  projectId?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  pipelineStageIndex?: number;
  /** V5.5: Override conversation mode for this run. 'shared' = reuse cascade, 'isolated' = default */
  conversationMode?: 'shared' | 'isolated';
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

    if (!contract.acceptedSourceGroupIds.includes(srcRun.groupId)) {
      throw new Error(`Source run ${srcRunId} has groupId '${srcRun.groupId}', but group '${group.id}' only accepts: ${contract.acceptedSourceGroupIds.join(', ')}`);
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
  // 1. Validate group
  const group = getGroup(input.groupId);
  if (!group) {
    throw new Error(`Unknown group: ${input.groupId}`);
  }
  if (group.executionMode === 'orchestration') {
    const err: any = new Error(`Group '${input.groupId}' is an orchestration node and cannot be dispatched directly`);
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
  let resolvedSource: ResolvedSourceContext = { sourceRuns: [], inputArtifacts: [] };

  if (group.sourceContract) {
    resolvedSource = resolveSourceContext(group, input, workspacePath);
  } else if (group.capabilities?.requiresInputArtifacts) {
    // Legacy V2 path: caller must provide inputArtifacts directly
    const inputArtifacts = input.taskEnvelope?.inputArtifacts;
    if (!inputArtifacts || inputArtifacts.length === 0) {
      throw new Error(`Group ${input.groupId} requires inputArtifacts from an approved source run`);
    }
    if (!input.sourceRunIds || input.sourceRunIds.length === 0) {
      throw new Error(`Group ${input.groupId} requires sourceRunIds`);
    }
    resolvedSource = { sourceRuns: [], inputArtifacts };
  }

  // 4. Check token quota before dispatching
  const { checkTokenQuota, shouldAutoRequestQuota } = require('../approval/token-quota');
  const quotaCheck = checkTokenQuota(workspacePath);
  if (!quotaCheck.allowed) {
    // Auto-generate approval request for quota increase
    try {
      const { submitApprovalRequest } = require('../approval/handler');
      await submitApprovalRequest({
        type: 'token_increase' as const,
        workspace: workspacePath,
        title: `Token 配额超限: ${input.groupId}`,
        description: `部门 ${workspacePath} 的 Token 配额已用尽，无法执行新任务。`,
        urgency: 'high' as const,
      });
    } catch { /* non-fatal */ }
    throw new Error(`Token quota exceeded for workspace ${workspacePath}. An approval request has been submitted.`);
  }
  if (shouldAutoRequestQuota(workspacePath)) {
    try {
      const { submitApprovalRequest } = require('../approval/handler');
      await submitApprovalRequest({
        type: 'token_increase' as const,
        workspace: workspacePath,
        title: `Token 配额预警: ${input.groupId}`,
        description: `部门 ${workspacePath} 的 Token 使用量即将达到上限（剩余 ${quotaCheck.remaining}），建议增加配额。`,
        urgency: 'normal' as const,
      });
    } catch { /* non-fatal */ }
  }

  // 5. Resolve provider and find server
  const provider = resolveProvider('execution', workspacePath).provider;
  let server: { port: number; csrf: string; workspace?: string } | undefined;
  let apiKey: string | undefined;

  if (provider === 'antigravity') {
    // Antigravity requires a running language server
    const servers = discoverLanguageServers();
    server = servers.find(
      (s) => s.workspace && (s.workspace.includes(workspacePath) || workspacePath.includes(s.workspace)),
    );
    if (!server) {
      throw new Error(`No language_server found for workspace: ${input.workspace}`);
    }
    apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('No API key available');
    }
  } else {
    // Codex CLI doesn't need a language server — uses MCP subprocess
    log.info({ workspace: workspacePath, provider }, 'Using Codex CLI provider (no language server needed)');
    // Create a placeholder server object for APIs that still require it
    server = { port: 0, csrf: '' };
    apiKey = '';
  }

  // 5. Build or synthesize TaskEnvelope
  const finalModel = input.model || group.defaultModel || 'MODEL_PLACEHOLDER_M26';
  let envelope = input.taskEnvelope;
  if (!envelope) {
    // Synthesize default envelope for legacy prompt path
    envelope = {
      templateId: group.templateId,
      goal: input.prompt!,
    };
  }

  // V2.5: Populate resolved inputArtifacts into envelope if auto-built
  if (resolvedSource.inputArtifacts.length > 0 && (!envelope.inputArtifacts || envelope.inputArtifacts.length === 0)) {
    envelope = { ...envelope, inputArtifacts: resolvedSource.inputArtifacts };
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
    groupId: input.groupId,
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
      updateRun(runId, { artifactDir });

      // ── Single-role path (V1 backward-compat) ──────────────────────────
      const workflowContent = AssetLoader.resolveWorkflowContent(group.roles[0].workflow);
      const cascadeId = await createAndDispatchChild(
        server, apiKey, wsUri, runId, input.groupId, group.roles[0].id,
        `${workflowContent}\n\n${goal}`,
        finalModel, input.parentConversationId,
      );

      updateRun(runId, { status: 'running' });
      startWatching(runId, cascadeId, { port: server.port, csrf: server.csrf }, apiKey, group.roles[0]);

      log.info({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8) }, 'Single-role run dispatched');
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
// createAndDispatchChild — reusable child conversation creation
// ---------------------------------------------------------------------------

async function createAndDispatchChild(
  server: { port: number; csrf: string },
  apiKey: string,
  wsUri: string,
  runId: string,
  groupId: string,
  roleId: string,
  prompt: string,
  model: string,
  parentConversationId?: string,
): Promise<string> {
  const shortRunId = runId.slice(0, 8);

  // PITFALL #12: Must addTrackedWorkspace before startCascade so the language server
  // knows about this workspace's filesystem. Without this, tool calls like
  // LIST_DIRECTORY get CANCELED because the server can't access the files.
  const workspacePath = wsUri.replace(/^file:\/\//, '');
  log.info({ runId: shortRunId, roleId, port: server.port }, 'Starting child conversation');
  try {
    await grpc.addTrackedWorkspace(server.port, server.csrf, workspacePath);
    log.debug({ runId: shortRunId, roleId, workspacePath: workspacePath.slice(-40) }, 'Workspace tracked');
  } catch (e: any) {
    log.warn({ runId: shortRunId, roleId, err: e.message }, 'AddTrackedWorkspace failed (may already be tracked)');
  }

  const startResult = await grpc.startCascade(server.port, server.csrf, apiKey, wsUri);
  const cascadeId = startResult?.cascadeId;

  if (!cascadeId) {
    throw new Error('StartCascade returned no cascadeId');
  }

  updateRun(runId, {
    status: 'starting',
    childConversationId: cascadeId,
    activeConversationId: cascadeId,
    activeRoleId: roleId,
    startedAt: new Date().toISOString(),
  });

  preRegisterOwner(cascadeId, {
    port: server.port,
    csrf: server.csrf,
    apiKey,
    stepCount: 0,
  });

  log.debug({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8), roleId }, 'Setting hidden annotations');
  await grpc.updateConversationAnnotations(server.port, server.csrf, apiKey, cascadeId, {
    'antigravity.task.hidden': 'true',
    'antigravity.task.parentId': parentConversationId || '',
    'antigravity.task.groupId': groupId,
    'antigravity.task.runId': runId,
    'antigravity.task.roleId': roleId,
    lastUserViewTime: new Date().toISOString(),
  });

  log.info({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8), roleId, promptLength: prompt.length }, 'Sending workflow prompt');
  await grpc.sendMessage(server.port, server.csrf, apiKey, cascadeId, prompt, model, false /* Fast mode */, undefined, 'ARTIFACT_REVIEW_MODE_TURBO');

  return cascadeId;
}

// ---------------------------------------------------------------------------
// V6: Department Provider Resolution
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// startWatching — fire-and-forget watcher for single-role runs
// ---------------------------------------------------------------------------

function startWatching(
  runId: string,
  cascadeId: string,
  conn: { port: number; csrf: string },
  apiKey: string,
  roleConfig: { timeoutMs: number; autoApprove: boolean },
): void {
  const shortRunId = runId.slice(0, 8);
  let lastWasActive = true;
  let idleDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let filePollTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
    const currentRun = getRun(runId);
    if (!currentRun || currentRun.status === 'cancelled' || currentRun.status === 'failed') return;
    const absDir = currentRun.artifactDir ? path.join((currentRun.workspace || '').replace(/^file:\/\//, ''), currentRun.artifactDir) : undefined;
    if (!absDir) return;
    try {
      let isDone = false;
      try {
        const dp = JSON.parse(fs.readFileSync(path.join(absDir, 'delivery', 'delivery-packet.json'), 'utf-8'));
        if (dp?.status === 'completed') isDone = true;
      } catch { }
      if (!isDone) {
        try {
          const rj = JSON.parse(fs.readFileSync(path.join(absDir, 'result.json'), 'utf-8'));
          if (rj?.status === 'completed') isDone = true;
        } catch { }
      }
      if (isDone) {
        log.info({ runId: shortRunId }, 'File-based watcher detected completion via artifact JSON');
        handleCompletion(runId, []);
        stopLocalWatch();
      }
    } catch { }
  }, 3000);
  let stopped = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 30; // ~90 seconds of retries

  const stopLocalWatch = () => {
    if (stopped) return;
    stopped = true;
    if (filePollTimer) { clearInterval(filePollTimer); filePollTimer = null; }
    if (idleDebounceTimer) clearTimeout(idleDebounceTimer);
    abortWatch();
    const active = activeRuns.get(runId);
    if (active?.abortWatch === abortWatch) {
      if (active.timeoutTimer) clearTimeout(active.timeoutTimer);
      activeRuns.delete(runId);
    }
  };

  const abortWatch = watchConversation(
    conn,
    cascadeId,
    async (state: ConversationWatchState) => {
      // Reset reconnect counter on successful data
      reconnectAttempts = 0;
      const currentRun = getRun(runId);
      if (!isAuthoritativeConversation(currentRun, cascadeId)) {
        log.warn({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8) }, 'Ignoring stale watcher for superseded branch');
        stopLocalWatch();
        return;
      }
      if (!currentRun || currentRun.status === 'cancelled' || currentRun.status === 'failed') {
        log.debug({ runId: shortRunId, status: currentRun?.status }, 'Run already terminal, cleaning up watcher');
        stopLocalWatch();
        return;
      }

      if (roleConfig.autoApprove) {
        await handleAutoApprove(state.steps, cascadeId, conn, apiKey, runId);
      }

      // V2.5.1: Propagate liveState to run
      updateRun(runId, {
        liveState: {
          cascadeStatus: state.cascadeStatus,
          stepCount: state.stepCount,
          lastStepAt: state.lastStepAt,
          lastStepType: state.lastStepType,
          staleSince: state.staleSince,
        },
      });

      // V2.5.1: Detect error steps as fallback completion signal
      if (state.hasErrorSteps && lastWasActive) {
        log.warn({ runId: shortRunId, stepCount: state.steps.length }, 'Child conversation ended with ERROR/CANCELED steps — completing with failure');
        if (idleDebounceTimer) clearTimeout(idleDebounceTimer);
        idleDebounceTimer = setTimeout(() => {
          const latestRun = getRun(runId);
          if (!isAuthoritativeConversation(latestRun, cascadeId)) {
            log.warn({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8) }, 'Ignoring stale completion from superseded branch');
            stopLocalWatch();
            return;
          }
          handleCompletion(runId, state.steps);
        }, 2000);
        lastWasActive = false;
        return;
      }

      if (!state.isActive && lastWasActive) {
        log.info({ runId: shortRunId, cascadeStatus: state.cascadeStatus, stepCount: state.steps.length }, 'Child went idle, starting completion debounce');
        if (idleDebounceTimer) clearTimeout(idleDebounceTimer);
        idleDebounceTimer = setTimeout(() => {
          const latestRun = getRun(runId);
          if (!isAuthoritativeConversation(latestRun, cascadeId)) {
            log.warn({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8) }, 'Ignoring stale completion from superseded branch');
            stopLocalWatch();
            return;
          }
          handleCompletion(runId, state.steps);
        }, 2000);
      } else if (state.isActive) {
        if (idleDebounceTimer) { clearTimeout(idleDebounceTimer); idleDebounceTimer = null; }
      }

      lastWasActive = state.isActive;
    },
    (err: Error) => {
      reconnectAttempts++;
      log.warn({ runId: shortRunId, err: err.message, attempt: reconnectAttempts, maxAttempts: MAX_RECONNECT_ATTEMPTS }, 'Watch stream disconnected');

      // Safety: stop infinite reconnect loop
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        log.error({ runId: shortRunId, attempts: reconnectAttempts }, 'Watch max reconnect attempts reached — marking run as failed. Use force-complete to manually advance pipeline.');
        updateRun(runId, { status: 'failed', lastError: `Watch stream lost after ${reconnectAttempts} reconnect attempts` });
        stopLocalWatch();
        return;
      }

      setTimeout(async () => {
        const currentRun = getRun(runId);
        if (!isAuthoritativeConversation(currentRun, cascadeId) || currentRun.status !== 'running') return;

        try {
          await refreshOwnerMap();
          const newConn = getOwnerConnection(cascadeId);
          if (newConn) {
            log.info({ runId: shortRunId, port: newConn.port, attempt: reconnectAttempts }, 'Watch reconnecting');
            stopLocalWatch();
            startWatching(runId, cascadeId, newConn, apiKey, roleConfig);
          } else {
            log.error({ runId: shortRunId }, 'Watch reconnect failed: no owner');
            updateRun(runId, { status: 'failed', lastError: 'Watch stream lost and reconnect failed' });
            stopLocalWatch();
          }
        } catch (e: any) {
          log.error({ runId: shortRunId, err: e.message }, 'Watch reconnect error');
          updateRun(runId, { status: 'failed', lastError: `Reconnect error: ${e.message}` });
          stopLocalWatch();
        }
      }, 3000);
    },
    apiKey,
  );

  const timeoutTimer = setTimeout(() => {
    const currentRun = getRun(runId);
    if (currentRun && currentRun.status === 'running') {
      log.warn({ runId: shortRunId, timeoutMs: roleConfig.timeoutMs }, 'Run timed out');
      cancelRunInternal(runId, cascadeId, conn, apiKey, 'timeout');
    }
  }, roleConfig.timeoutMs);

  activeRuns.set(runId, { abortWatch, timeoutTimer });
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

    const group = getGroup(run.groupId);
    if (!group) throw new Error(`Unknown group: ${run.groupId}`);

    const shortRunId = runId.slice(0, 8);
    const workspacePath = run.workspace.replace(/^file:\/\//, '');

    // Find the language server
    const servers = discoverLanguageServers();
    const server = servers.find(
      (s) => s.workspace && (s.workspace.includes(workspacePath) || workspacePath.includes(s.workspace)),
    );
    if (!server) throw new Error(`No language_server found for workspace: ${run.workspace}`);

    const apiKey = getApiKey();
    if (!apiKey) throw new Error('No API key available');

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
      // V3.5 Fix 7: Find the LATEST matching role's cascadeId (reverse search)
      const matchingRoles = roles.filter(r => r.roleId === targetRoleId && r.childConversationId);
      const latestRole = matchingRoles[matchingRoles.length - 1];
      const cascadeId = latestRole?.childConversationId || run.childConversationId;
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

      log.info({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8), promptLength: nudgePrompt.length }, 'Sending nudge to existing cascade');

      await grpc.sendMessage(server.port, server.csrf, apiKey, cascadeId, nudgePrompt, run.model);

      // Watch for completion
      let steps: any[];
      let result: TaskResult;
      try {
        ({ steps, result } = await watchUntilComplete(
          runId, cascadeId, { port: server.port, csrf: server.csrf }, apiKey, roleDef, cascadeId,
        ));
      } catch (err: any) {
        if (err?.message === 'superseded') {
          log.info({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8) }, 'Nudge result ignored because the branch was superseded');
          return { status: 'superseded', action, cascadeId };
        }
        throw err;
      }

      if (!isAuthoritativeConversation(getRun(runId), cascadeId)) {
        log.info({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8) }, 'Skipping nudge writeback for superseded branch');
        return { status: 'superseded', action, cascadeId };
      }

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
      const cascadeId = run.activeConversationId || run.childConversationId;

      // Fetch recent steps from the last known conversation
      let recentStepsText = 'No conversation data available.';
      if (cascadeId) {
        try {
          const resp = await grpc.getTrajectorySteps(server.port, server.csrf, apiKey, cascadeId);
          const allSteps = (resp?.steps || []).filter((s: any) => s != null);
          const recentSteps = allSteps.slice(-12).map(summarizeStepForSupervisor);
          recentStepsText = recentSteps.join('\n') || 'No recent actions.';
        } catch {
          recentStepsText = 'Failed to fetch conversation steps.';
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

      // Create a one-shot supervisor conversation
      const evalWsUri = wsUri;
      const startResult = await grpc.startCascade(server.port, server.csrf, apiKey, evalWsUri);
      const evalCascadeId = startResult?.cascadeId;
      if (!evalCascadeId) {
        throw new Error('Failed to start supervisor evaluation conversation');
      }

      // Store conversation ID on run immediately so frontend can open it in real-time
      updateRun(runId, { supervisorConversationId: evalCascadeId });

      // Mark as supervisor task (NOT hidden — user needs to see it)
      await grpc.updateConversationAnnotations(server.port, server.csrf, apiKey, evalCascadeId, {
        'antigravity.task.type': 'supervisor-evaluate',
        'antigravity.task.runId': runId,
      });

      // Send evaluation prompt
      await grpc.sendMessage(
        server.port, server.csrf, apiKey, evalCascadeId,
        evalPrompt, SUPERVISOR_MODEL,
        false, undefined, 'ARTIFACT_REVIEW_MODE_TURBO',
      );

      // Poll for response
      const pollStart = Date.now();
      const EVAL_POLL_INTERVAL = 5_000;
      const EVAL_POLL_TIMEOUT = 90_000;
      let responseText = '';
      const preStepsResp = await grpc.getTrajectorySteps(server.port, server.csrf, apiKey, evalCascadeId);
      const preStepCount = (preStepsResp?.steps || []).filter((s: any) => s != null).length;

      while (Date.now() - pollStart < EVAL_POLL_TIMEOUT) {
        await new Promise(r => setTimeout(r, EVAL_POLL_INTERVAL));
        const stepsResp = await grpc.getTrajectorySteps(server.port, server.csrf, apiKey, evalCascadeId);
        const evalSteps = (stepsResp?.steps || []).filter((s: any) => s != null);
        for (let j = evalSteps.length - 1; j >= preStepCount; j--) {
          const step = evalSteps[j];
          if (step?.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
            const planner = step.plannerResponse || step.response || {};
            const text = planner.modifiedResponse || planner.response || '';
            if (text) { responseText = text; break; }
          }
        }
        if (responseText) break;
      }

      // Parse decision
      let decision: SupervisorDecision;
      if (!responseText) {
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
      const previousCascadeId = run.activeConversationId || run.childConversationId;

      const retryTaskEnvelope = getCanonicalTaskEnvelope(runId, run.taskEnvelope);
      const retryPrompt = prompt || buildRetryPrompt(roleDef, goal, artifactDir, round, isReviewer, retryTaskEnvelope);
      const cascadeId = await createAndDispatchChild(
        server, apiKey, wsUri, runId, run.groupId, targetRoleId,
        retryPrompt,
        run.model || 'MODEL_PLACEHOLDER_M26',
        run.parentConversationId,
      );

      updateRun(runId, {
        status: 'running',
        lastError: undefined,
        activeConversationId: cascadeId,
        activeRoleId: targetRoleId,
      });
      await cancelCascadeBestEffort(previousCascadeId, { port: server.port, csrf: server.csrf }, apiKey, shortRunId);

      // Record new role progress
      const newRoles = [...(getRun(runId)?.roles || [])];
      const startedAt = new Date().toISOString();
      newRoles.push({
        roleId: targetRoleId,
        round: round,
        childConversationId: cascadeId,
        status: 'running',
        startedAt,
        promptSnapshot: retryPrompt,
        promptRecordedAt: startedAt,
      });
      updateRun(runId, { roles: newRoles, childConversationId: cascadeId, activeConversationId: cascadeId, activeRoleId: targetRoleId });

      log.info({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8), roleId: targetRoleId }, 'Restart-role dispatched');

      // Watch for completion
      let steps: any[];
      let result: TaskResult;
      try {
        ({ steps, result } = await watchUntilComplete(
          runId, cascadeId, { port: server.port, csrf: server.csrf }, apiKey, roleDef, cascadeId,
        ));
      } catch (err: any) {
        if (err?.message === 'superseded') {
          log.info({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8) }, 'Restart-role result ignored because the branch was superseded');
          return { status: 'superseded', action, cascadeId };
        }
        throw err;
      }

      if (!isAuthoritativeConversation(getRun(runId), cascadeId)) {
        log.info({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8) }, 'Skipping restart-role writeback for superseded branch');
        return { status: 'superseded', action, cascadeId };
      }

      // Update role progress
      const restartAudit = buildRoleInputReadAudit(runId, artifactDir, retryTaskEnvelope, steps);
      const restartResult = enforceCanonicalInputReadProtocol(targetRoleId, result, restartAudit);
      const rolesAfter = getRun(runId)?.roles || [];
      if (rolesAfter.length > 0) {
        rolesAfter[rolesAfter.length - 1] = {
          ...rolesAfter[rolesAfter.length - 1],
          status: restartResult.status,
          finishedAt: new Date().toISOString(),
          result: restartResult,
          inputReadAudit: restartAudit,
        };
        updateRun(runId, { roles: rolesAfter });
      }

      // Process result
      await processInterventionResult(runId, run, group, roleDef, isReviewer, restartResult, steps, artifactAbsDir);

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
    log.warn({ runId: shortRunId, roleId: roleDef.id, status: result.status }, 'Intervention did not complete successfully');
    updateRun(runId, {
      status: result.status === 'blocked' ? 'blocked' : 'failed',
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
        groupId: group.id,
        workspace: originalRun.workspace,
        projectId: originalRun.projectId,
        pipelineId: originalRun.pipelineId,
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
      const servers = discoverLanguageServers();
      const server = servers.find(
        (s) => s.workspace && (s.workspace.includes(workspacePath) || workspacePath.includes(s.workspace)),
      );
      if (!server) {
        updateRun(runId, { status: 'failed', lastError: 'Cannot resume review loop: no language server found' });
        return;
      }
      const apiKey = getApiKey();
      if (!apiKey) {
        updateRun(runId, { status: 'failed', lastError: 'Cannot resume review loop: no API key' });
        return;
      }

      const input: DispatchRunInput = {
        groupId: group.id,
        workspace: originalRun.workspace,
        prompt: originalRun.prompt,
        projectId: originalRun.projectId,
        pipelineId: originalRun.pipelineId,
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
    const servers = discoverLanguageServers();
    const server = servers.find(
      (s) => s.workspace && (s.workspace.includes(workspacePath) || workspacePath.includes(s.workspace)),
    );
    if (!server) {
      updateRun(runId, { status: 'failed', lastError: 'Cannot resume review round: no language server found' });
      return;
    }
    const apiKey = getApiKey();
    if (!apiKey) {
      updateRun(runId, { status: 'failed', lastError: 'Cannot resume review round: no API key' });
      return;
    }

    const input: DispatchRunInput = {
      groupId: group.id,
      workspace: originalRun.workspace,
      prompt: originalRun.prompt,
      projectId: originalRun.projectId,
      pipelineId: originalRun.pipelineId,
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
      groupId: group.id,
      workspace: originalRun.workspace,
      projectId: originalRun.projectId,
      pipelineId: originalRun.pipelineId,
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

// ---------------------------------------------------------------------------
// watchUntilComplete — Promise-based watcher for multi-role serial execution
// ---------------------------------------------------------------------------

function watchUntilComplete(
  runId: string,
  cascadeId: string,
  conn: { port: number; csrf: string },
  apiKey: string,
  roleConfig: GroupRoleDefinition,
  expectedConversationId: string,
): Promise<{ steps: any[]; result: TaskResult }> {
  return new Promise((resolve, reject) => {
    const shortRunId = runId.slice(0, 8);
    let lastWasActive = true;
    let idleDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let filePollTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
      const currentRun = getRun(runId);
      if (!currentRun || currentRun.status === 'cancelled' || currentRun.status === 'failed') return;
      const absDir = currentRun.artifactDir ? path.join((currentRun.workspace || '').replace(/^file:\/\//, ''), currentRun.artifactDir) : undefined;
      if (!absDir) return;
      try {
        let isDone = false;
        try {
          const dp = JSON.parse(fs.readFileSync(path.join(absDir, 'delivery', 'delivery-packet.json'), 'utf-8'));
          if (dp?.status === 'completed') isDone = true;
        } catch { }
        if (!isDone) {
          try {
            const rj = JSON.parse(fs.readFileSync(path.join(absDir, 'result.json'), 'utf-8'));
            if (rj?.status === 'completed') isDone = true;
          } catch { }
        }
        if (isDone) {
          log.info({ runId: shortRunId }, 'File-based watcher detected completion via artifact JSON');
          const result = compactCodingResult([], absDir, roleConfig);
          settle(() => resolve({ steps: [], result }));
        }
      } catch { }
    }, 3000);
    let isSettled = false;

    const settle = (fn: () => void) => {
      if (isSettled) return;
      isSettled = true;
      if (filePollTimer) { clearInterval(filePollTimer); filePollTimer = null; }
      if (idleDebounceTimer) clearTimeout(idleDebounceTimer);
      clearTimeout(timeoutTimer);
      abortWatch();
      const active = activeRuns.get(runId);
      if (active?.abortWatch === abortWatch) {
        activeRuns.delete(runId);
      }
      fn();
    };

    const abortWatch = watchConversation(
      conn,
      cascadeId,
      async (state: ConversationWatchState) => {
        if (isSettled) return;

        const currentRun = getRun(runId);
        if (!isAuthoritativeConversation(currentRun, expectedConversationId)) {
          log.warn({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8) }, 'Stale watcher for superseded branch');
          settle(() => reject(new Error('superseded')));
          return;
        }
        if (!currentRun || currentRun.status === 'cancelled' || currentRun.status === 'failed') {
          log.debug({ runId: shortRunId, status: currentRun?.status }, 'Run already terminal, settling watcher');
          settle(() => reject(new Error(currentRun?.status || 'cancelled')));
          return;
        }

        if (roleConfig.autoApprove) {
          await handleAutoApprove(state.steps, cascadeId, conn, apiKey, runId);
        }

        // V2.5.1: Propagate liveState to run
        updateRun(runId, {
          liveState: {
            cascadeStatus: state.cascadeStatus,
            stepCount: state.stepCount,
            lastStepAt: state.lastStepAt,
            lastStepType: state.lastStepType,
            staleSince: state.staleSince,
          },
        });

        // V2.5.1: Detect error steps as fallback completion signal
        if (state.hasErrorSteps && lastWasActive) {
          log.warn({ runId: shortRunId, roleId: roleConfig.id, stepCount: state.steps.length }, 'Child ended with ERROR/CANCELED steps — treating as failed completion');
          if (idleDebounceTimer) clearTimeout(idleDebounceTimer);
          idleDebounceTimer = setTimeout(() => {
            const latestRun = getRun(runId);
            if (!isAuthoritativeConversation(latestRun, expectedConversationId)) {
              log.warn({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8) }, 'Ignoring stale completion from superseded branch');
              settle(() => reject(new Error('superseded')));
              return;
            }
            const run = getRun(runId);
            const absDir = run?.artifactDir ? path.join((run.workspace || '').replace(/^file:\/\//, ''), run.artifactDir) : undefined;
            const result = compactCodingResult(state.steps, absDir, roleConfig);
            // Only force failed if result.json didn't claim success
            if (!absDir || result.status !== 'completed') {
              result.status = 'failed';
              if (!result.summary || result.summary === 'Task completed (no summary extracted)') {
                result.summary = 'Child conversation ended with tool errors';
              }
            } else {
              log.info({ runId: shortRunId }, 'result.json reports completed despite hasErrorSteps — trusting result.json');
            }
            settle(() => resolve({ steps: state.steps, result }));
          }, 2000);
          lastWasActive = false;
          return;
        }

        if (!state.isActive && lastWasActive) {
          log.info({ runId: shortRunId, roleId: roleConfig.id, cascadeStatus: state.cascadeStatus, stepCount: state.steps.length }, 'Child went idle in multi-role watcher');
          if (idleDebounceTimer) clearTimeout(idleDebounceTimer);
          idleDebounceTimer = setTimeout(() => {
            const latestRun = getRun(runId);
            if (!isAuthoritativeConversation(latestRun, expectedConversationId)) {
              log.warn({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8) }, 'Ignoring stale completion from superseded branch');
              settle(() => reject(new Error('superseded')));
              return;
            }
            const run = getRun(runId);
            const absDir = run?.artifactDir ? path.join((run.workspace || '').replace(/^file:\/\//, ''), run.artifactDir) : undefined;
            const result = compactCodingResult(state.steps, absDir, roleConfig);
            settle(() => resolve({ steps: state.steps, result }));
          }, 2000);
        } else if (state.isActive) {
          if (idleDebounceTimer) { clearTimeout(idleDebounceTimer); idleDebounceTimer = null; }
        }

        lastWasActive = state.isActive;
      },
      (err: Error) => {
        log.warn({ runId: shortRunId, err: err.message }, 'Watch stream disconnected in multi-role');
        setTimeout(async () => {
          if (isSettled) return;
          const currentRun = getRun(runId);
          if (!isAuthoritativeConversation(currentRun, expectedConversationId) || currentRun.status !== 'running') return;

          try {
            await refreshOwnerMap();
            const newConn = getOwnerConnection(cascadeId);
            if (newConn) {
              log.info({ runId: shortRunId }, 'Watch reconnecting (multi-role)');
              settle(() => { });
              watchUntilComplete(runId, cascadeId, newConn, apiKey, roleConfig, expectedConversationId)
                .then(resolve)
                .catch(reject);
            } else {
              settle(() => reject(new Error('Watch stream lost and reconnect failed')));
            }
          } catch (e: any) {
            settle(() => reject(e));
          }
        }, 3000);
      },
      apiKey,
    );

    const timeoutTimer = setTimeout(() => {
      log.warn({ runId: shortRunId, timeoutMs: roleConfig.timeoutMs }, 'Role timed out');
      settle(() => reject(new Error('timeout')));
    }, roleConfig.timeoutMs);

    activeRuns.set(runId, { abortWatch, timeoutTimer });
  });
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
    const archRuns = resolvedSource.sourceRuns.filter(r => r.groupId === 'architecture-advisory');
    const prodRuns = resolvedSource.sourceRuns.filter(r => r.groupId === 'product-spec');
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

  // Build delivery-specific prompt
  const prompt = buildDeliveryPrompt(role, goal, artifactDir, artifactAbsDir, taskEnvelope);

  const cascadeId = await createAndDispatchChild(
    server, apiKey, wsUri, runId, input.groupId, role.id,
    prompt, finalModel, input.parentConversationId,
  );

  // Record role progress
  const run = getRun(runId);
  const roles = [...(run?.roles || [])];
  const startedAt = new Date().toISOString();
  roles.push({
    roleId: role.id,
    round: 1,
    childConversationId: cascadeId,
    status: 'running',
    startedAt,
    promptSnapshot: prompt,
    promptRecordedAt: startedAt,
  });
  updateRun(runId, { roles, childConversationId: cascadeId });

  // Fire-and-forget supervisor loop
  void startSupervisorLoop(runId, cascadeId, goal, apiKey, server, wsUri);

  log.info({ runId: shortRunId, roleId: role.id, cascadeId: cascadeId.slice(0, 8) }, 'Watching delivery execution');
  const { steps, result } = await watchUntilComplete(
    runId, cascadeId, { port: server.port, csrf: server.csrf }, apiKey, role, cascadeId,
  );

  if (!isAuthoritativeConversation(getRun(runId), cascadeId)) {
    log.info({ runId: shortRunId, cascadeId: cascadeId.slice(0, 8) }, 'Skipping delivery writeback for superseded branch');
    return;
  }

  // Update role progress
  const audit = buildRoleInputReadAudit(runId, artifactDir, taskEnvelope, steps);
  const finalizedResult = enforceCanonicalInputReadProtocol(role.id, result, audit);
  const rolesAfter = getRun(runId)?.roles || [];
  if (rolesAfter.length > 0) {
    rolesAfter[rolesAfter.length - 1] = {
      ...rolesAfter[rolesAfter.length - 1],
      status: finalizedResult.status,
      finishedAt: new Date().toISOString(),
      result: finalizedResult,
      inputReadAudit: audit,
    };
    updateRun(runId, { roles: rolesAfter });
  }

  // Gate: child must complete successfully before finalization
  if (finalizedResult.status !== 'completed') {
    log.warn({ runId: shortRunId, roleId: role.id, status: finalizedResult.status }, 'Delivery child did not complete, stopping');
    propagateTermination(runId, finalizedResult.status, getFailureReason(finalizedResult));
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

    const rolePrompt = buildRolePrompt(role, goal, artifactDir, artifactAbsDir, round, isReviewer, taskEnvelope?.inputArtifacts || []);

    // V6: Resolve provider for this workspace
    const workspacePath = wsUri.replace(/^file:\/\//, '');
    const provider = resolveProvider('execution', workspacePath).provider;

    // V5.5: Decide whether to reuse an existing cascade or create a new one
    const canReuse = sharedState?.authorCascadeId && !isReviewer && round > 1 && provider === 'antigravity';
    let cascadeId: string;
    let codexResult: { codexThreadId: string; content: string; changedFiles?: string[] } | undefined;

    if (provider === 'codex') {
      // ── Codex MCP mode: synchronous execution via CodexExecutor ──
      const codexExecutor = getExecutor('codex');
      const execResult = await codexExecutor.executeTask({
        workspace: workspacePath,
        prompt: rolePrompt,
        model: finalModel,
        artifactDir,
        runId,
        groupId: input.groupId,
        roleId: role.id,
      });
      cascadeId = execResult.handle || `codex-${randomUUID()}`;
      updateRun(runId, {
        status: 'running',
        childConversationId: cascadeId,
        activeConversationId: cascadeId,
        activeRoleId: role.id,
      });
      codexResult = { codexThreadId: cascadeId, content: execResult.content, changedFiles: execResult.changedFiles };
    } else if (canReuse) {
      // ── Shared mode: send role-switch prompt to existing cascade ──
      cascadeId = sharedState!.authorCascadeId!;
      const switchPrompt = buildRoleSwitchPrompt(role, round, artifactDir, artifactAbsDir, goal, taskEnvelope?.inputArtifacts || []);

      log.info({ runId: shortRunId, roleId: role.id, round, cascadeId: cascadeId.slice(0, 8), mode: 'shared' }, 'Reusing existing cascade for role');

      updateRun(runId, {
        activeConversationId: cascadeId,
        activeRoleId: role.id,
      });

      await grpc.sendMessage(server.port, server.csrf, apiKey, cascadeId, switchPrompt, finalModel, false, undefined, 'ARTIFACT_REVIEW_MODE_TURBO');

      // Estimate tokens: switch prompt + overhead for model response
      sharedState = { ...sharedState!, estimatedTokens: sharedState!.estimatedTokens + switchPrompt.length / 4 + 2000 };
    } else {
      // ── Isolated mode: create new child conversation (existing behavior) ──
      cascadeId = await createAndDispatchChild(
        server, apiKey, wsUri, runId, input.groupId, role.id,
        rolePrompt, finalModel, input.parentConversationId,
      );

      // V5.5: Track the author's cascade for potential reuse in subsequent rounds
      if (sharedState && !isReviewer) {
        sharedState = { ...sharedState, authorCascadeId: cascadeId, estimatedTokens: rolePrompt.length / 4 + 5000 };
      }
    }

    const run = getRun(runId);
    const roles = [...(run?.roles || [])];
    const startedAt = new Date().toISOString();
    const roleProgress: RoleProgress = {
      roleId: role.id,
      round,
      childConversationId: cascadeId,
      status: 'running',
      startedAt,
      promptSnapshot: canReuse ? `[shared-conversation] ${rolePrompt.slice(0, 200)}...` : rolePrompt,
      promptRecordedAt: startedAt,
    };
    roles.push(roleProgress);
    updateRun(runId, { roles, childConversationId: cascadeId });

    // V3.5 Fix: Only start supervisor on the very first role of the first round.
    // The supervisor dynamically tracks activeConversationId across role switches.
    if (round === 1 && i === 0 && provider === 'antigravity') {
      void startSupervisorLoop(runId, cascadeId, goal, apiKey, server, wsUri);
    }

    let steps: any[] = [];
    let result: TaskResult;

    if (provider === 'codex' && codexResult) {
      // ── Codex: result already available from CodexExecutor ──
      log.info({ runId: shortRunId, roleId: role.id, round, provider: 'codex' }, 'Codex role completed (synchronous)');
      const changedFiles = codexResult.changedFiles || [];
      result = {
        status: 'completed',
        summary: codexResult.content,
        changedFiles,
        blockers: [],
        needsReview: changedFiles.length > 0 ? ['code-review'] : [],
      };
    } else {
      // ── Antigravity: watch gRPC stream until complete ──
      log.info({ runId: shortRunId, roleId: role.id, round, cascadeId: cascadeId.slice(0, 8), promptLength: rolePrompt.length }, 'Watching role execution');
      const watchResult = await watchUntilComplete(
        runId, cascadeId, { port: server.port, csrf: server.csrf }, apiKey, role, cascadeId,
      );
      steps = watchResult.steps;
      result = watchResult.result;
    }

    if (!isAuthoritativeConversation(getRun(runId), cascadeId)) {
      log.info({ runId: shortRunId, roleId: role.id, cascadeId: cascadeId.slice(0, 8) }, 'Skipping review-loop writeback for superseded branch');
      return { decision: 'failed', sharedState };
    }
    log.info({ runId: shortRunId, roleId: role.id, round, resultStatus: result.status, summaryLength: result.summary.length, changedFiles: result.changedFiles.length }, 'Role execution completed');

    const audit = buildRoleInputReadAudit(runId, artifactDir, taskEnvelope, steps);
    const finalizedResult = enforceCanonicalInputReadProtocol(role.id, result, audit);
    const rolesAfter = getRun(runId)?.roles || [];
    const roleIdx = rolesAfter.length - 1;
    if (roleIdx >= 0) {
      rolesAfter[roleIdx] = {
        ...rolesAfter[roleIdx],
        status: finalizedResult.status,
        finishedAt: new Date().toISOString(),
        result: finalizedResult,
        inputReadAudit: audit,
      };
      updateRun(runId, { roles: rolesAfter });
    }

    if (finalizedResult.status !== 'completed') {
      log.warn({ runId: shortRunId, roleId: role.id, status: finalizedResult.status }, 'Role did not complete, stopping chain');
      propagateTermination(runId, finalizedResult.status, getFailureReason(finalizedResult));
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

      const rolesDecision = getRun(runId)?.roles || [];
      const decIdx = rolesDecision.length - 1;
      if (decIdx >= 0) {
        rolesDecision[decIdx] = { ...rolesDecision[decIdx], reviewDecision: decision as any };
        updateRun(runId, { roles: rolesDecision });
      }

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

  const { getProject, addRunToProject, trackStageDispatch } = require('./project-registry');
  const project = getProject(run.projectId);
  const template = AssetLoader.getTemplate(templateId);
  if (!project?.pipelineState || !template) return;

  for (const stage of downstreams) {
    const stageId = stage.stageId || stage.groupId;
    const nextStage = project.pipelineState.stages.find((item: any) => item.stageId === stageId);
    if (nextStage?.runId && nextStage.status !== 'pending') {
      log.info({
        runId: shortRunId,
        stageId,
        nextGroupId: stage.groupId,
        existingStatus: nextStage.status,
      }, 'Downstream stage already has a canonical run, skipping auto-trigger');
      continue;
    }

    if (!stage.autoTrigger) {
      log.info({ runId: shortRunId, stageId, nextGroupId: stage.groupId }, 'Downstream stage exists but autoTrigger is false');
      continue;
    }

    if (stage.stageType === 'fan-out' || stage.stageType === 'join') {
      continue;
    }

    const { ready, missingUpstreams } = canActivateStage(template, stage, project.pipelineState);
    if (!ready) {
      log.info({ runId: shortRunId, stageId, missingUpstreams }, 'Downstream stage not ready');
      continue;
    }

    const upstreamStageIds = stage.upstreamStageIds?.length ? stage.upstreamStageIds : [currentStageId];
    const allSourceRunIds = upstreamStageIds
      .map(upstreamStageId => project.pipelineState.stages.find((item: any) => item.stageId === upstreamStageId)?.runId)
      .filter(Boolean) as string[];
    const filteredSourceRunIds = filterSourcesByContract(stage.groupId, allSourceRunIds);

    log.info({
      runId: shortRunId,
      templateId,
      nextGroupId: stage.groupId,
      stageId,
      sourceRunCount: filteredSourceRunIds.length,
    }, 'Auto-triggering downstream pipeline stage');

    try {
      const nextInput: DispatchRunInput = {
        groupId: stage.groupId,
        workspace: input.workspace,
        prompt: stage.promptTemplate || run.prompt,
        model: input.model || run.model,
        projectId: run.projectId,
        sourceRunIds: filteredSourceRunIds,
        pipelineId: templateId,
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
      log.error({ runId: shortRunId, stageId, nextGroupId: stage.groupId, err: err.message }, 'Failed to auto-trigger downstream pipeline stage');
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
// ---------------------------------------------------------------------------
// handleAutoApprove — approve blocking artifacts automatically
// ---------------------------------------------------------------------------

async function handleAutoApprove(
  steps: any[],
  cascadeId: string,
  conn: { port: number; csrf: string },
  apiKey: string,
  runId: string,
): Promise<void> {
  const shortRunId = runId.slice(0, 8);

  for (const step of steps) {
    if (step?.type !== 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') continue;

    const planner = step.plannerResponse || step.response || {};
    const isBlocking = planner.isBlocking === true;
    if (!isBlocking) continue;

    if (step._autoApproved) continue;

    const reviewUris: string[] = [];
    if (planner.reviewAbsoluteUris?.length) {
      reviewUris.push(...planner.reviewAbsoluteUris);
    } else if (planner.pathsToReview?.length) {
      reviewUris.push(...planner.pathsToReview.map((p: string) => `file://${p}`));
    }

    if (reviewUris.length > 0) {
      log.info({ runId: shortRunId, uriCount: reviewUris.length }, 'Auto-approving artifacts');
      for (const uri of reviewUris) {
        try {
          await grpc.proceedArtifact(conn.port, conn.csrf, apiKey, cascadeId, uri);
          log.debug({ runId: shortRunId, uri: uri.split('/').pop() }, 'Artifact approved');
        } catch (err: any) {
          log.warn({ runId: shortRunId, uri, err: err.message }, 'Artifact approve failed');
        }
      }
      step._autoApproved = true;
    } else if (isBlocking) {
      log.info({ runId: shortRunId }, 'Run blocked: isBlocking=true with no artifact URIs');
      updateRun(runId, { status: 'blocked' });
      cleanup(runId);
    }
  }
}

// ---------------------------------------------------------------------------
// handleCompletion — extract result when child goes idle (single-role)
// ---------------------------------------------------------------------------

function handleCompletion(runId: string, steps: any[]): void {
  const shortRunId = runId.slice(0, 8);
  const currentRun = getRun(runId);
  if (!currentRun || currentRun.status !== 'running') return;

  const run = getRun(runId);
  const absDir = run?.artifactDir ? path.join((run.workspace || '').replace(/^file:\/\//, ''), run.artifactDir) : undefined;
  const result = compactCodingResult(steps, absDir);
  log.info({
    runId: shortRunId,
    status: result.status,
    changedFiles: result.changedFiles.length,
    summaryLength: result.summary.length,
    source: absDir ? 'result.json or step-parse' : 'step-parse only',
  }, 'Run completed');

  updateRun(runId, { status: result.status, result });

  // Sync pipeline state for legacy-single runs (same as envelope path)
  if (run?.projectId && (run.pipelineStageId || run.pipelineStageIndex !== undefined)) {
    const { updatePipelineStage, updatePipelineStageByStageId } = require('./project-registry');
    const stageStatus = result.status === 'completed' ? 'completed'
      : result.status === 'blocked' ? 'blocked' : 'failed';
    if (run.pipelineStageId) {
      updatePipelineStageByStageId(run.projectId, run.pipelineStageId, { status: stageStatus, runId });
    } else {
      updatePipelineStage(run.projectId, run.pipelineStageIndex!, { status: stageStatus, runId });
    }
  }

  cleanup(runId);
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

  const activeCascadeId = run.activeConversationId || run.childConversationId;
  if (activeCascadeId) {
    const conn = getOwnerConnection(activeCascadeId);
    const apiKey = getApiKey();
    if (conn && apiKey) {
      await cancelRunInternal(runId, activeCascadeId, conn, apiKey, 'cancelled');
      return;
    }
  }

  if (run.projectId && (run.pipelineStageId || run.pipelineStageIndex !== undefined)) {
    const { updatePipelineStage, updatePipelineStageByStageId } = require('./project-registry');
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
// cancelRunInternal — shared by cancelRun and timeout
// ---------------------------------------------------------------------------

async function cancelRunInternal(
  runId: string,
  cascadeId: string,
  conn: { port: number; csrf: string },
  apiKey: string,
  status: 'cancelled' | 'timeout',
): Promise<void> {
  const shortRunId = runId.slice(0, 8);
  try {
    log.info({ runId: shortRunId, status }, 'Cancelling child cascade');
    await grpc.cancelCascade(conn.port, conn.csrf, apiKey, cascadeId);
  } catch (err: any) {
    log.warn({ runId: shortRunId, err: err.message }, 'Cancel cascade failed (may already be idle)');
  }

  const run = getRun(runId);
  if (status === 'cancelled' && run?.projectId && (run.pipelineStageId || run.pipelineStageIndex !== undefined)) {
    const { updatePipelineStage, updatePipelineStageByStageId } = require('./project-registry');
    if (run.pipelineStageId) {
      updatePipelineStageByStageId(run.projectId, run.pipelineStageId, { status: 'cancelled', runId });
    } else {
      updatePipelineStage(run.projectId, run.pipelineStageIndex!, { status: 'cancelled', runId });
    }
  }
  updateRun(runId, {
    status,
    lastError: status === 'timeout' ? 'Run exceeded timeout limit' : undefined,
  });
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
