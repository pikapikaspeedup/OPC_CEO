import * as fs from 'fs';
import * as path from 'path';
import { getOwnerConnection } from '../bridge/gateway';
import { createLogger } from '../logger';
import { getExecutor, resolveProvider, type TaskExecutionResult } from '../providers';
import { AssetLoader } from './asset-loader';
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
import { compactCodingResult } from './result-parser';
import { createRun, getRun, updateRun } from './run-registry';
import { scanArtifactManifest, writeEnvelopeFile } from './run-artifacts';
import { watchConversation, type ConversationWatchState } from './watch-conversation';

const log = createLogger('PromptExecutor');

const PROMPT_STAGE_ID = 'prompt-mode';
const PROMPT_ROLE_ID = 'prompt-executor';

interface ActivePromptRun {
  executor: ReturnType<typeof getExecutor>;
  supportsCancel: boolean;
  handle?: string;
  abortWatch?: () => void;
  cancelRequested?: boolean;
}

const activePromptRuns = new Map<string, ActivePromptRun>();

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

function toTaskResult(result: TaskExecutionResult): TaskResult {
  const content = result.content?.trim();
  return {
    status: result.status,
    summary: content || (result.status === 'completed'
      ? 'Prompt run completed'
      : result.status === 'blocked'
        ? 'Prompt run blocked'
        : 'Prompt run failed'),
    changedFiles: result.changedFiles || [],
    blockers: result.status === 'blocked' && content ? [content] : [],
    needsReview: [],
  };
}

function cleanupPromptRun(runId: string): void {
  const active = activePromptRuns.get(runId);
  if (active?.abortWatch) {
    active.abortWatch();
  }
  activePromptRuns.delete(runId);
}

function getArtifactAbsDir(run: AgentRunState): string | undefined {
  if (!run.artifactDir) return undefined;
  return path.join(run.workspace.replace(/^file:\/\//, ''), run.artifactDir);
}

function writePromptFinalization(
  run: AgentRunState,
  result: TaskResult,
): void {
  const artifactAbsDir = getArtifactAbsDir(run);

  if (!artifactAbsDir) {
    updateRun(run.runId, {
      status: result.status,
      result,
      lastError: result.status === 'completed' ? undefined : result.blockers[0] || result.summary,
    });
    cleanupPromptRun(run.runId);
    return;
  }

  writeEnvelopeFile(artifactAbsDir, 'result.json', {
    status: result.status,
    summary: result.summary,
    changedFiles: result.changedFiles,
    blockedReason: result.blockers[0],
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
    status: result.status,
    summary: result.summary,
    outputArtifacts: manifest.items,
    risks: result.blockers,
    nextAction: result.status === 'completed'
      ? 'Prompt run completed'
      : result.status === 'blocked'
        ? 'Resolve blockers and retry'
        : 'Inspect the failure and retry if appropriate',
  };

  writeEnvelopeFile(artifactAbsDir, 'result-envelope.json', resultEnvelope);

  updateRun(run.runId, {
    status: result.status,
    result,
    resultEnvelope,
    artifactManifestPath: `${run.artifactDir}artifacts.manifest.json`,
    lastError: result.status === 'completed' ? undefined : result.blockers[0] || result.summary,
  });
  cleanupPromptRun(run.runId);
}

function finalizePromptRun(runId: string, result: TaskResult): void {
  const run = getRun(runId);
  if (!run || TERMINAL_STATUSES.has(run.status)) {
    cleanupPromptRun(runId);
    return;
  }
  writePromptFinalization(run, result);
}

function startPromptWatch(
  runId: string,
  cascadeId: string,
  conn: { port: number; csrf: string; apiKey?: string },
): void {
  let lastWasActive = true;
  let idleDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const stopWatching = () => {
    if (idleDebounceTimer) {
      clearTimeout(idleDebounceTimer);
      idleDebounceTimer = null;
    }
    cleanupPromptRun(runId);
  };

  const abortWatch = watchConversation(
    conn,
    cascadeId,
    (state: ConversationWatchState) => {
      const currentRun = getRun(runId);
      if (!currentRun || TERMINAL_STATUSES.has(currentRun.status)) {
        stopWatching();
        return;
      }

      updateRun(runId, {
        liveState: {
          cascadeStatus: state.cascadeStatus,
          stepCount: state.stepCount,
          lastStepAt: state.lastStepAt,
          lastStepType: state.lastStepType,
          staleSince: state.staleSince,
        },
      });

      if (state.hasErrorSteps && lastWasActive) {
        if (idleDebounceTimer) clearTimeout(idleDebounceTimer);
        idleDebounceTimer = setTimeout(() => {
          const latestRun = getRun(runId);
          if (!latestRun || TERMINAL_STATUSES.has(latestRun.status)) {
            stopWatching();
            return;
          }
          finalizePromptRun(runId, compactCodingResult(state.steps, getArtifactAbsDir(latestRun)));
        }, 1500);
        lastWasActive = false;
        return;
      }

      if (!state.isActive && lastWasActive) {
        if (idleDebounceTimer) clearTimeout(idleDebounceTimer);
        idleDebounceTimer = setTimeout(() => {
          const latestRun = getRun(runId);
          if (!latestRun || TERMINAL_STATUSES.has(latestRun.status)) {
            stopWatching();
            return;
          }
          finalizePromptRun(runId, compactCodingResult(state.steps, getArtifactAbsDir(latestRun)));
        }, 1500);
      } else if (state.isActive && idleDebounceTimer) {
        clearTimeout(idleDebounceTimer);
        idleDebounceTimer = null;
      }

      lastWasActive = state.isActive;
    },
    (err: Error) => {
      const run = getRun(runId);
      if (!run || TERMINAL_STATUSES.has(run.status)) {
        stopWatching();
        return;
      }
      updateRun(runId, { status: 'failed', lastError: err.message });
      stopWatching();
    },
    conn.apiKey,
  );

  const active = activePromptRuns.get(runId);
  if (active) {
    active.abortWatch = abortWatch;
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
  const workspacePath = input.workspace.replace(/^file:\/\//, '');
  const resolvedProvider = resolveProvider('execution', workspacePath);
  const model = input.model || resolvedProvider.model || 'MODEL_PLACEHOLDER_M26';
  const executor = getExecutor(resolvedProvider.provider);

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
  });

  const artifactDir = run.projectId
    ? `${ARTIFACT_ROOT_DIR}/projects/${run.projectId}/runs/${run.runId}/`
    : `${ARTIFACT_ROOT_DIR}/runs/${run.runId}/`;
  const artifactAbsDir = path.join(workspacePath, artifactDir);
  if (!fs.existsSync(artifactAbsDir)) {
    fs.mkdirSync(artifactAbsDir, { recursive: true });
  }

  updateRun(run.runId, {
    artifactDir,
    status: 'starting',
    activeRoleId: PROMPT_ROLE_ID,
  });
  writeEnvelopeFile(artifactAbsDir, 'task-envelope.json', taskEnvelope);

  const composedPrompt = buildPromptExecutionPrompt(prompt, executionTarget, artifactDir, artifactAbsDir);
  activePromptRuns.set(run.runId, {
    executor,
    supportsCancel: executor.capabilities().supportsCancel,
  });

  if (resolvedProvider.provider === 'antigravity') {
    try {
      const dispatchResult = await executor.executeTask({
        workspace: workspacePath,
        prompt: composedPrompt,
        model,
        artifactDir,
        runId: run.runId,
        stageId: PROMPT_STAGE_ID,
        roleId: PROMPT_ROLE_ID,
        parentConversationId: input.parentConversationId,
      });

      const active = activePromptRuns.get(run.runId);
      const currentRun = getRun(run.runId);
      if (!currentRun || TERMINAL_STATUSES.has(currentRun.status) || active?.cancelRequested) {
        cleanupPromptRun(run.runId);
        return { runId: run.runId };
      }

      if (active) {
        active.handle = dispatchResult.handle;
      }

      updateRun(run.runId, {
        status: 'running',
        startedAt: new Date().toISOString(),
        childConversationId: dispatchResult.handle,
        activeConversationId: dispatchResult.handle,
        activeRoleId: PROMPT_ROLE_ID,
      });

      const conn = getOwnerConnection(dispatchResult.handle);
      if (!conn) {
        throw new PromptExecutionError('Unable to resolve prompt conversation owner', 500);
      }
      startPromptWatch(run.runId, dispatchResult.handle, conn);
      return { runId: run.runId };
    } catch (err: any) {
      const currentRun = getRun(run.runId);
      if (currentRun && !TERMINAL_STATUSES.has(currentRun.status)) {
        updateRun(run.runId, { status: 'failed', lastError: err.message });
      }
      cleanupPromptRun(run.runId);
      throw err;
    }
  }

  updateRun(run.runId, {
    status: 'running',
    startedAt: new Date().toISOString(),
    activeRoleId: PROMPT_ROLE_ID,
  });

  void executor.executeTask({
    workspace: workspacePath,
    prompt: composedPrompt,
    model,
    artifactDir,
    runId: run.runId,
    stageId: PROMPT_STAGE_ID,
    roleId: PROMPT_ROLE_ID,
    parentConversationId: input.parentConversationId,
  }).then((result: TaskExecutionResult) => {
    const active = activePromptRuns.get(run.runId);
    if (active?.cancelRequested) {
      cleanupPromptRun(run.runId);
      return;
    }
    finalizePromptRun(run.runId, toTaskResult(result));
  }).catch((err: any) => {
    const currentRun = getRun(run.runId);
    if (!currentRun || TERMINAL_STATUSES.has(currentRun.status)) {
      cleanupPromptRun(run.runId);
      return;
    }
    updateRun(run.runId, { status: 'failed', lastError: err.message });
    cleanupPromptRun(run.runId);
  });

  return { runId: run.runId };
}

export async function cancelPromptRun(runId: string): Promise<void> {
  const run = getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (TERMINAL_STATUSES.has(run.status)) {
    throw new Error(`Run ${runId} is already ${run.status}`);
  }

  const active = activePromptRuns.get(runId);
  if (active) {
    active.cancelRequested = true;
    if (active.handle && active.supportsCancel) {
      await active.executor.cancel(active.handle);
    }
    if (active.abortWatch) {
      active.abortWatch();
    }
    activePromptRuns.delete(runId);
  }

  updateRun(runId, { status: 'cancelled' });
}