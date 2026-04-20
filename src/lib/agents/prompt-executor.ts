import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { resolveProvider } from '../providers';
import type { ProviderId } from '../providers/types';
import { AssetLoader } from './asset-loader';
import {
  applyProviderExecutionContext,
  buildPromptModeProviderExecutionContext,
  resolveCapabilityAwareProvider,
} from './department-execution-resolver';
import { ARTIFACT_ROOT_DIR } from './gateway-home';
import type {
  AgentRunState,
  PromptExecutionTarget,
  ResultEnvelope,
  TaskEnvelope,
  TaskResult,
  TriggerContext,
} from './group-types';
import { TERMINAL_STATUSES } from './group-types';
import { addRunToProject, getProject, updateProject } from './project-registry';
import { createRun, getRun, updateRun } from './run-registry';
import { appendRunHistoryEntry } from './run-history';
import { readRunHistory } from './run-history';
import { scanArtifactManifest, writeEnvelopeFile } from './run-artifacts';
import { finalizeWorkflowRun, prepareWorkflowRuntimeContext } from './workflow-runtime-hooks';
import {
  applyBeforeRunMemoryHooks,
  type BackendRunConfig,
  consumeAgentSession,
  createRunSessionHooks,
  ensureBuiltInAgentBackends,
  getAgentBackend,
  getAgentSession,
  getBackendSessionMetadataExtension,
  markAgentSessionCancelRequested,
  registerAgentSession,
} from '../backends';
import type { DepartmentRuntimeContract } from '../organization/contracts';
import type { CompletedAgentEvent, FailedAgentEvent, CancelledAgentEvent } from '../backends';
import { isExecutionProfile, type ExecutionProfile } from '../execution/contracts';
import type { SupervisorDecision, SupervisorReview } from './group-types';
import { summarizeStepForSupervisor, SUPERVISOR_MODEL } from './supervisor';
import {
  formatKnowledgeAssetsForPrompt,
  persistKnowledgeForRun,
  retrieveKnowledgeAssets,
} from '../knowledge';

const PROMPT_STAGE_ID = 'prompt-mode';
const PROMPT_ROLE_ID = 'prompt-executor';

type PromptRuntimeCarrier = {
  executionProfile?: ExecutionProfile;
  departmentRuntimeContract?: DepartmentRuntimeContract;
  runtimeContract?: DepartmentRuntimeContract;
};

export interface ExecutePromptInput {
  workspace: string;
  prompt?: string;
  model?: string;
  parentConversationId?: string;
  taskEnvelope?: Partial<TaskEnvelope>;
  sourceRunIds?: string[];
  projectId?: string;
  executionTarget?: PromptExecutionTarget;
  triggerContext?: TriggerContext;
}

export interface ExecutePromptResult {
  runId: string;
}

export class PromptExecutionError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'PromptExecutionError';
    this.statusCode = statusCode;
  }
}

function normalizePromptExecutionTarget(
  target?: PromptExecutionTarget,
): PromptExecutionTarget {
  return {
    kind: 'prompt',
    ...(target?.promptAssetRefs?.length
      ? { promptAssetRefs: target.promptAssetRefs.filter(Boolean) }
      : {}),
    ...(target?.skillHints?.length
      ? { skillHints: target.skillHints.filter(Boolean) }
      : {}),
  };
}

function buildPromptTaskEnvelope(
  input: ExecutePromptInput,
  executionTarget: PromptExecutionTarget,
): TaskEnvelope {
  const base = input.taskEnvelope ? { ...input.taskEnvelope } : {};
  const goal = base.goal || input.prompt;
  if (!goal) {
    throw new PromptExecutionError('Either prompt or taskEnvelope.goal is required');
  }

  return {
    ...base,
    goal,
    executionTarget,
  };
}

function extractPromptRuntimeCarrier(
  taskEnvelope?: Partial<TaskEnvelope>,
): {
  executionProfile?: ExecutionProfile;
  runtimeContract?: DepartmentRuntimeContract;
} {
  const carrier = taskEnvelope as (Partial<TaskEnvelope> & PromptRuntimeCarrier) | undefined;
  return {
    executionProfile: isExecutionProfile(carrier?.executionProfile)
      ? carrier.executionProfile
      : undefined,
    runtimeContract: carrier?.departmentRuntimeContract ?? carrier?.runtimeContract,
  };
}

function mergeRuntimeContract(
  base?: DepartmentRuntimeContract,
  override?: DepartmentRuntimeContract,
): DepartmentRuntimeContract | undefined {
  if (!base && !override) return undefined;
  return {
    ...(base || {}),
    ...(override || {}),
    ...(override?.additionalWorkingDirectories
      ? { additionalWorkingDirectories: override.additionalWorkingDirectories }
      : {}),
    ...(override?.readRoots ? { readRoots: override.readRoots } : {}),
    ...(override?.writeRoots ? { writeRoots: override.writeRoots } : {}),
    ...(override?.requiredArtifacts ? { requiredArtifacts: override.requiredArtifacts } : {}),
  } as DepartmentRuntimeContract;
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

function joinResolutionReasons(...parts: Array<string | undefined>): string | undefined {
  const normalized = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  if (normalized.length === 0) {
    return undefined;
  }

  return normalized.join(' ');
}

function resolvePromptAssetContent(ref: string): string {
  const normalizedRef = ref.startsWith('/') ? ref : `/${ref}`;
  const content = AssetLoader.resolveWorkflowContent(normalizedRef);
  return content === normalizedRef ? ref : content;
}

function buildPromptExecutionPrompt(
  prompt: string,
  executionTarget: PromptExecutionTarget,
  artifactDir: string,
  artifactAbsDir: string,
): string {
  const sections: string[] = [
    '[Prompt Mode Execution]',
    'You are executing a prompt-driven task without a fixed pipeline template.',
    '',
    'Run context',
    `- Relative artifact directory: ${artifactDir}`,
    `- Absolute artifact directory: ${artifactAbsDir}`,
    '- Workspace root: use the current workspace root as cwd.',
    '- If you create files, prefer writing them under this run artifact directory unless the task explicitly requires workspace edits.',
  ];

  if (executionTarget.promptAssetRefs?.length) {
    sections.push('', 'Playbook context');
    for (const ref of executionTarget.promptAssetRefs) {
      sections.push(`### Playbook: ${ref}`);
      sections.push(resolvePromptAssetContent(ref));
    }
  }

  if (executionTarget.skillHints?.length) {
    sections.push('', 'Skill hints');
    for (const hint of executionTarget.skillHints) {
      sections.push(`- ${hint}`);
    }
  }

  sections.push('', 'Primary task', prompt);

  return sections.join('\n');
}

function getArtifactAbsDir(run: AgentRunState): string | undefined {
  if (!run.artifactDir) return undefined;
  return path.join(run.workspace.replace(/^file:\/\//, ''), run.artifactDir);
}

function syncStandaloneProjectStatus(run: AgentRunState, result: TaskResult): void {
  if (!run.projectId) return;

  const project = getProject(run.projectId);
  if (!project || project.pipelineState) {
    return;
  }

  const nextStatus = result.status === 'completed'
    ? 'completed'
    : result.status === 'cancelled'
      ? 'cancelled'
      : result.status === 'failed' || result.status === 'timeout'
        ? 'failed'
        : 'active';

  updateProject(run.projectId, { status: nextStatus });
}

function writePromptFinalization(
  run: AgentRunState,
  result: TaskResult,
): void {
  const resultWithResolution: TaskResult = run.promptResolution && !result.promptResolution
    ? { ...result, promptResolution: run.promptResolution }
    : result;
  const artifactAbsDir = getArtifactAbsDir(run);

  if (!artifactAbsDir) {
    updateRun(run.runId, {
      status: resultWithResolution.status,
      result: resultWithResolution,
      lastError: resultWithResolution.status === 'completed' ? undefined : resultWithResolution.blockers[0] || resultWithResolution.summary,
    });
    return;
  }

  writeEnvelopeFile(artifactAbsDir, 'result.json', {
    status: resultWithResolution.status,
    summary: resultWithResolution.summary,
    changedFiles: resultWithResolution.changedFiles,
    blockedReason: resultWithResolution.blockers[0],
    promptResolution: resultWithResolution.promptResolution,
    reportedEventDate: resultWithResolution.reportedEventDate,
    reportedEventCount: resultWithResolution.reportedEventCount,
    verificationPassed: resultWithResolution.verificationPassed,
    reportApiResponse: resultWithResolution.reportApiResponse,
  });

  const manifest = scanArtifactManifest(
    run.runId,
    run.templateId,
    artifactAbsDir,
    run.executionTarget,
  );
  writeEnvelopeFile(artifactAbsDir, 'artifacts.manifest.json', manifest);

  const resultEnvelope: ResultEnvelope = {
    templateId: run.templateId,
    executionTarget: run.executionTarget,
    runId: run.runId,
    status: resultWithResolution.status,
    summary: resultWithResolution.summary,
    outputArtifacts: manifest.items,
    risks: resultWithResolution.blockers,
    nextAction: resultWithResolution.status === 'completed'
      ? 'Prompt run completed'
      : resultWithResolution.status === 'blocked'
        ? 'Resolve blockers and retry'
        : 'Inspect the failure and retry if appropriate',
    promptResolution: resultWithResolution.promptResolution,
    reportedEventDate: resultWithResolution.reportedEventDate,
    reportedEventCount: resultWithResolution.reportedEventCount,
    verificationPassed: resultWithResolution.verificationPassed,
    reportApiResponse: resultWithResolution.reportApiResponse,
  };

  writeEnvelopeFile(artifactAbsDir, 'result-envelope.json', resultEnvelope);

  updateRun(run.runId, {
    status: resultWithResolution.status,
    result: resultWithResolution,
    resultEnvelope,
    artifactManifestPath: `${run.artifactDir}artifacts.manifest.json`,
    lastError: resultWithResolution.status === 'completed' ? undefined : resultWithResolution.blockers[0] || resultWithResolution.summary,
    reportedEventDate: resultWithResolution.reportedEventDate,
    reportedEventCount: resultWithResolution.reportedEventCount,
    verificationPassed: resultWithResolution.verificationPassed,
    reportApiResponse: resultWithResolution.reportApiResponse,
  });

  syncStandaloneProjectStatus(run, resultWithResolution);
}

async function finalizePromptRun(runId: string, result: TaskResult): Promise<void> {
  const run = getRun(runId);
  if (!run || TERMINAL_STATUSES.has(run.status)) {
    return;
  }
  const artifactAbsDir = getArtifactAbsDir(run);
  if (!artifactAbsDir) {
    writePromptFinalization(run, result);
    return;
  }

  appendRunHistoryEntry({
    runId,
    provider: run.provider,
    sessionHandle: run.sessionProvenance?.handle,
    eventType: 'workflow.finalize.started',
    details: {
      resolvedWorkflowRef: run.resolvedWorkflowRef,
      artifactAbsDir,
    },
  });
  const finalizedResult = await finalizeWorkflowRun(
    run.resolvedWorkflowRef,
    run.workspace.replace(/^file:\/\//, ''),
    artifactAbsDir,
    result,
  );
  appendRunHistoryEntry({
    runId,
    provider: run.provider,
    sessionHandle: run.sessionProvenance?.handle,
    eventType: 'workflow.finalize.completed',
    details: {
      status: finalizedResult.status,
      summary: finalizedResult.summary,
      reportedEventDate: finalizedResult.reportedEventDate,
      reportedEventCount: finalizedResult.reportedEventCount,
      verificationPassed: finalizedResult.verificationPassed,
    },
  });
  writePromptFinalization(run, finalizedResult);
  const updatedRun = getRun(runId);
  if (updatedRun?.workspace) {
    persistKnowledgeForRun({
      runId,
      workspaceUri: updatedRun.workspace,
      result: finalizedResult,
      promptResolution: updatedRun.promptResolution,
      resolvedWorkflowRef: updatedRun.resolvedWorkflowRef,
      resolvedSkillRefs: updatedRun.resolvedSkillRefs,
      createdAt: updatedRun.finishedAt || updatedRun.createdAt,
    });
  }
}

export async function executePrompt(
  input: ExecutePromptInput,
): Promise<ExecutePromptResult> {
  const prompt = input.prompt || input.taskEnvelope?.goal;
  if (!prompt) {
    throw new PromptExecutionError('Either prompt or taskEnvelope.goal is required');
  }
  if (!input.workspace) {
    throw new PromptExecutionError('Missing required field: workspace');
  }

  const executionTarget = normalizePromptExecutionTarget(input.executionTarget);
  const taskEnvelope = buildPromptTaskEnvelope({ ...input, prompt }, executionTarget);
  const runtimeCarrier = extractPromptRuntimeCarrier(taskEnvelope);
  const workspacePath = input.workspace.replace(/^file:\/\//, '');
  const executionContext = buildPromptModeProviderExecutionContext(workspacePath, {
    ...executionTarget,
    promptText: prompt,
  });
  const effectiveExecutionProfile = runtimeCarrier.executionProfile ?? executionContext.executionProfile;
  const effectiveRuntimeContract = mergeRuntimeContract(
    executionContext.runtimeContract,
    runtimeCarrier.runtimeContract,
  );
  const requestedProvider = resolveProvider('execution', workspacePath);
  const providerRouting = resolveCapabilityAwareProvider({
    workspacePath,
    requestedProvider: requestedProvider.provider as ProviderId,
    requestedModel: requestedProvider.model,
    explicitModel: Boolean(input.model),
    runtimeContract: effectiveRuntimeContract,
    executionProfile: effectiveExecutionProfile,
  });
  const provider = providerRouting.selectedProvider;
  const model = input.model || providerRouting.selectedModel || requestedProvider.model || 'MODEL_PLACEHOLDER_M26';
  const effectiveResolution = {
    ...(executionContext.resolution ?? {}),
    requestedProvider: providerRouting.requestedProvider,
    routedProvider: providerRouting.selectedProvider,
    providerRoutingReason: providerRouting.reason,
    requiredExecutionClass: providerRouting.requiredExecutionClass,
  };
  const effectiveResolutionReason = joinResolutionReasons(
    executionContext.resolutionReason,
    providerRouting.reason,
  );

  const run = createRun({
    stageId: PROMPT_STAGE_ID,
    workspace: input.workspace,
    prompt,
    model,
    parentConversationId: input.parentConversationId,
    taskEnvelope,
    sourceRunIds: input.sourceRunIds,
    projectId: input.projectId,
    executorKind: 'prompt',
    executionTarget,
    triggerContext: input.triggerContext,
    provider,
    resolvedWorkflowRef: executionContext.resolvedWorkflowRef,
    resolvedSkillRefs: executionContext.resolvedSkillRefs,
    resolutionReason: effectiveResolutionReason,
    promptResolution: executionContext.promptResolution,
  });

  if (input.projectId) {
    addRunToProject(input.projectId, run.runId);
  }

  const artifactDir = run.projectId
    ? `${ARTIFACT_ROOT_DIR}/projects/${run.projectId}/runs/${run.runId}/`
    : `${ARTIFACT_ROOT_DIR}/runs/${run.runId}/`;
  const artifactAbsDir = path.join(workspacePath, artifactDir);
  const runtimeContractForRun = bindRuntimeContractToArtifactRoot(
    effectiveRuntimeContract,
    artifactAbsDir,
  );
  if (!fs.existsSync(artifactAbsDir)) {
    fs.mkdirSync(artifactAbsDir, { recursive: true });
  }

  updateRun(run.runId, {
    artifactDir,
    status: 'starting',
    activeRoleId: PROMPT_ROLE_ID,
    provider,
    resolvedWorkflowRef: executionContext.resolvedWorkflowRef,
    resolvedSkillRefs: executionContext.resolvedSkillRefs,
    resolutionReason: effectiveResolutionReason,
    promptResolution: executionContext.promptResolution,
  });
  writeEnvelopeFile(artifactAbsDir, 'task-envelope.json', taskEnvelope);

  appendRunHistoryEntry({
    runId: run.runId,
    provider,
    eventType: 'workflow.preflight.started',
    details: {
      resolvedWorkflowRef: executionContext.resolvedWorkflowRef,
      artifactAbsDir,
    },
  });
  const preparedWorkflowContext = await prepareWorkflowRuntimeContext(
    executionContext.resolvedWorkflowRef,
    workspacePath,
    artifactAbsDir,
  );
  appendRunHistoryEntry({
    runId: run.runId,
    provider,
    eventType: 'workflow.preflight.completed',
    details: {
      resolvedWorkflowRef: executionContext.resolvedWorkflowRef,
      promptAppendixLength: preparedWorkflowContext.promptAppendix.length,
    },
  });

  const retrievedKnowledgeAssets = retrieveKnowledgeAssets({
    workspaceUri: input.workspace,
    promptText: prompt,
    workflowRef: executionContext.resolvedWorkflowRef,
    skillHints: executionTarget.skillHints,
    limit: 5,
  });
  const retrievedKnowledgeSection = formatKnowledgeAssetsForPrompt(retrievedKnowledgeAssets);
  if (retrievedKnowledgeAssets.length > 0) {
    appendRunHistoryEntry({
      runId: run.runId,
      provider,
      eventType: 'knowledge.retrieval.injected',
      details: {
        assetIds: retrievedKnowledgeAssets.map((asset) => asset.id),
        count: retrievedKnowledgeAssets.length,
      },
    });
  }

  const composedPrompt = applyProviderExecutionContext(
    [
      buildPromptExecutionPrompt(prompt, executionTarget, artifactDir, artifactAbsDir),
      preparedWorkflowContext.promptAppendix,
      retrievedKnowledgeSection,
    ].filter(Boolean).join('\n\n'),
    executionContext,
  );
  ensureBuiltInAgentBackends();

  try {
    const backend = getAgentBackend(provider);
    const backendConfig = await applyBeforeRunMemoryHooks(provider, {
      runId: run.runId,
      workspacePath,
      prompt: composedPrompt,
      model,
      artifactDir,
      parentConversationId: input.parentConversationId,
      executionTarget,
      triggerContext: input.triggerContext,
      metadata: {
        projectId: input.projectId,
        stageId: PROMPT_STAGE_ID,
        roleId: PROMPT_ROLE_ID,
        executorKind: 'prompt',
      },
      ...(effectiveExecutionProfile
        ? { executionProfile: effectiveExecutionProfile }
        : {}),
      resolution: effectiveResolution,
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
    void consumeAgentSession(run.runId, session, createRunSessionHooks({
      runId: run.runId,
      activeRoleId: PROMPT_ROLE_ID,
      backendConfig,
      bindConversationHandleForProviders: ['antigravity'],
      onCompleted: async (event) => {
        await finalizePromptRun(run.runId, event.result);
      },
    }));

    return { runId: run.runId };
  } catch (err: unknown) {
    const currentRun = getRun(run.runId);
    if (!currentRun || TERMINAL_STATUSES.has(currentRun.status)) {
      throw err;
    }
    const message = err instanceof Error ? err.message : 'Unknown prompt execution error';
    updateRun(run.runId, { status: 'failed', lastError: message });
    throw err;
  }
}

export async function cancelPromptRun(runId: string): Promise<void> {
  const run = getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (TERMINAL_STATUSES.has(run.status)) {
    throw new Error(`Run ${runId} is already ${run.status}`);
  }

  const active = getAgentSession(runId);
  if (active) {
    markAgentSessionCancelRequested(runId);
    await active.session.cancel('cancelled_by_user');
  }

  updateRun(runId, { status: 'cancelled' });
}

function extractPromptRunEvaluationResponse(
  completed: CompletedAgentEvent | null,
  failed: FailedAgentEvent | null,
  cancelled: CancelledAgentEvent | null,
): string {
  if (failed) return failed.error.message;
  if (cancelled) return cancelled.reason || 'Evaluation cancelled';
  if (completed?.finalText?.trim()) return completed.finalText;

  const rawSteps = completed?.rawSteps as Array<Record<string, unknown>> | undefined;
  if (!rawSteps?.length) return '';
  for (let i = rawSteps.length - 1; i >= 0; i--) {
    const step = rawSteps[i];
    const planner = step?.plannerResponse as { modifiedResponse?: string; response?: string } | undefined;
    const text = planner?.modifiedResponse || planner?.response || '';
    if (text) return text;
  }
  return '';
}

export async function evaluatePromptRun(runId: string): Promise<{ status: 'evaluated'; action: 'evaluate' }> {
  const run = getRun(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const workspacePath = run.workspace.replace(/^file:\/\//, '');
  const goal = run.taskEnvelope?.goal || run.prompt;
  const recentActions = readRunHistory(runId)
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

  const recentStepsText = recentActions.length > 0
    ? recentActions.map(summarizeStepForSupervisor).join('\n')
    : 'No conversation data available.';

  const evalPrompt = `[Prompt Run Diagnostic Assessment]
Task Goal: ${goal}

Current State:
- Status: ${run.status}
- Provider: ${run.provider || 'unknown'}
- Last Error: ${run.lastError || 'none'}

Recent Actions (last 12 steps):
${recentStepsText}

Please analyze this run and provide:
1. What the prompt run was trying to do
2. What went wrong (if failed)
3. Whether a retry is likely to succeed
4. Recommended action

Reply with ONLY a JSON object: {"status": "HEALTHY|STUCK|LOOPING|DONE", "analysis": "detailed diagnosis"}`;

  ensureBuiltInAgentBackends();
  const configuredSupervisorProvider = resolveProvider('supervisor', workspacePath).provider;
  const evalProvider: ProviderId = configuredSupervisorProvider === 'antigravity' && run.provider && run.provider !== 'antigravity'
    ? run.provider as ProviderId
    : configuredSupervisorProvider;
  const evalBackend = getAgentBackend(evalProvider);
  const evalSessionRunId = `prompt-eval-${runId}-${randomUUID()}`;
  const evalConfig = await applyBeforeRunMemoryHooks(evalProvider, {
    runId: evalSessionRunId,
    workspacePath,
    prompt: evalPrompt,
    model: SUPERVISOR_MODEL,
    executionTarget: { kind: 'prompt' },
    metadata: {
      projectId: run.projectId,
      stageId: PROMPT_STAGE_ID,
      roleId: 'prompt-evaluate',
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

  const responseText = extractPromptRunEvaluationResponse(evalCompleted, evalFailed, evalCancelled);

  let decision: SupervisorDecision;
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
    decision = jsonMatch ? JSON.parse(jsonMatch[0]) : { status: 'STUCK', analysis: responseText.slice(0, 500) };
    if (!['HEALTHY', 'STUCK', 'LOOPING', 'DONE'].includes(decision.status)) {
      decision.status = 'STUCK';
    }
  } catch {
    decision = { status: 'STUCK', analysis: `(Parse failed) ${responseText.slice(0, 500)}` };
  }

  const review: SupervisorReview = {
    id: `eval-${Date.now()}`,
    timestamp: new Date().toISOString(),
    round: -1,
    stepCount: recentActions.length,
    decision,
  };

  const currentRun = getRun(runId);
  if (currentRun) {
    const reviews = [...(currentRun.supervisorReviews || []), review];
    updateRun(runId, { supervisorReviews: reviews });
  }

  return { status: 'evaluated', action: 'evaluate' };
}
