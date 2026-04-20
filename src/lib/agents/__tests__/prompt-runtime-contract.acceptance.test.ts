import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let runState: Record<string, unknown> | undefined;
let tempGatewayHome: string;
let previousGatewayHome: string | undefined;

const {
  backendStart,
  mockApplyBeforeRunMemoryHooks,
  mockApplyProviderExecutionContext,
  mockAppendRunHistoryEntry,
  mockBuildPromptModeProviderExecutionContext,
  mockConsumeAgentSession,
  mockCreateRun,
  mockCreateRunSessionHooks,
  mockEnsureBuiltInAgentBackends,
  mockFinalizeWorkflowRun,
  mockFormatKnowledgeAssetsForPrompt,
  mockGetAgentBackend,
  mockGetProject,
  mockGetRun,
  mockPersistKnowledgeForRun,
  mockPrepareWorkflowRuntimeContext,
  mockRegisterAgentSession,
  mockResolveCapabilityAwareProvider,
  mockResolveProvider,
  mockRetrieveKnowledgeAssets,
  mockUpdateProject,
  mockUpdateRun,
  mockWriteEnvelopeFile,
} = vi.hoisted(() => {
  const backendStart = vi.fn(async (config: { runId: string }) => ({
    runId: config.runId,
    providerId: 'claude-api',
    handle: 'claude-api-acceptance-session',
    capabilities: {
      supportsAppend: true,
      supportsCancel: true,
      emitsLiveState: false,
      emitsRawSteps: false,
      emitsStreamingText: true,
    },
    async *events(): AsyncIterable<never> {},
    append: async () => undefined,
    cancel: async () => undefined,
  }));

  return {
    backendStart,
    mockApplyBeforeRunMemoryHooks: vi.fn(async (_providerId: string, config: Record<string, unknown>) => config),
    mockApplyProviderExecutionContext: vi.fn((prompt: string, context?: { promptPreamble?: string }) => context?.promptPreamble
      ? `${context.promptPreamble}\n\n${prompt}`
      : prompt),
    mockAppendRunHistoryEntry: vi.fn(),
    mockBuildPromptModeProviderExecutionContext: vi.fn(),
    mockConsumeAgentSession: vi.fn(async () => undefined),
    mockCreateRun: vi.fn(),
    mockCreateRunSessionHooks: vi.fn(() => ({})),
    mockEnsureBuiltInAgentBackends: vi.fn(),
    mockFinalizeWorkflowRun: vi.fn(async (_workflowRef: string, _workspacePath: string, _artifactAbsDir: string, result: unknown) => result),
    mockFormatKnowledgeAssetsForPrompt: vi.fn(() => ''),
    mockGetAgentBackend: vi.fn(() => ({
      providerId: 'claude-api',
      capabilities: () => ({
        supportsAppend: true,
        supportsCancel: true,
        emitsLiveState: false,
        emitsRawSteps: false,
        emitsStreamingText: true,
      }),
      start: backendStart,
    })),
    mockGetProject: vi.fn(() => null),
    mockGetRun: vi.fn(),
    mockPersistKnowledgeForRun: vi.fn(),
    mockPrepareWorkflowRuntimeContext: vi.fn(async () => ({ promptAppendix: '' })),
    mockRegisterAgentSession: vi.fn(),
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
      routingMode: 'preferred' as const,
      reason: `Capability-aware routing kept provider "${options.requestedProvider}"`,
      missingCapabilities: [],
    })),
    mockResolveProvider: vi.fn(() => ({ provider: 'claude-api', model: 'gpt-4.1-mini', source: 'default' })),
    mockRetrieveKnowledgeAssets: vi.fn(() => []),
    mockUpdateProject: vi.fn(),
    mockUpdateRun: vi.fn(),
    mockWriteEnvelopeFile: vi.fn(),
  };
});

async function loadPromptExecutor() {
  vi.resetModules();

  vi.doMock('../run-registry', () => ({
    createRun: (...args: unknown[]) => mockCreateRun(...args),
    getRun: (...args: unknown[]) => mockGetRun(...args),
    updateRun: (...args: unknown[]) => mockUpdateRun(...args),
  }));

  vi.doMock('../../providers', () => ({
    resolveProvider: (...args: unknown[]) => mockResolveProvider(...args),
  }));

  vi.doMock('../../backends', () => ({
    applyBeforeRunMemoryHooks: (...args: unknown[]) => mockApplyBeforeRunMemoryHooks(...args),
    consumeAgentSession: (...args: unknown[]) => mockConsumeAgentSession(...args),
    createRunSessionHooks: (...args: unknown[]) => mockCreateRunSessionHooks(...args),
    ensureBuiltInAgentBackends: (...args: unknown[]) => mockEnsureBuiltInAgentBackends(...args),
    getAgentBackend: (...args: unknown[]) => mockGetAgentBackend(...args),
    getAgentSession: vi.fn(),
    getBackendSessionMetadataExtension: vi.fn(),
    markAgentSessionCancelRequested: vi.fn(),
    registerAgentSession: (...args: unknown[]) => mockRegisterAgentSession(...args),
  }));

  vi.doMock('../department-execution-resolver', () => ({
    applyProviderExecutionContext: (...args: unknown[]) => mockApplyProviderExecutionContext(...args),
    buildPromptModeProviderExecutionContext: (...args: unknown[]) => mockBuildPromptModeProviderExecutionContext(...args),
    resolveCapabilityAwareProvider: (...args: unknown[]) => mockResolveCapabilityAwareProvider(...args),
  }));

  vi.doMock('../workflow-runtime-hooks', () => ({
    finalizeWorkflowRun: (...args: unknown[]) => mockFinalizeWorkflowRun(...args),
    prepareWorkflowRuntimeContext: (...args: unknown[]) => mockPrepareWorkflowRuntimeContext(...args),
  }));

  vi.doMock('../run-artifacts', () => ({
    scanArtifactManifest: vi.fn(() => ({ items: [] })),
    writeEnvelopeFile: (...args: unknown[]) => mockWriteEnvelopeFile(...args),
  }));

  vi.doMock('../run-history', () => ({
    appendRunHistoryEntry: (...args: unknown[]) => mockAppendRunHistoryEntry(...args),
    readRunHistory: vi.fn(() => []),
  }));

  vi.doMock('../project-registry', () => ({
    addRunToProject: vi.fn(),
    getProject: (...args: unknown[]) => mockGetProject(...args),
    updateProject: (...args: unknown[]) => mockUpdateProject(...args),
  }));

  vi.doMock('../asset-loader', () => ({
    AssetLoader: {
      resolveWorkflowContent: vi.fn((workflowRef: string) => workflowRef),
    },
  }));

  vi.doMock('../supervisor', () => ({
    summarizeStepForSupervisor: vi.fn(),
    SUPERVISOR_MODEL: 'MODEL_PLACEHOLDER_SUP',
  }));

  vi.doMock('../../knowledge', () => ({
    formatKnowledgeAssetsForPrompt: (...args: unknown[]) => mockFormatKnowledgeAssetsForPrompt(...args),
    persistKnowledgeForRun: (...args: unknown[]) => mockPersistKnowledgeForRun(...args),
    retrieveKnowledgeAssets: (...args: unknown[]) => mockRetrieveKnowledgeAssets(...args),
  }));

  vi.doMock('../logger', () => ({
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  }));

  return import('../prompt-executor');
}

describe('prompt runtime contract acceptance', () => {
  let tempWorkspace: string;

  beforeEach(() => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prompt-runtime-contract-'));
    tempGatewayHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prompt-runtime-contract-gateway-'));
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.AG_GATEWAY_HOME = tempGatewayHome;
    runState = undefined;

    backendStart.mockClear();
    mockApplyBeforeRunMemoryHooks.mockClear();
    mockApplyProviderExecutionContext.mockClear();
    mockAppendRunHistoryEntry.mockClear();
    mockBuildPromptModeProviderExecutionContext.mockClear();
    mockConsumeAgentSession.mockClear();
    mockCreateRun.mockClear();
    mockCreateRunSessionHooks.mockClear();
    mockEnsureBuiltInAgentBackends.mockClear();
    mockFinalizeWorkflowRun.mockClear();
    mockFormatKnowledgeAssetsForPrompt.mockClear();
    mockGetAgentBackend.mockClear();
    mockGetProject.mockClear();
    mockGetRun.mockClear();
    mockPersistKnowledgeForRun.mockClear();
    mockPrepareWorkflowRuntimeContext.mockClear();
    mockRegisterAgentSession.mockClear();
    mockResolveProvider.mockClear();
    mockRetrieveKnowledgeAssets.mockClear();
    mockUpdateProject.mockClear();
    mockUpdateRun.mockClear();
    mockWriteEnvelopeFile.mockClear();

    mockResolveProvider.mockReturnValue({
      provider: 'claude-api',
      model: 'gpt-4.1-mini',
      source: 'default',
    });

    mockCreateRun.mockImplementation((input: Record<string, unknown>) => {
      runState = {
        runId: 'prompt-runtime-contract-run',
        status: 'queued',
        createdAt: '2026-04-19T00:00:00.000Z',
        ...input,
      };
      return runState;
    });

    mockGetRun.mockImplementation(() => runState);
    mockUpdateRun.mockImplementation((_runId: string, updates: Record<string, unknown>) => {
      runState = {
        ...runState,
        ...updates,
      };
      return runState;
    });

    mockBuildPromptModeProviderExecutionContext.mockImplementation((workspacePath: string) => ({
      promptPreamble: '<department-runtime-contract>acceptance</department-runtime-contract>',
      resolvedWorkflowRef: '/acceptance-audit',
      resolvedSkillRefs: ['department-audit'],
      resolutionReason: 'Injected by acceptance test',
      promptResolution: {
        mode: 'workflow',
        requestedWorkflowRefs: [],
        requestedSkillHints: [],
        matchedWorkflowRefs: ['/acceptance-audit'],
        matchedSkillRefs: ['department-audit'],
        resolutionReason: 'Injected by acceptance test',
      },
      runtimeContract: {
        workspaceRoot: workspacePath,
        additionalWorkingDirectories: [
          path.join(workspacePath, 'docs'),
          path.join(workspacePath, 'specs'),
        ],
        readRoots: [
          workspacePath,
          path.join(workspacePath, 'shared'),
        ],
        writeRoots: [
          path.join(workspacePath, 'src'),
          path.join(workspacePath, 'delivery'),
        ],
        artifactRoot: path.join(workspacePath, '.ag', 'runs', 'prompt-runtime-contract-run'),
        executionClass: 'delivery',
        toolset: 'coding',
        permissionMode: 'acceptEdits',
        requiredArtifacts: [{
          path: 'delivery/acceptance-summary.md',
          required: true,
          format: 'md',
        }],
      },
      toolset: 'coding',
      permissionMode: 'acceptEdits',
      additionalWorkingDirectories: [
        path.join(workspacePath, 'docs'),
        path.join(workspacePath, 'specs'),
      ],
      allowedWriteRoots: [
        path.join(workspacePath, 'src'),
        path.join(workspacePath, 'delivery'),
      ],
      requiredArtifacts: [{
        path: 'delivery/acceptance-summary.md',
        required: true,
        format: 'md',
      }],
    }));
  });

  afterEach(() => {
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    fs.rmSync(tempGatewayHome, { recursive: true, force: true });
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  });

  it('forwards department runtime contract fields into backend.start', async () => {
    const { executePrompt } = await loadPromptExecutor();
    await executePrompt({
      workspace: `file://${tempWorkspace}`,
      prompt: 'Generate an acceptance summary for Phase A',
      executionTarget: { kind: 'prompt' },
      triggerContext: { source: 'ceo-command' },
    });

    expect(backendStart).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'prompt-runtime-contract-run',
      workspacePath: tempWorkspace,
      executionTarget: { kind: 'prompt' },
      triggerContext: { source: 'ceo-command' },
      runtimeContract: expect.objectContaining({
        workspaceRoot: tempWorkspace,
        additionalWorkingDirectories: [
          path.join(tempWorkspace, 'docs'),
          path.join(tempWorkspace, 'specs'),
        ],
        readRoots: [
          tempWorkspace,
          path.join(tempWorkspace, 'shared'),
        ],
        writeRoots: [
          path.join(tempWorkspace, 'src'),
          path.join(tempWorkspace, 'delivery'),
        ],
        executionClass: 'delivery',
        toolset: 'coding',
        permissionMode: 'acceptEdits',
      }),
      toolset: 'coding',
      permissionMode: 'acceptEdits',
      additionalWorkingDirectories: [
        path.join(tempWorkspace, 'docs'),
        path.join(tempWorkspace, 'specs'),
      ],
      allowedWriteRoots: [
        path.join(tempWorkspace, 'src'),
        path.join(tempWorkspace, 'delivery'),
      ],
      requiredArtifacts: [{
        path: 'delivery/acceptance-summary.md',
        required: true,
        format: 'md',
      }],
    }));
  });
});
