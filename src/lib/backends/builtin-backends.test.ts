import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetExecutor,
  mockGetApiKey,
  mockGetOwnerConnection,
  mockRefreshOwnerMap,
  mockGrpcSendMessage,
  mockGrpcCancelCascade,
  mockGrpcProceedArtifact,
  mockWatchConversation,
  mockCompactCodingResult,
} = vi.hoisted(() => ({
  mockGetExecutor: vi.fn(),
  mockGetApiKey: vi.fn(),
  mockGetOwnerConnection: vi.fn(),
  mockRefreshOwnerMap: vi.fn(),
  mockGrpcSendMessage: vi.fn(),
  mockGrpcCancelCascade: vi.fn(),
  mockGrpcProceedArtifact: vi.fn(),
  mockWatchConversation: vi.fn(),
  mockCompactCodingResult: vi.fn(),
}));

vi.mock('../providers', () => ({
  getExecutor: (...args: any[]) => mockGetExecutor(...args),
}));

vi.mock('../bridge/gateway', () => ({
  getApiKey: (...args: any[]) => mockGetApiKey(...args),
  getOwnerConnection: (...args: any[]) => mockGetOwnerConnection(...args),
  refreshOwnerMap: (...args: any[]) => mockRefreshOwnerMap(...args),
  grpc: {
    sendMessage: (...args: any[]) => mockGrpcSendMessage(...args),
    cancelCascade: (...args: any[]) => mockGrpcCancelCascade(...args),
    proceedArtifact: (...args: any[]) => mockGrpcProceedArtifact(...args),
  },
}));

vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../agents/watch-conversation', () => ({
  watchConversation: (...args: any[]) => mockWatchConversation(...args),
}));

vi.mock('../agents/result-parser', () => ({
  compactCodingResult: (...args: any[]) => mockCompactCodingResult(...args),
}));

import {
  AntigravityAgentBackend,
  CodexAgentBackend,
  clearAgentBackends,
  ensureBuiltInAgentBackends,
  listAgentBackends,
} from './index';
import type { AgentEvent, AgentSession, BackendRunConfig } from './types';

async function collectEvents(session: AgentSession): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.events()) {
    events.push(event);
  }
  return events;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const codexCapabilities = {
  supportsStreaming: false,
  supportsMultiTurn: true,
  supportsIdeSkills: false,
  supportsSandbox: true,
  supportsCancel: false,
  supportsStepWatch: false,
};

const antigravityCapabilities = {
  supportsStreaming: true,
  supportsMultiTurn: true,
  supportsIdeSkills: true,
  supportsSandbox: false,
  supportsCancel: true,
  supportsStepWatch: true,
};

function makeConfig(runId: string): BackendRunConfig {
  return {
    runId,
    workspacePath: '/tmp/workspace',
    prompt: '执行任务',
    model: 'MODEL_PLACEHOLDER_M26',
    artifactDir: '.ag/runs/run-1/',
    metadata: {
      stageId: 'prompt-mode',
      roleId: 'prompt-executor',
      executorKind: 'prompt',
    },
  };
}

describe('builtin-backends', () => {
  beforeEach(() => {
    clearAgentBackends();
    mockGetExecutor.mockReset();
    mockGetApiKey.mockReset();
    mockGetOwnerConnection.mockReset();
    mockRefreshOwnerMap.mockReset();
    mockGrpcSendMessage.mockReset();
    mockGrpcCancelCascade.mockReset();
    mockGrpcProceedArtifact.mockReset();
    mockWatchConversation.mockReset();
    mockCompactCodingResult.mockReset();
    mockGetApiKey.mockReturnValue('api-key');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits started then completed for Codex sessions', async () => {
    const executor = {
      capabilities: () => codexCapabilities,
      executeTask: vi.fn(async () => ({
        handle: 'codex-thread-1',
        content: 'codex done',
        steps: [],
        changedFiles: ['delivery/result.md'],
        status: 'completed' as const,
      })),
      appendMessage: vi.fn(async () => ({
        handle: 'codex-thread-1',
        content: 'follow-up',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      cancel: vi.fn(async () => undefined),
    };
    mockGetExecutor.mockReturnValue(executor);

    const backend = new CodexAgentBackend();
    const session = await backend.start(makeConfig('run-1'));
    const events = await collectEvents(session);

    expect(session.capabilities.supportsAppend).toBe(false);
    expect(events.map((event) => event.kind)).toEqual(['started', 'completed']);
    expect(executor.executeTask).toHaveBeenCalledWith(expect.objectContaining({
      workspace: '/tmp/workspace',
      prompt: '执行任务',
      model: 'MODEL_PLACEHOLDER_M26',
      runId: 'run-1',
    }));
    expect(events[1]).toEqual(expect.objectContaining({
      kind: 'completed',
      result: expect.objectContaining({
        status: 'completed',
        summary: 'codex done',
        changedFiles: ['delivery/result.md'],
      }),
    }));
    await expect(session.append({ prompt: '继续执行' })).rejects.toThrow('append_not_supported');
  });

  it('emits cancelled once and suppresses late Codex completion after cancel', async () => {
    const task = deferred<any>();
    const executor = {
      capabilities: () => codexCapabilities,
      executeTask: vi.fn(() => task.promise),
      appendMessage: vi.fn(),
      cancel: vi.fn(async () => undefined),
    };
    mockGetExecutor.mockReturnValue(executor);

    const backend = new CodexAgentBackend();
    const session = await backend.start(makeConfig('run-2'));
    const eventsPromise = collectEvents(session);

    await Promise.resolve();
    await session.cancel('cancelled_by_user');
    task.resolve({
      handle: 'codex-thread-2',
      content: 'too late',
      steps: [],
      changedFiles: [],
      status: 'completed' as const,
    });

    const events = await eventsPromise;
    expect(events.map((event) => event.kind)).toEqual(['started', 'cancelled']);
  });

  it('emits live_state updates and completion for Antigravity sessions', async () => {
    vi.useFakeTimers();
    let onUpdate: ((state: any) => void) | undefined;
    const executor = {
      capabilities: () => antigravityCapabilities,
      executeTask: vi.fn(async () => ({
        handle: 'cascade-1',
        content: '',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      appendMessage: vi.fn(async () => ({
        handle: 'cascade-1',
        content: '',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      cancel: vi.fn(async () => undefined),
    };
    mockGetExecutor.mockReturnValue(executor);
    mockGetOwnerConnection.mockReturnValue({ port: 1, csrf: 'csrf', apiKey: 'api-key' });
    mockCompactCodingResult.mockReturnValue({
      status: 'completed',
      summary: 'watched summary',
      changedFiles: [],
      blockers: [],
      needsReview: [],
    });
    mockWatchConversation.mockImplementation((_conn: any, _handle: string, update: any) => {
      onUpdate = update;
      return vi.fn();
    });

    const backend = new AntigravityAgentBackend();
    const session = await backend.start(makeConfig('run-3'));
    const eventsPromise = collectEvents(session);

    onUpdate?.({
      steps: [],
      cascadeStatus: 'running',
      isActive: true,
      hasErrorSteps: false,
      lastTaskBoundary: null,
      stepCount: 1,
      lastStepAt: '2026-04-08T00:00:00.000Z',
      lastStepType: 'PLANNER_RESPONSE',
    });
    onUpdate?.({
      steps: [],
      cascadeStatus: 'idle',
      isActive: false,
      hasErrorSteps: false,
      lastTaskBoundary: null,
      stepCount: 1,
      lastStepAt: '2026-04-08T00:00:02.000Z',
      lastStepType: 'PLANNER_RESPONSE',
    });

    await vi.advanceTimersByTimeAsync(1600);

    const events = await eventsPromise;
    expect(events.map((event) => event.kind)).toEqual(['started', 'live_state', 'live_state', 'completed']);
    expect(events[3]).toEqual(expect.objectContaining({
      kind: 'completed',
      result: expect.objectContaining({
        status: 'completed',
        summary: 'watched summary',
      }),
    }));
  });

  it('rejects Antigravity startup when the owner connection cannot be resolved', async () => {
    const executor = {
      capabilities: () => antigravityCapabilities,
      executeTask: vi.fn(async () => ({
        handle: 'cascade-1',
        content: '',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      appendMessage: vi.fn(),
      cancel: vi.fn(async () => undefined),
    };
    mockGetExecutor.mockReturnValue(executor);
    mockGetOwnerConnection.mockReturnValue(undefined);

    const backend = new AntigravityAgentBackend();

    await expect(backend.start(makeConfig('run-4'))).rejects.toThrow('Unable to resolve prompt conversation owner');
  });

  it('forwards Antigravity append with workspace fallback', async () => {
    const executor = {
      capabilities: () => antigravityCapabilities,
      executeTask: vi.fn(async () => ({
        handle: 'cascade-1',
        content: '',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      appendMessage: vi.fn(),
      cancel: vi.fn(async () => undefined),
    };
    mockGetExecutor.mockReturnValue(executor);
    mockGetOwnerConnection.mockReturnValue({ port: 1, csrf: 'csrf', apiKey: 'api-key' });
    mockWatchConversation.mockReturnValue(vi.fn());

    const backend = new AntigravityAgentBackend();
    const session = await backend.start(makeConfig('run-5'));

    await session.append({ prompt: '继续执行' });
    await session.cancel('stop');

    expect(mockGrpcSendMessage).toHaveBeenCalledWith(
      1,
      'csrf',
      'api-key',
      'cascade-1',
      '继续执行',
      'MODEL_PLACEHOLDER_M26',
    );
    expect(mockGrpcCancelCascade).toHaveBeenCalledWith(1, 'csrf', 'api-key', 'cascade-1');
  });

  it('attaches to an existing Antigravity handle without starting a new execution', async () => {
    const executor = {
      capabilities: () => antigravityCapabilities,
      executeTask: vi.fn(async () => ({
        handle: 'cascade-new',
        content: '',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      appendMessage: vi.fn(),
      cancel: vi.fn(async () => undefined),
    };
    mockGetExecutor.mockReturnValue(executor);
    mockGetOwnerConnection.mockReturnValue({ port: 1, csrf: 'csrf', apiKey: 'api-key' });
    mockWatchConversation.mockReturnValue(vi.fn());

    const backend = new AntigravityAgentBackend();
    const session = await backend.attach(makeConfig('run-5b'), 'cascade-existing');
    const iterator = session.events()[Symbol.asyncIterator]();
    const started = await iterator.next();

    await session.append({ prompt: '继续执行 attach' });
    await session.cancel('stop');
    await iterator.next();

    expect(started.value).toEqual(expect.objectContaining({
      kind: 'started',
      handle: 'cascade-existing',
    }));
    expect(executor.executeTask).not.toHaveBeenCalled();
    expect(mockGrpcSendMessage).toHaveBeenCalledWith(
      1,
      'csrf',
      'api-key',
      'cascade-existing',
      '继续执行 attach',
      'MODEL_PLACEHOLDER_M26',
    );
  });

  it('attaches to an existing Codex handle without starting a new execution', async () => {
    const executor = {
      capabilities: () => codexCapabilities,
      executeTask: vi.fn(async () => ({
        handle: 'codex-thread-new',
        content: 'done',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      appendMessage: vi.fn(),
      cancel: vi.fn(async () => undefined),
    };
    mockGetExecutor.mockReturnValue(executor);

    const backend = new CodexAgentBackend();
    const session = await backend.attach(makeConfig('run-5c'), 'codex-thread-existing');
    const iterator = session.events()[Symbol.asyncIterator]();
    const started = await iterator.next();

    await session.cancel('stop');
    const cancelled = await iterator.next();

    expect(started.value).toEqual(expect.objectContaining({
      kind: 'started',
      handle: 'codex-thread-existing',
    }));
    expect(cancelled.value).toEqual(expect.objectContaining({
      kind: 'cancelled',
      handle: 'codex-thread-existing',
      reason: 'stop',
    }));
    expect(executor.executeTask).not.toHaveBeenCalled();
    expect(executor.cancel).toHaveBeenCalledWith('codex-thread-existing');
  });

  it('auto-approves blocking artifacts when the backend metadata enables it', async () => {
    vi.useFakeTimers();
    let onUpdate: ((state: any) => void) | undefined;
    const executor = {
      capabilities: () => antigravityCapabilities,
      executeTask: vi.fn(async () => ({
        handle: 'cascade-1',
        content: '',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      appendMessage: vi.fn(),
      cancel: vi.fn(async () => undefined),
    };
    mockGetExecutor.mockReturnValue(executor);
    mockGetOwnerConnection.mockReturnValue({ port: 1, csrf: 'csrf', apiKey: 'api-key' });
    mockWatchConversation.mockImplementation((_conn: any, _handle: string, update: any) => {
      onUpdate = update;
      return vi.fn();
    });
    mockGrpcProceedArtifact.mockResolvedValue(undefined);

    const backend = new AntigravityAgentBackend();
    const session = await backend.start({
      ...makeConfig('run-6'),
      metadata: {
        ...makeConfig('run-6').metadata,
        autoApprove: true,
      },
    });
    const eventsPromise = collectEvents(session);

    onUpdate?.({
      steps: [{
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: {
          isBlocking: true,
          reviewAbsoluteUris: ['file:///tmp/review.md'],
        },
      }],
      cascadeStatus: 'running',
      isActive: true,
      hasErrorSteps: false,
      lastTaskBoundary: null,
      stepCount: 1,
      lastStepAt: '2026-04-09T00:00:00.000Z',
      lastStepType: 'PLANNER_RESPONSE',
    });

    await Promise.resolve();
    await session.cancel('stop');
    await eventsPromise;

    expect(mockGrpcProceedArtifact).toHaveBeenCalledWith(
      1,
      'csrf',
      'api-key',
      'cascade-1',
      'file:///tmp/review.md',
    );
  });

  it('completes from artifact files even without watcher updates', async () => {
    vi.useFakeTimers();
    const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-backend-filepoll-'));
    const executor = {
      capabilities: () => antigravityCapabilities,
      executeTask: vi.fn(async () => ({
        handle: 'cascade-1',
        content: '',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      appendMessage: vi.fn(),
      cancel: vi.fn(async () => undefined),
    };
    mockGetExecutor.mockReturnValue(executor);
    mockGetOwnerConnection.mockReturnValue({ port: 1, csrf: 'csrf', apiKey: 'api-key' });
    mockWatchConversation.mockReturnValue(vi.fn());
    mockCompactCodingResult.mockReturnValue({
      status: 'completed',
      summary: 'artifact completion',
      changedFiles: [],
      blockers: [],
      needsReview: [],
    });

    const backend = new AntigravityAgentBackend();
    const session = await backend.start({
      ...makeConfig('run-7'),
      workspacePath: tempWorkspace,
      artifactDir: '.ag/runs/run-7/',
    });
    const eventsPromise = collectEvents(session);

    fs.mkdirSync(path.join(tempWorkspace, '.ag/runs/run-7/'), { recursive: true });
    fs.writeFileSync(
      path.join(tempWorkspace, '.ag/runs/run-7/', 'result.json'),
      JSON.stringify({ status: 'completed' }),
    );

    await vi.advanceTimersByTimeAsync(3100);

    const events = await eventsPromise;
    fs.rmSync(tempWorkspace, { recursive: true, force: true });

    expect(events.map((event) => event.kind)).toEqual(['started', 'completed']);
    expect(events[1]).toEqual(expect.objectContaining({
      kind: 'completed',
      result: expect.objectContaining({ summary: 'artifact completion' }),
    }));
  });

  it('refreshes owner routing and reconnects when the watch stream drops', async () => {
    vi.useFakeTimers();
    const initialConn = { port: 1, csrf: 'csrf-1', apiKey: 'api-key' };
    let latestConn = initialConn;
    const errorHandlers: Array<(err: Error) => void> = [];
    const executor = {
      capabilities: () => antigravityCapabilities,
      executeTask: vi.fn(async () => ({
        handle: 'cascade-1',
        content: '',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      appendMessage: vi.fn(),
      cancel: vi.fn(async () => undefined),
    };
    mockGetExecutor.mockReturnValue(executor);
    mockGetOwnerConnection.mockImplementation(() => latestConn);
    mockRefreshOwnerMap.mockResolvedValue(undefined);
    mockWatchConversation.mockImplementation((conn: any, _handle: string, _update: any, onError: any) => {
      errorHandlers.push(onError);
      return vi.fn();
    });

    const backend = new AntigravityAgentBackend();
    const session = await backend.start(makeConfig('run-8'));

    latestConn = { port: 2, csrf: 'csrf-2', apiKey: 'api-key' };
    errorHandlers[0]?.(new Error('stream lost'));
    await vi.advanceTimersByTimeAsync(3100);
    await session.cancel('stop');

    expect(mockRefreshOwnerMap).toHaveBeenCalled();
    expect(mockWatchConversation).toHaveBeenNthCalledWith(
      2,
      { port: 2, csrf: 'csrf-2', apiKey: 'api-key' },
      'cascade-1',
      expect.any(Function),
      expect.any(Function),
      'api-key',
    );
  });

  it('forces failed completion when Antigravity ends with terminal error steps and no completed result', async () => {
    vi.useFakeTimers();
    let onUpdate: ((state: any) => void) | undefined;
    const executor = {
      capabilities: () => antigravityCapabilities,
      executeTask: vi.fn(async () => ({
        handle: 'cascade-err',
        content: '',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      appendMessage: vi.fn(),
      cancel: vi.fn(async () => undefined),
    };
    mockGetExecutor.mockReturnValue(executor);
    mockGetOwnerConnection.mockReturnValue({ port: 1, csrf: 'csrf', apiKey: 'api-key' });
    mockCompactCodingResult.mockReturnValue({
      status: 'blocked',
      summary: 'Task completed (no summary extracted)',
      changedFiles: [],
      blockers: [],
      needsReview: [],
    });
    mockWatchConversation.mockImplementation((_conn: any, _handle: string, update: any) => {
      onUpdate = update;
      return vi.fn();
    });

    const backend = new AntigravityAgentBackend();
    const session = await backend.start({
      ...makeConfig('run-9'),
      metadata: {
        ...makeConfig('run-9').metadata,
        roleId: 'delivery-author',
      },
    });
    const eventsPromise = collectEvents(session);

    onUpdate?.({
      steps: [{ type: 'CORTEX_STEP_TYPE_CANCELED' }],
      cascadeStatus: 'idle',
      isActive: false,
      hasErrorSteps: true,
      lastTaskBoundary: null,
      stepCount: 1,
      lastStepAt: '2026-04-09T00:00:00.000Z',
      lastStepType: 'CANCELED',
    });

    await vi.advanceTimersByTimeAsync(1600);

    const events = await eventsPromise;
    expect(mockCompactCodingResult).toHaveBeenCalledWith(
      [{ type: 'CORTEX_STEP_TYPE_CANCELED' }],
      expect.any(String),
      expect.objectContaining({ id: 'delivery-author' }),
    );
    expect(events.at(-1)).toEqual(expect.objectContaining({
      kind: 'completed',
      result: expect.objectContaining({
        status: 'failed',
        summary: 'Child conversation ended with tool errors',
      }),
    }));
  });

  it('registers built-in backends idempotently', () => {
    const codexExecutor = {
      capabilities: () => codexCapabilities,
      executeTask: vi.fn(),
      appendMessage: vi.fn(),
      cancel: vi.fn(),
    };
    const antigravityExecutor = {
      capabilities: () => antigravityCapabilities,
      executeTask: vi.fn(),
      appendMessage: vi.fn(),
      cancel: vi.fn(),
    };
    mockGetExecutor.mockImplementation((provider: string) => provider === 'codex' ? codexExecutor : antigravityExecutor);

    ensureBuiltInAgentBackends();
    ensureBuiltInAgentBackends();

    expect(listAgentBackends()).toHaveLength(2);
  });
});
