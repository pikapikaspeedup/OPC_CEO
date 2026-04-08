import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateRun = vi.fn();
const mockGetRun = vi.fn();
const mockUpdateRun = vi.fn();
const mockResolveProvider = vi.fn();
const mockGetExecutor = vi.fn();
const mockGetOwnerConnection = vi.fn();
const mockScanArtifactManifest = vi.fn();
const mockWriteEnvelopeFile = vi.fn();
const mockWatchConversation = vi.fn();
const mockCompactCodingResult = vi.fn();
const mockResolveWorkflowContent = vi.fn((workflow: string) => `resolved:${workflow}`);

vi.mock('./run-registry', () => ({
  createRun: (...args: any[]) => mockCreateRun(...args),
  getRun: (...args: any[]) => mockGetRun(...args),
  updateRun: (...args: any[]) => mockUpdateRun(...args),
}));

vi.mock('../providers', () => ({
  resolveProvider: (...args: any[]) => mockResolveProvider(...args),
  getExecutor: (...args: any[]) => mockGetExecutor(...args),
}));

vi.mock('../bridge/gateway', () => ({
  getOwnerConnection: (...args: any[]) => mockGetOwnerConnection(...args),
}));

vi.mock('./run-artifacts', () => ({
  scanArtifactManifest: (...args: any[]) => mockScanArtifactManifest(...args),
  writeEnvelopeFile: (...args: any[]) => mockWriteEnvelopeFile(...args),
}));

vi.mock('./watch-conversation', () => ({
  watchConversation: (...args: any[]) => mockWatchConversation(...args),
}));

vi.mock('./result-parser', () => ({
  compactCodingResult: (...args: any[]) => mockCompactCodingResult(...args),
}));

vi.mock('./asset-loader', () => ({
  AssetLoader: {
    resolveWorkflowContent: (...args: any[]) => mockResolveWorkflowContent(...args),
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

import { cancelPromptRun, executePrompt } from './prompt-executor';

describe('prompt-executor', () => {
  let tempWorkspace: string;
  let runState: any;

  beforeEach(() => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prompt-'));
    runState = undefined;

    mockCreateRun.mockReset();
    mockGetRun.mockReset();
    mockUpdateRun.mockReset();
    mockResolveProvider.mockReset();
    mockGetExecutor.mockReset();
    mockGetOwnerConnection.mockReset();
    mockScanArtifactManifest.mockReset();
    mockWriteEnvelopeFile.mockReset();
    mockWatchConversation.mockReset();
    mockCompactCodingResult.mockReset();
    mockResolveWorkflowContent.mockClear();

    mockCreateRun.mockImplementation((input: any) => {
      runState = {
        runId: 'run-1',
        status: 'queued',
        createdAt: '2026-04-08T00:00:00.000Z',
        ...input,
      };
      return runState;
    });

    mockGetRun.mockImplementation(() => runState);
    mockUpdateRun.mockImplementation((_runId: string, updates: any) => {
      runState = { ...runState, ...updates };
      return runState;
    });

    mockScanArtifactManifest.mockReturnValue({
      runId: 'run-1',
      executionTarget: { kind: 'prompt' },
      items: [],
    });
  });

  afterEach(() => {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('creates and finalizes prompt runs through the synchronous executor path', async () => {
    const executor = {
      capabilities: () => ({
        supportsStreaming: false,
        supportsMultiTurn: true,
        supportsIdeSkills: false,
        supportsSandbox: true,
        supportsCancel: false,
        supportsStepWatch: false,
      }),
      executeTask: vi.fn(async () => ({
        handle: 'thread-1',
        content: 'Prompt summary',
        steps: [],
        changedFiles: ['delivery/summary.md'],
        status: 'completed' as const,
      })),
      cancel: vi.fn(async () => undefined),
      appendMessage: vi.fn(),
      providerId: 'codex',
    };

    mockResolveProvider.mockReturnValue({ provider: 'codex', model: 'MODEL_PLACEHOLDER_M47', source: 'default' });
    mockGetExecutor.mockReturnValue(executor);

    const result = await executePrompt({
      workspace: `file://${tempWorkspace}`,
      prompt: '整理今天的 AI 资讯重点',
      executionTarget: {
        kind: 'prompt',
        promptAssetRefs: ['daily-digest'],
        skillHints: ['research'],
      },
      triggerContext: {
        source: 'ceo-command',
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(result).toEqual({ runId: 'run-1' });
    expect(mockCreateRun).toHaveBeenCalledWith(expect.objectContaining({
      stageId: 'prompt-mode',
      executorKind: 'prompt',
      executionTarget: {
        kind: 'prompt',
        promptAssetRefs: ['daily-digest'],
        skillHints: ['research'],
      },
      triggerContext: { source: 'ceo-command' },
    }));
    expect(executor.executeTask).toHaveBeenCalledWith(expect.objectContaining({
      workspace: tempWorkspace,
      model: 'MODEL_PLACEHOLDER_M47',
      prompt: expect.stringContaining('Primary task'),
      stageId: 'prompt-mode',
    }));
    expect(runState.status).toBe('completed');
    expect(runState.resultEnvelope).toEqual(expect.objectContaining({
      status: 'completed',
      summary: 'Prompt summary',
      executionTarget: { kind: 'prompt', promptAssetRefs: ['daily-digest'], skillHints: ['research'] },
    }));
  });

  it('watches antigravity prompt runs to completion', async () => {
    vi.useFakeTimers();
    let onUpdate: ((state: any) => void) | undefined;

    const executor = {
      capabilities: () => ({
        supportsStreaming: true,
        supportsMultiTurn: true,
        supportsIdeSkills: true,
        supportsSandbox: false,
        supportsCancel: true,
        supportsStepWatch: true,
      }),
      executeTask: vi.fn(async () => ({
        handle: 'cascade-1',
        content: '',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      cancel: vi.fn(async () => undefined),
      appendMessage: vi.fn(),
      providerId: 'antigravity',
    };

    mockResolveProvider.mockReturnValue({ provider: 'antigravity', model: 'MODEL_PLACEHOLDER_M26', source: 'default' });
    mockGetExecutor.mockReturnValue(executor);
    mockGetOwnerConnection.mockReturnValue({ port: 1, csrf: 'csrf', apiKey: 'api-key' });
    mockWatchConversation.mockImplementation((_conn: any, _handle: string, update: any) => {
      onUpdate = update;
      return vi.fn();
    });
    mockCompactCodingResult.mockReturnValue({
      status: 'completed',
      summary: 'Watched summary',
      changedFiles: [],
      blockers: [],
      needsReview: [],
    });

    const result = await executePrompt({
      workspace: `file://${tempWorkspace}`,
      prompt: '根据提示完成一次 Prompt Mode 执行',
      executionTarget: { kind: 'prompt' },
    });

    expect(result).toEqual({ runId: 'run-1' });
    expect(runState.childConversationId).toBe('cascade-1');
    expect(typeof onUpdate).toBe('function');
    expect(mockWatchConversation).toHaveBeenCalledWith(
      { port: 1, csrf: 'csrf', apiKey: 'api-key' },
      'cascade-1',
      expect.any(Function),
      expect.any(Function),
      'api-key',
    );

    onUpdate?.({
      steps: [],
      cascadeStatus: 'idle',
      isActive: false,
      hasErrorSteps: false,
      lastTaskBoundary: null,
      stepCount: 0,
      lastStepAt: '2026-04-08T00:00:00.000Z',
    });

    await vi.advanceTimersByTimeAsync(1600);

    expect(runState.status).toBe('completed');
    expect(runState.resultEnvelope).toEqual(expect.objectContaining({
      summary: 'Watched summary',
      status: 'completed',
    }));
  });

  it('marks antigravity prompt runs failed when dispatch throws before a handle is returned', async () => {
    const executor = {
      capabilities: () => ({
        supportsStreaming: true,
        supportsMultiTurn: true,
        supportsIdeSkills: true,
        supportsSandbox: false,
        supportsCancel: true,
        supportsStepWatch: true,
      }),
      executeTask: vi.fn(async () => {
        throw new Error('dispatch failed');
      }),
      cancel: vi.fn(async () => undefined),
      appendMessage: vi.fn(),
      providerId: 'antigravity',
    };

    mockResolveProvider.mockReturnValue({ provider: 'antigravity', model: 'MODEL_PLACEHOLDER_M26', source: 'default' });
    mockGetExecutor.mockReturnValue(executor);

    await expect(executePrompt({
      workspace: `file://${tempWorkspace}`,
      prompt: '这次派发会失败',
      executionTarget: { kind: 'prompt' },
    })).rejects.toThrow('dispatch failed');

    expect(runState.status).toBe('failed');
    expect(runState.lastError).toBe('dispatch failed');
  });

  it('marks prompt runs cancelled and ignores late completion writes', async () => {
    let resolveTask: ((value: any) => void) | undefined;
    const pendingTask = new Promise<any>((resolve) => {
      resolveTask = resolve;
    });

    const executor = {
      capabilities: () => ({
        supportsStreaming: false,
        supportsMultiTurn: true,
        supportsIdeSkills: false,
        supportsSandbox: true,
        supportsCancel: false,
        supportsStepWatch: false,
      }),
      executeTask: vi.fn(() => pendingTask),
      cancel: vi.fn(async () => undefined),
      appendMessage: vi.fn(),
      providerId: 'codex',
    };

    mockResolveProvider.mockReturnValue({ provider: 'codex', model: 'MODEL_PLACEHOLDER_M47', source: 'default' });
    mockGetExecutor.mockReturnValue(executor);

    const result = await executePrompt({
      workspace: `file://${tempWorkspace}`,
      prompt: '这是一个可取消的 prompt run',
      executionTarget: { kind: 'prompt' },
    });

    expect(result).toEqual({ runId: 'run-1' });
    await cancelPromptRun('run-1');
    expect(runState.status).toBe('cancelled');

    resolveTask?.({
      handle: 'thread-1',
      content: 'late result',
      steps: [],
      changedFiles: [],
      status: 'completed',
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(runState.status).toBe('cancelled');
  });
});