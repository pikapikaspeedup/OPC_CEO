import * as fs from 'fs';
import * as path from 'path';

import { getApiKey, getOwnerConnection, grpc, refreshOwnerMap } from '../bridge/gateway';
import type { GroupRoleDefinition, TaskResult } from '../agents/group-types';
import { appendRunHistoryEntry } from '../agents/run-history';
import { compactCodingResult } from '../agents/result-parser';
import { watchConversation, type ConversationWatchState } from '../agents/watch-conversation';
import { createLogger } from '../logger';
import { getExecutor, type ProviderCapabilities } from '../providers';
import { resolveAntigravityRuntimeConnection } from './antigravity-runtime-resolver';
import { ClaudeEngineAgentBackend } from './claude-engine-backend';
import type { GetRecentStepsOptions } from './extensions';
import type {
  AgentBackend,
  AgentBackendCapabilities,
  AgentEvent,
  AgentSession,
  AppendRunRequest,
  BackendRunConfig,
  BackendRunError,
} from './types';
import { hasAgentBackend, registerAgentBackend } from './registry';

const log = createLogger('BuiltinBackends');
const MAX_ANTIGRAVITY_RECONNECT_ATTEMPTS = 30;

function mapCapabilities(capabilities: ProviderCapabilities): AgentBackendCapabilities {
  return {
    supportsAppend: capabilities.supportsMultiTurn && capabilities.supportsStepWatch,
    supportsCancel: true,
    emitsLiveState: capabilities.supportsStepWatch,
    emitsRawSteps: capabilities.supportsStepWatch,
    emitsStreamingText: capabilities.supportsStreaming,
  };
}

function createBackendError(error: Partial<BackendRunError> & Pick<BackendRunError, 'message'>): BackendRunError {
  return {
    code: error.code || 'provider_failed',
    message: error.message,
    retryable: error.retryable ?? true,
    source: error.source || 'backend',
  };
}

function truncateHistoryText(value: string, maxLength = 500): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}…`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  const record = asRecord(error);
  const message = record?.message;
  return typeof message === 'string' ? message : undefined;
}

function firstString(values: unknown[], requireTrimmed = true): string | undefined {
  return values.find((value): value is string => {
    if (typeof value !== 'string') return false;
    return requireTrimmed ? value.trim().length > 0 : value.length > 0;
  });
}

function summarizeAntigravityStep(step: unknown): Record<string, unknown> {
  const stepRecord = asRecord(step) ?? {};
  const plannerResponse = asRecord(stepRecord.plannerResponse);
  const content = asRecord(stepRecord.content);
  const errorMessage = asRecord(stepRecord.errorMessage);
  const taskBoundary = asRecord(stepRecord.taskBoundary);
  const ephemeralMessage = asRecord(stepRecord.ephemeralMessage);
  const message = asRecord(stepRecord.message);
  const toolCall = asRecord(stepRecord.toolCall);
  const plannerPathsToReview = plannerResponse?.pathsToReview;
  const text = firstString([
    plannerResponse?.modifiedResponse,
    plannerResponse?.response,
    content?.text,
    errorMessage?.message,
    taskBoundary?.text,
    ephemeralMessage?.text,
    message?.text,
  ]);

  const location = firstString([
    stepRecord.absolutePath,
    stepRecord.path,
    stepRecord.uri,
    stepRecord.fileUri,
    Array.isArray(plannerPathsToReview) ? plannerPathsToReview[0] : undefined,
  ], false);

  const toolName = firstString([
    toolCall?.toolName,
    stepRecord.toolName,
    stepRecord.tool,
    stepRecord.action,
  ], false);

  return {
    type: stepRecord.type,
    status: stepRecord.status,
    ...(text ? { text: truncateHistoryText(text) } : {}),
    ...(location ? { location } : {}),
    ...(toolName ? { toolName } : {}),
  };
}

function createEventChannel<T>() {
  const items: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;

  const push = (item: T) => {
    if (closed) return;
    const waiter = waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
      return;
    }
    items.push(item);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      waiter?.({ value: undefined as T, done: true });
    }
  };

  async function* iterate(): AsyncIterable<T> {
    while (true) {
      if (items.length > 0) {
        yield items.shift() as T;
        continue;
      }

      if (closed) {
        return;
      }

      const next = await new Promise<IteratorResult<T>>((resolve) => {
        waiters.push(resolve);
      });

      if (next.done) {
        return;
      }

      yield next.value;
    }
  }

  return {
    push,
    close,
    iterate,
  };
}

// ---------------------------------------------------------------------------
// Legacy manual CLI backends
class AntigravityAgentSession implements AgentSession {
  readonly providerId = 'antigravity' as const;
  readonly capabilities: AgentBackendCapabilities;

  private readonly executor = getExecutor('antigravity');
  private readonly channel = createEventChannel<AgentEvent>();
  private readonly artifactAbsDir?: string;
  private abortWatch?: () => void;
  private filePollTimer: ReturnType<typeof setInterval> | null = null;
  private idleDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWasActive = true;
  private reconnectAttempts = 0;
  private terminal = false;
  private cancelled = false;
  private lastPersistedStepCount = 0;

  private constructor(
    readonly runId: string,
    readonly handle: string,
    private readonly config: BackendRunConfig,
    private readonly ownerConnection: { port: number; csrf: string; apiKey?: string },
  ) {
    this.capabilities = mapCapabilities(this.executor.capabilities());
    this.artifactAbsDir = config.artifactDir
      ? path.join(config.workspacePath, config.artifactDir)
      : undefined;
  }

  static async create(config: BackendRunConfig): Promise<AntigravityAgentSession> {
    const executor = getExecutor('antigravity');
    const dispatchResult = await executor.executeTask({
      workspace: config.workspacePath,
      prompt: config.prompt,
      model: config.model,
      artifactDir: config.artifactDir,
      timeout: config.timeoutMs,
      runId: config.runId,
      stageId: config.metadata?.stageId,
      roleId: config.metadata?.roleId,
      parentConversationId: config.parentConversationId,
    });

    const handle = dispatchResult.handle;
    if (!handle) {
      throw new Error('Antigravity backend returned no handle');
    }

    const conn = await getOwnerConnection(handle);
    if (!conn) {
      throw new Error('Unable to resolve prompt conversation owner');
    }

    const session = new AntigravityAgentSession(config.runId, handle, config, conn);
    session.channel.push({
      kind: 'started',
      runId: config.runId,
      providerId: session.providerId,
      handle,
      startedAt: new Date().toISOString(),
    });
    session.startWatch(conn);
    return session;
  }

  static async attach(config: BackendRunConfig, handle: string): Promise<AntigravityAgentSession> {
    const conn = await getOwnerConnection(handle);
    if (!conn) {
      throw new Error('Unable to resolve prompt conversation owner');
    }

    const session = new AntigravityAgentSession(config.runId, handle, config, conn);
    session.channel.push({
      kind: 'started',
      runId: config.runId,
      providerId: session.providerId,
      handle,
      startedAt: new Date().toISOString(),
    });
    session.startWatch(conn);
    return session;
  }

  private async getConnection(): Promise<{ port: number; csrf: string; apiKey?: string }> {
    const connection = await getOwnerConnection(this.handle) || this.ownerConnection;
    return {
      ...connection,
      apiKey: connection.apiKey || this.ownerConnection.apiKey || getApiKey() || undefined,
    };
  }

  private clearFilePoll(): void {
    if (this.filePollTimer) {
      clearInterval(this.filePollTimer);
      this.filePollTimer = null;
    }
  }

  private clearIdleDebounce(): void {
    if (this.idleDebounceTimer) {
      clearTimeout(this.idleDebounceTimer);
      this.idleDebounceTimer = null;
    }
  }

  private closeTerminalState(): void {
    this.clearIdleDebounce();
    this.clearFilePoll();
    this.abortWatch?.();
    this.channel.close();
  }

  private getResultRoleConfig(): GroupRoleDefinition | undefined {
    const roleId = this.config.metadata?.roleId;
    if (!roleId) {
      return undefined;
    }

    return {
      id: roleId,
      workflow: '',
      timeoutMs: this.config.timeoutMs || 0,
      autoApprove: this.config.metadata?.autoApprove || false,
    };
  }

  private hasTerminalErrorSteps(steps: unknown[]): boolean {
    return steps.some((step) => {
      const stepType = asRecord(step)?.type;
      return typeof stepType === 'string'
        && (stepType.includes('ERROR') || stepType.includes('CANCELED'));
    });
  }

  private extractErrorDetails(steps: unknown[]): string | undefined {
    const errorMessages: string[] = [];
    for (let i = steps.length - 1; i >= 0 && errorMessages.length < 3; i--) {
      const step = asRecord(steps[i]);
      if (!step) continue;
      const stepType = typeof step.type === 'string' ? step.type : undefined;
      if (!stepType) continue;
      if (stepType.includes('ERROR_MESSAGE') || stepType.includes('ERROR')) {
        const errorMessage = asRecord(step.errorMessage);
        const content = asRecord(step.content);
        const plannerResponse = asRecord(step.plannerResponse);
        const text = firstString([
          errorMessage?.message,
          content?.text,
          plannerResponse?.modifiedResponse,
          plannerResponse?.response,
        ]);
        if (text) {
          errorMessages.push(text.slice(0, 500));
        } else if (step.status && typeof step.status === 'string' && step.status.includes('ERROR')) {
          errorMessages.push(`Tool error at step ${i}: ${stepType} (${step.status})`);
        }
      }
    }
    return errorMessages.length > 0 ? errorMessages.join(' | ') : undefined;
  }

  private buildAntigravityResult(steps: unknown[]): TaskResult {
    const result = compactCodingResult(steps, this.artifactAbsDir, this.getResultRoleConfig());

    if (this.hasTerminalErrorSteps(steps) && result.status !== 'completed') {
      result.status = 'failed';
      const errorDetail = this.extractErrorDetails(steps);
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

  private emitResult(result: TaskResult, rawSteps: unknown[] = []): void {
    if (this.terminal || this.cancelled) {
      return;
    }

    this.channel.push({
      kind: 'completed',
      runId: this.runId,
      providerId: this.providerId,
      handle: this.handle,
      finishedAt: new Date().toISOString(),
      result,
      rawSteps,
      finalText: result.summary,
    });
    this.terminal = true;
    this.closeTerminalState();
  }

  private emitFailure(message: string, liveState?: ConversationWatchState): void {
    if (this.terminal || this.cancelled) {
      return;
    }

    this.channel.push({
      kind: 'failed',
      runId: this.runId,
      providerId: this.providerId,
      handle: this.handle,
      finishedAt: new Date().toISOString(),
      error: createBackendError({
        code: 'watch_failed',
        message,
        retryable: true,
        source: 'watcher',
      }),
      liveState: liveState ? {
        cascadeStatus: liveState.cascadeStatus,
        stepCount: liveState.stepCount,
        lastStepAt: liveState.lastStepAt,
        lastStepType: liveState.lastStepType,
        staleSince: liveState.staleSince,
      } : undefined,
    });
    this.terminal = true;
    this.closeTerminalState();
  }

  private async handleAutoApprove(state: ConversationWatchState): Promise<void> {
    if (!this.config.metadata?.autoApprove) {
      return;
    }

    const conn = await this.getConnection();
    if (!conn.apiKey) {
      return;
    }

    for (const step of state.steps) {
      if (this.terminal || this.cancelled) {
        return;
      }

      if (step?.type !== 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') continue;

      const planner = step.plannerResponse || step.response || {};
      const isBlocking = planner.isBlocking === true;
      if (!isBlocking || step._autoApproved) continue;

      const reviewUris: string[] = [];
      if (planner.reviewAbsoluteUris?.length) {
        reviewUris.push(...planner.reviewAbsoluteUris);
      } else if (planner.pathsToReview?.length) {
        reviewUris.push(...planner.pathsToReview.map((item: string) => `file://${item}`));
      }

      if (reviewUris.length > 0) {
        for (const uri of reviewUris) {
          try {
            await grpc.proceedArtifact(conn.port, conn.csrf, conn.apiKey, this.handle, uri);
          } catch (err: unknown) {
            log.warn({ runId: this.runId.slice(0, 8), uri, err: getErrorMessage(err) }, 'Artifact auto-approve failed');
          }
        }
        step._autoApproved = true;
        continue;
      }

      this.emitResult({
        status: 'blocked',
        summary: 'Run blocked waiting for artifact approval',
        changedFiles: [],
        blockers: ['Run blocked waiting for artifact approval'],
        needsReview: [],
      }, state.steps);
      return;
    }
  }

  private startFilePoll(): void {
    if (!this.artifactAbsDir || this.filePollTimer) {
      return;
    }

    this.filePollTimer = setInterval(() => {
      if (this.terminal || this.cancelled || !this.artifactAbsDir) {
        return;
      }

      try {
        let completed = false;

        try {
          const deliveryPacket = JSON.parse(
            fs.readFileSync(path.join(this.artifactAbsDir, 'delivery', 'delivery-packet.json'), 'utf-8'),
          );
          if (deliveryPacket?.status === 'completed') {
            completed = true;
          }
        } catch { }

        if (!completed) {
          try {
            const resultJson = JSON.parse(
              fs.readFileSync(path.join(this.artifactAbsDir, 'result.json'), 'utf-8'),
            );
            if (resultJson?.status === 'completed') {
              completed = true;
            }
          } catch { }
        }

        if (completed) {
          this.emitResult(compactCodingResult([], this.artifactAbsDir, this.getResultRoleConfig()), []);
        }
      } catch { }
    }, 3000);
  }

  private scheduleReconnect(fallbackMessage: string): void {
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts >= MAX_ANTIGRAVITY_RECONNECT_ATTEMPTS) {
      this.emitFailure(`Watch stream lost after ${this.reconnectAttempts} reconnect attempts`);
      return;
    }

    setTimeout(async () => {
      if (this.terminal || this.cancelled) {
        return;
      }

      try {
        await refreshOwnerMap();
        const nextConn = await this.getConnection();
        this.abortWatch?.();
        this.startWatch(nextConn);
      } catch (err: unknown) {
        this.emitFailure(getErrorMessage(err) || fallbackMessage);
      }
    }, 3000);
  }

  private emitCompletion(state: ConversationWatchState): void {
    if (this.terminal || this.cancelled) {
      return;
    }

    this.emitResult(this.buildAntigravityResult(state.steps), state.steps);
  }

  private persistNewStepHistory(state: ConversationWatchState): void {
    if (state.steps.length < this.lastPersistedStepCount) {
      this.lastPersistedStepCount = 0;
    }

    for (let index = this.lastPersistedStepCount; index < state.steps.length; index += 1) {
      const step = state.steps[index];
      if (!step) continue;
      appendRunHistoryEntry({
        runId: this.runId,
        provider: this.providerId,
        sessionHandle: this.handle,
        eventType: 'provider.step',
        details: {
          index,
          ...summarizeAntigravityStep(step),
        },
      });
    }

    this.lastPersistedStepCount = state.steps.length;
  }

  private startWatch(conn: { port: number; csrf: string; apiKey?: string }): void {
    this.startFilePoll();
    this.abortWatch = watchConversation(
      conn,
      this.handle,
      async (state: ConversationWatchState) => {
        if (this.terminal || this.cancelled) {
          return;
        }

        this.reconnectAttempts = 0;
        this.persistNewStepHistory(state);
        await this.handleAutoApprove(state);
        if (this.terminal || this.cancelled) {
          return;
        }

        this.channel.push({
          kind: 'live_state',
          runId: this.runId,
          providerId: this.providerId,
          handle: this.handle,
          liveState: {
            cascadeStatus: state.cascadeStatus,
            stepCount: state.stepCount,
            lastStepAt: state.lastStepAt,
            lastStepType: state.lastStepType,
            staleSince: state.staleSince,
          },
        });

        if (state.hasErrorSteps && this.lastWasActive) {
          this.clearIdleDebounce();
          this.idleDebounceTimer = setTimeout(() => {
            this.emitCompletion(state);
          }, 1500);
          this.lastWasActive = false;
          return;
        }

        if (!state.isActive && this.lastWasActive) {
          this.clearIdleDebounce();
          this.idleDebounceTimer = setTimeout(() => {
            this.emitCompletion(state);
          }, 1500);
        } else if (state.isActive && this.idleDebounceTimer) {
          this.clearIdleDebounce();
        }

        this.lastWasActive = state.isActive;
      },
      (err: Error) => {
        if (this.terminal || this.cancelled) {
          return;
        }
        this.scheduleReconnect(err.message);
      },
      conn.apiKey,
    );
  }

  events(): AsyncIterable<AgentEvent> {
    return this.channel.iterate();
  }

  async append(request: AppendRunRequest): Promise<void> {
    if (!this.capabilities.supportsAppend) {
      throw new Error('append_not_supported');
    }

    const conn = await this.getConnection();
    if (!conn.apiKey) {
      throw new Error('No API key available');
    }

    await grpc.sendMessage(
      conn.port,
      conn.csrf,
      conn.apiKey,
      this.handle,
      request.prompt,
      request.model || this.config.model,
    );
  }

  async cancel(reason?: string): Promise<void> {
    if (this.terminal || this.cancelled) {
      return;
    }

    this.cancelled = true;

    try {
      const conn = await this.getConnection();
      if (conn.apiKey) {
        await grpc.cancelCascade(conn.port, conn.csrf, conn.apiKey, this.handle);
      }
    } catch (err: unknown) {
      log.warn({ runId: this.runId.slice(0, 8), err: getErrorMessage(err) }, 'Antigravity cancel raised an error');
    }

    this.channel.push({
      kind: 'cancelled',
      runId: this.runId,
      providerId: this.providerId,
      handle: this.handle,
      finishedAt: new Date().toISOString(),
      reason,
    });
    this.terminal = true;
    this.closeTerminalState();
  }
}

export class AntigravityAgentBackend implements AgentBackend {
  readonly providerId = 'antigravity' as const;

  capabilities(): AgentBackendCapabilities {
    return mapCapabilities(getExecutor('antigravity').capabilities());
  }

  async start(config: BackendRunConfig): Promise<AgentSession> {
    return AntigravityAgentSession.create(config);
  }

  async attach(config: BackendRunConfig, handle: string): Promise<AgentSession> {
    return AntigravityAgentSession.attach(config, handle);
  }

  async getRecentSteps(handle: string, options?: GetRecentStepsOptions): Promise<unknown[]> {
    const conn = await getOwnerConnection(handle);
    const apiKey = conn?.apiKey || getApiKey() || undefined;
    if (!conn || !apiKey) {
      throw new Error('Unable to resolve prompt conversation owner');
    }

    const resp = await grpc.getTrajectorySteps(conn.port, conn.csrf, apiKey, handle);
    const steps = (resp?.steps || []).filter((step: unknown) => step != null);
    if (!options?.limit || options.limit <= 0) {
      return steps;
    }

    return steps.slice(-options.limit);
  }

  async annotateSession(handle: string, annotations: Record<string, unknown>): Promise<void> {
    const conn = await getOwnerConnection(handle);
    const apiKey = conn?.apiKey || getApiKey() || undefined;
    if (!conn || !apiKey) {
      throw new Error('Unable to resolve prompt conversation owner');
    }

    await grpc.updateConversationAnnotations(conn.port, conn.csrf, apiKey, handle, annotations);
  }

  resolveWorkspaceRuntime(workspacePath: string, workspaceUri: string) {
    return resolveAntigravityRuntimeConnection(workspacePath, workspaceUri);
  }
}

export { ClaudeEngineAgentBackend };

let nativeCodexBackend: ClaudeEngineAgentBackend | null = null;
let antigravityBackend: AntigravityAgentBackend | null = null;
let claudeApiBackend: ClaudeEngineAgentBackend | null = null;
let openaiApiBackend: ClaudeEngineAgentBackend | null = null;
let geminiApiBackend: ClaudeEngineAgentBackend | null = null;
let grokApiBackend: ClaudeEngineAgentBackend | null = null;
let customApiBackend: ClaudeEngineAgentBackend | null = null;

export function ensureBuiltInAgentBackends(): void {
  if (!hasAgentBackend('native-codex')) {
    // native-codex is now uniformly routed through Claude Engine.
    nativeCodexBackend ||= new ClaudeEngineAgentBackend('native-codex');
    registerAgentBackend(nativeCodexBackend);
  }

  if (!hasAgentBackend('antigravity')) {
    antigravityBackend ||= new AntigravityAgentBackend();
    registerAgentBackend(antigravityBackend);
  }

  if (!hasAgentBackend('claude-api')) {
    claudeApiBackend ||= new ClaudeEngineAgentBackend('claude-api');
    registerAgentBackend(claudeApiBackend);
  }

  if (!hasAgentBackend('openai-api')) {
    openaiApiBackend ||= new ClaudeEngineAgentBackend('openai-api');
    registerAgentBackend(openaiApiBackend);
  }

  if (!hasAgentBackend('gemini-api')) {
    geminiApiBackend ||= new ClaudeEngineAgentBackend('gemini-api');
    registerAgentBackend(geminiApiBackend);
  }

  if (!hasAgentBackend('grok-api')) {
    grokApiBackend ||= new ClaudeEngineAgentBackend('grok-api');
    registerAgentBackend(grokApiBackend);
  }

  if (!hasAgentBackend('custom')) {
    customApiBackend ||= new ClaudeEngineAgentBackend('custom');
    registerAgentBackend(customApiBackend);
  }

}

// ---------------------------------------------------------------------------
// Explicit context → base instructions converter
// ---------------------------------------------------------------------------

