import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const importGatewayHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prompt-import-home-'));
const previousImportGatewayHome = process.env.AG_GATEWAY_HOME;
process.env.AG_GATEWAY_HOME = importGatewayHome;

const {
  mockCreateRun,
  mockGetRun,
  mockUpdateRun,
  mockResolveProvider,
  mockGetExecutor,
  mockGetOwnerConnection,
  mockScanArtifactManifest,
  mockWriteEnvelopeFile,
  mockWatchConversation,
  mockCompactCodingResult,
  mockResolveWorkflowContent,
  mockAddRunToProject,
  mockGetProject,
  mockUpdateProject,
  mockApplyProviderExecutionContext,
  mockBuildPromptModeProviderExecutionContext,
  mockResolveCapabilityAwareProvider,
} = vi.hoisted(() => ({
  mockCreateRun: vi.fn(),
  mockGetRun: vi.fn(),
  mockUpdateRun: vi.fn(),
  mockResolveProvider: vi.fn(() => ({ provider: 'codex', model: 'MODEL_PLACEHOLDER_M47', source: 'default' })),
  mockGetExecutor: vi.fn(),
  mockGetOwnerConnection: vi.fn(),
  mockScanArtifactManifest: vi.fn(),
  mockWriteEnvelopeFile: vi.fn(),
  mockWatchConversation: vi.fn(),
  mockCompactCodingResult: vi.fn(),
  mockResolveWorkflowContent: vi.fn((workflow: string) => `resolved:${workflow}`),
  mockAddRunToProject: vi.fn(),
  mockGetProject: vi.fn(),
  mockUpdateProject: vi.fn(),
  mockApplyProviderExecutionContext: vi.fn((prompt: string, context?: { promptPreamble?: string }) => (
    context?.promptPreamble ? `${context.promptPreamble}\n\n${prompt}` : prompt
  )),
  mockBuildPromptModeProviderExecutionContext: vi.fn(() => ({
    promptPreamble: '',
    resolutionReason: 'Prompt Mode injected department identity/rules only; no workflow or skill asset configured.',
    runtimeContract: undefined,
    executionProfile: undefined,
    resolution: undefined,
    resolvedWorkflowRef: undefined,
    resolvedSkillRefs: undefined,
    promptResolution: undefined,
  })),
  mockResolveCapabilityAwareProvider: vi.fn((options: {
    requestedProvider: string;
    requestedModel?: string;
    requiredExecutionClass?: string;
  }) => ({
    requestedProvider: options.requestedProvider,
    selectedProvider: options.requestedProvider,
    requestedModel: options.requestedModel,
    selectedModel: options.requestedModel,
    requiredExecutionClass: options.requiredExecutionClass ?? 'light',
    routingMode: 'preferred',
    reason: `Capability-aware routing kept provider "${options.requestedProvider}"`,
    missingCapabilities: [],
  })),
}));

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

vi.mock('./department-execution-resolver', () => ({
  applyProviderExecutionContext: (...args: any[]) => mockApplyProviderExecutionContext(...args),
  buildPromptModeProviderExecutionContext: (...args: any[]) => mockBuildPromptModeProviderExecutionContext(...args),
  resolveCapabilityAwareProvider: (...args: any[]) => mockResolveCapabilityAwareProvider(...args),
}));

vi.mock('./project-registry', () => ({
  addRunToProject: (...args: any[]) => mockAddRunToProject(...args),
  getProject: (...args: any[]) => mockGetProject(...args),
  updateProject: (...args: any[]) => mockUpdateProject(...args),
}));

vi.mock('../knowledge', () => ({
  retrieveKnowledgeAssets: vi.fn(() => []),
  formatKnowledgeAssetsForPrompt: vi.fn(() => ''),
  persistKnowledgeForRun: vi.fn(),
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
import { registerAgentBackend } from '../backends';
import type { AgentBackend, AgentEvent, AgentSession, BackendRunConfig } from '../backends';

function makeScriptedSession(
  runId: string,
  providerId: 'custom' | 'claude-api',
  handle: string,
  events: AgentEvent[],
): AgentSession {
  return {
    runId,
    providerId,
    handle,
    capabilities: {
      supportsAppend: true,
      supportsCancel: true,
      emitsLiveState: false,
      emitsRawSteps: false,
      emitsStreamingText: false,
    },
    async *events(): AsyncIterable<AgentEvent> {
      for (const event of events) {
        yield event;
      }
    },
    append: async () => undefined,
    cancel: async () => undefined,
  };
}

describe('prompt-executor', () => {
  let tempWorkspace: string;
  let tempGatewayHome: string;
  let previousGatewayHome: string | undefined;
  let runState: any;

  beforeEach(() => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prompt-'));
    tempGatewayHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prompt-home-'));
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.AG_GATEWAY_HOME = tempGatewayHome;
    runState = undefined;
    (globalThis as any).__AGENT_BACKEND_REGISTRY__?.clear();
    (globalThis as any).__AGENT_SESSION_REGISTRY__?.clear();
    (globalThis as any).__AGENT_MEMORY_HOOKS__?.clear();

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
    mockAddRunToProject.mockReset();
    mockGetProject.mockReset();
    mockUpdateProject.mockReset();
    mockApplyProviderExecutionContext.mockReset();
    mockBuildPromptModeProviderExecutionContext.mockReset();
    mockResolveCapabilityAwareProvider.mockReset();

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
    mockApplyProviderExecutionContext.mockImplementation((prompt: string, context?: { promptPreamble?: string }) => (
      context?.promptPreamble ? `${context.promptPreamble}\n\n${prompt}` : prompt
    ));
    mockBuildPromptModeProviderExecutionContext.mockImplementation(() => ({
      promptPreamble: '',
      resolutionReason: 'Prompt Mode injected department identity/rules only; no workflow or skill asset configured.',
      runtimeContract: undefined,
      executionProfile: undefined,
      resolution: undefined,
      resolvedWorkflowRef: undefined,
      resolvedSkillRefs: undefined,
      promptResolution: undefined,
    }));
    mockResolveCapabilityAwareProvider.mockImplementation((options: {
      requestedProvider: string;
      requestedModel?: string;
      requiredExecutionClass?: string;
    }) => ({
      requestedProvider: options.requestedProvider,
      selectedProvider: options.requestedProvider,
      requestedModel: options.requestedModel,
      selectedModel: options.requestedModel,
      requiredExecutionClass: options.requiredExecutionClass ?? 'light',
      routingMode: 'preferred',
      reason: `Capability-aware routing kept provider "${options.requestedProvider}"`,
      missingCapabilities: [],
    }));

    mockScanArtifactManifest.mockReturnValue({
      runId: 'run-1',
      executionTarget: { kind: 'prompt' },
      items: [],
    });
    mockGetProject.mockReturnValue(null);
  });

  afterEach(() => {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
    fs.rmSync(tempGatewayHome, { recursive: true, force: true });
    if (previousGatewayHome === undefined) {
      delete process.env.AG_GATEWAY_HOME;
    } else {
      process.env.AG_GATEWAY_HOME = previousGatewayHome;
    }
    vi.useRealTimers();
  });

  afterAll(() => {
    fs.rmSync(importGatewayHome, { recursive: true, force: true });
    if (previousImportGatewayHome === undefined) {
      delete process.env.AG_GATEWAY_HOME;
    } else {
      process.env.AG_GATEWAY_HOME = previousImportGatewayHome;
    }
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

    await new Promise((resolve) => setTimeout(resolve, 0));

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
    expect(mockCreateRun.mock.calls[0]?.[0]?.templateId).toBeUndefined();
    expect(mockCreateRun.mock.calls[0]?.[0]?.pipelineStageId).toBeUndefined();
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

  it('forwards runtime carrier from taskEnvelope into backend config', async () => {
    const seenConfigs: BackendRunConfig[] = [];
    const backend: AgentBackend = {
      providerId: 'custom',
      capabilities: () => ({
        supportsAppend: true,
        supportsCancel: true,
        emitsLiveState: false,
        emitsRawSteps: false,
        emitsStreamingText: false,
      }),
      start: vi.fn(async (config) => {
        seenConfigs.push(config);
        return makeScriptedSession(config.runId, 'custom', 'custom-session', [
          {
            kind: 'started',
            runId: config.runId,
            providerId: 'custom',
            handle: 'custom-session',
            startedAt: '2026-04-10T00:00:00.000Z',
          },
          {
            kind: 'completed',
            runId: config.runId,
            providerId: 'custom',
            handle: 'custom-session',
            finishedAt: '2026-04-10T00:00:01.000Z',
            result: {
              status: 'completed',
              summary: 'done',
              changedFiles: [],
              blockers: [],
              needsReview: [],
            },
            finalText: 'done',
          },
        ]);
      }),
    };
    registerAgentBackend(backend);
    mockResolveProvider.mockReturnValue({ provider: 'custom', model: 'MODEL_PLACEHOLDER_M47', source: 'default' });

    const executionProfile = {
      kind: 'workflow-run' as const,
      workflowRef: '/ai_digest',
      skillHints: ['research'],
    };
    const departmentRuntimeContract = {
      workspaceRoot: tempWorkspace,
      toolset: 'research',
      additionalWorkingDirectories: ['/tmp/shared-context'],
      readRoots: ['/tmp/reference'],
    };

    await executePrompt({
      workspace: `file://${tempWorkspace}`,
      prompt: '整理今天的 AI 资讯重点',
      taskEnvelope: {
        executionProfile,
        departmentRuntimeContract,
      } as any,
      executionTarget: { kind: 'prompt' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seenConfigs[0]).toEqual(expect.objectContaining({
      executionProfile,
      runtimeContract: expect.objectContaining({
        toolset: 'research',
        additionalWorkingDirectories: ['/tmp/shared-context'],
        readRoots: ['/tmp/reference'],
      }),
    }));
  });

  it('falls back from native-codex to claude-api for artifact-heavy Department prompt runs', async () => {
    const seenConfigs: BackendRunConfig[] = [];
    const backend: AgentBackend = {
      providerId: 'claude-api',
      capabilities: () => ({
        supportsAppend: true,
        supportsCancel: true,
        emitsLiveState: false,
        emitsRawSteps: false,
        emitsStreamingText: false,
      }),
      start: vi.fn(async (config) => {
        seenConfigs.push(config);
        return makeScriptedSession(config.runId, 'claude-api', 'claude-api-session', [
          {
            kind: 'started',
            runId: config.runId,
            providerId: 'claude-api',
            handle: 'claude-api-session',
            startedAt: '2026-04-10T00:00:00.000Z',
          },
          {
            kind: 'completed',
            runId: config.runId,
            providerId: 'claude-api',
            handle: 'claude-api-session',
            finishedAt: '2026-04-10T00:00:01.000Z',
            result: {
              status: 'completed',
              summary: 'done',
              changedFiles: [],
              blockers: [],
              needsReview: [],
            },
            finalText: 'done',
          },
        ]);
      }),
    };
    registerAgentBackend(backend);
    mockResolveProvider.mockReturnValue({ provider: 'native-codex', model: 'gpt-5.4', source: 'department' });
    mockResolveCapabilityAwareProvider.mockReturnValue({
      requestedProvider: 'native-codex',
      selectedProvider: 'claude-api',
      requestedModel: 'gpt-5.4',
      selectedModel: 'claude-sonnet-4-20250514',
      requiredExecutionClass: 'artifact-heavy',
      routingMode: 'fallback',
      reason: 'Capability-aware routing moved artifact-heavy work from "native-codex" to "claude-api"',
      missingCapabilities: ['supportsDepartmentRuntime', 'supportsToolRuntime'],
    });

    await executePrompt({
      workspace: `file://${tempWorkspace}`,
      prompt: '产出完整交付物并写入工件目录',
      taskEnvelope: {
        departmentRuntimeContract: {
          workspaceRoot: tempWorkspace,
          additionalWorkingDirectories: [],
          readRoots: [tempWorkspace],
          writeRoots: [tempWorkspace],
          artifactRoot: path.join(tempWorkspace, '.artifacts'),
          executionClass: 'artifact-heavy',
          toolset: 'coding',
          permissionMode: 'acceptEdits',
        },
      } as any,
      executionTarget: { kind: 'prompt' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runState.provider).toBe('claude-api');
    expect(runState.resolutionReason).toContain('Capability-aware routing moved artifact-heavy work from "native-codex" to "claude-api"');
    expect(seenConfigs[0]).toEqual(expect.objectContaining({
      model: 'claude-sonnet-4-20250514',
      resolution: expect.objectContaining({
        requestedProvider: 'native-codex',
        routedProvider: 'claude-api',
        requiredExecutionClass: 'artifact-heavy',
      }),
    }));
  });

  it('links prompt runs to an ad-hoc project and completes standalone project status', async () => {
    const project = {
      projectId: 'proj-1',
      status: 'active',
      pipelineState: undefined,
    };
    mockGetProject.mockReturnValue(project);

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
        changedFiles: [],
        status: 'completed' as const,
      })),
      cancel: vi.fn(async () => undefined),
      appendMessage: vi.fn(),
      providerId: 'codex',
    };

    mockResolveProvider.mockReturnValue({ provider: 'codex', model: 'MODEL_PLACEHOLDER_M47', source: 'default' });
    mockGetExecutor.mockReturnValue(executor);

    await executePrompt({
      workspace: `file://${tempWorkspace}`,
      prompt: '整理今天的 AI 资讯重点',
      projectId: 'proj-1',
      executionTarget: { kind: 'prompt' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockAddRunToProject).toHaveBeenCalledWith('proj-1', 'run-1');
    expect(mockUpdateProject).toHaveBeenCalledWith('proj-1', { status: 'completed' });
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

    await Promise.resolve();
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
    await Promise.resolve();
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
