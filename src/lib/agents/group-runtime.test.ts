import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDiscoverLanguageServers,
  mockGetApiKey,
  mockRefreshOwnerMap,
  mockPreRegisterOwner,
  mockGetOwnerConnection,
  mockGrpc,
  mockCreateRun,
  mockUpdateRun,
  mockGetRun,
  mockWatchConversation,
  mockResolveWorkflowContent,
  mockResolveProvider,
  mockGetExecutor,
  mockGetStageDefinition,
  mockCheckTokenQuota,
  mockShouldAutoRequestQuota,
  mockSubmitApprovalRequest,
  mockUpdatePipelineStage,
  mockUpdatePipelineStageByStageId,
  mockGetProject,
  mockAddRunToProject,
  mockTrackStageDispatch,
  mockEmitProjectEvent,
  mockCancelCascadeBestEffort,
  mockGetCanonicalTaskEnvelope,
  mockBuildRoleInputReadAudit,
  mockEnforceCanonicalInputReadProtocol,
  mockApplyProviderExecutionContext,
  mockBuildTemplateProviderExecutionContext,
  mockResolveCapabilityAwareProvider,
} = vi.hoisted(() => ({
  mockDiscoverLanguageServers: vi.fn(),
  mockGetApiKey: vi.fn(),
  mockRefreshOwnerMap: vi.fn(),
  mockPreRegisterOwner: vi.fn(),
  mockGetOwnerConnection: vi.fn(),
  mockGrpc: {
    addTrackedWorkspace: vi.fn(),
    startCascade: vi.fn(),
    updateConversationAnnotations: vi.fn(),
    sendMessage: vi.fn(),
    cancelCascade: vi.fn(),
    getTrajectorySteps: vi.fn(),
  },
  mockCreateRun: vi.fn(),
  mockUpdateRun: vi.fn(),
  mockGetRun: vi.fn(),
  mockWatchConversation: vi.fn(),
  mockResolveWorkflowContent: vi.fn((workflow: string) => `resolved:${workflow}`),
  mockResolveProvider: vi.fn(),
  mockGetExecutor: vi.fn(),
  mockGetStageDefinition: vi.fn(),
  mockCheckTokenQuota: vi.fn(),
  mockShouldAutoRequestQuota: vi.fn(),
  mockSubmitApprovalRequest: vi.fn(),
  mockUpdatePipelineStage: vi.fn(),
  mockUpdatePipelineStageByStageId: vi.fn(),
  mockGetProject: vi.fn(),
  mockAddRunToProject: vi.fn(),
  mockTrackStageDispatch: vi.fn(),
  mockEmitProjectEvent: vi.fn(),
  mockCancelCascadeBestEffort: vi.fn(),
  mockGetCanonicalTaskEnvelope: vi.fn(),
  mockBuildRoleInputReadAudit: vi.fn(),
  mockEnforceCanonicalInputReadProtocol: vi.fn(),
  mockApplyProviderExecutionContext: vi.fn((prompt: string, context?: { promptPreamble?: string }) => (
    context?.promptPreamble ? `${context.promptPreamble}\n\n${prompt}` : prompt
  )),
  mockBuildTemplateProviderExecutionContext: vi.fn((workspacePath: string, templateId: string) => ({
    promptPreamble: '',
    resolutionReason: `template context for ${templateId}`,
    runtimeContract: undefined,
    executionProfile: undefined,
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

vi.mock('../bridge/gateway', () => ({
  discoverLanguageServers: (...args: any[]) => mockDiscoverLanguageServers(...args),
  getApiKey: (...args: any[]) => mockGetApiKey(...args),
  refreshOwnerMap: (...args: any[]) => mockRefreshOwnerMap(...args),
  preRegisterOwner: (...args: any[]) => mockPreRegisterOwner(...args),
  getOwnerConnection: (...args: any[]) => mockGetOwnerConnection(...args),
  grpc: mockGrpc,
}));

vi.mock('./run-registry', () => ({
  createRun: (...args: any[]) => mockCreateRun(...args),
  updateRun: (...args: any[]) => mockUpdateRun(...args),
  getRun: (...args: any[]) => mockGetRun(...args),
}));

vi.mock('./watch-conversation', () => ({
  watchConversation: (...args: any[]) => mockWatchConversation(...args),
}));

vi.mock('./asset-loader', () => ({
  AssetLoader: {
    resolveWorkflowContent: (...args: any[]) => mockResolveWorkflowContent(...args),
    getTemplate: vi.fn(),
  },
}));

vi.mock('./department-execution-resolver', () => ({
  applyProviderExecutionContext: (...args: any[]) => mockApplyProviderExecutionContext(...args),
  buildTemplateProviderExecutionContext: (...args: any[]) => mockBuildTemplateProviderExecutionContext(...args),
  resolveCapabilityAwareProvider: (...args: any[]) => mockResolveCapabilityAwareProvider(...args),
}));

vi.mock('../providers', () => ({
  resolveProvider: (...args: any[]) => mockResolveProvider(...args),
  getExecutor: (...args: any[]) => mockGetExecutor(...args),
}));

vi.mock('./stage-resolver', () => ({
  getStageDefinition: (...args: any[]) => mockGetStageDefinition(...args),
}));

vi.mock('../approval/token-quota', () => ({
  checkTokenQuota: (...args: any[]) => mockCheckTokenQuota(...args),
  shouldAutoRequestQuota: (...args: any[]) => mockShouldAutoRequestQuota(...args),
}));

vi.mock('../approval/handler', () => ({
  submitApprovalRequest: (...args: any[]) => mockSubmitApprovalRequest(...args),
}));

vi.mock('./project-registry', () => ({
  updatePipelineStage: (...args: any[]) => mockUpdatePipelineStage(...args),
  updatePipelineStageByStageId: (...args: any[]) => mockUpdatePipelineStageByStageId(...args),
  getProject: (...args: any[]) => mockGetProject(...args),
  addRunToProject: (...args: any[]) => mockAddRunToProject(...args),
  trackStageDispatch: (...args: any[]) => mockTrackStageDispatch(...args),
}));

vi.mock('./project-events', () => ({
  emitProjectEvent: (...args: any[]) => mockEmitProjectEvent(...args),
}));

vi.mock('./department-memory', () => ({
  extractAndPersistMemory: vi.fn(),
}));

vi.mock('./review-engine', () => ({
  ReviewEngine: vi.fn(),
}));

vi.mock('./prompt-builder', () => ({
  buildRolePrompt: vi.fn(),
  buildRoleSwitchPrompt: vi.fn(),
  buildDeliveryPrompt: vi.fn(),
  formatPromptArtifactLines: vi.fn(() => []),
  extractReviewDecision: vi.fn(),
  parseDecisionMarker: vi.fn(),
  getCopiedArtifactPath: vi.fn(),
}));

vi.mock('./supervisor', () => ({
  startSupervisorLoop: vi.fn(),
  summarizeStepForSupervisor: vi.fn(),
  SUPERVISOR_MODEL: 'MODEL_PLACEHOLDER_SUP',
}));

vi.mock('./run-artifacts', () => ({
  readDeliveryPacket: vi.fn(),
  buildWriteScopeAudit: vi.fn(),
  scanArtifactManifest: vi.fn(),
  copyUpstreamArtifacts: vi.fn(),
  buildResultEnvelope: vi.fn(),
  writeEnvelopeFile: vi.fn(),
}));

vi.mock('./runtime-helpers', () => ({
  isAuthoritativeConversation: vi.fn(() => true),
  cancelCascadeBestEffort: (...args: any[]) => mockCancelCascadeBestEffort(...args),
  propagateTermination: vi.fn(),
  getFailureReason: vi.fn(),
  summarizeFailureText: vi.fn(),
  getCanonicalTaskEnvelope: (...args: any[]) => mockGetCanonicalTaskEnvelope(...args),
  normalizeComparablePath: vi.fn(),
  includesPathCandidate: vi.fn(),
  extractStepReadEvidence: vi.fn(),
  filterEvidenceByCandidates: vi.fn(() => []),
  dedupeStringList: vi.fn((items: string[]) => items),
  buildRoleInputReadAudit: (...args: any[]) => mockBuildRoleInputReadAudit(...args),
  enforceCanonicalInputReadProtocol: (...args: any[]) => mockEnforceCanonicalInputReadProtocol(...args),
}));

vi.mock('./result-parser', () => ({
  compactCodingResult: vi.fn(() => ({
    status: 'completed',
    summary: 'done',
    changedFiles: [],
    blockers: [],
    needsReview: [],
  })),
}));

vi.mock('./finalization', () => ({
  finalizeAdvisoryRun: vi.fn(),
  finalizeDeliveryRun: vi.fn(),
}));

vi.mock('./scope-governor', () => ({
  checkWriteScopeConflicts: vi.fn(() => []),
}));

vi.mock('./pipeline/pipeline-registry', () => ({
  canActivateStage: vi.fn(),
  filterSourcesByContract: vi.fn((_: string, __: string, runIds: string[]) => runIds),
  getDownstreamStages: vi.fn(() => []),
}));

vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { cancelRun, dispatchRun, interveneRun } from './group-runtime';
import { registerAgentBackend } from '../backends';
import type { AgentBackend, AgentEvent, AgentSession, BackendRunConfig } from '../backends';

const scriptedCapabilities = {
  supportsAppend: true,
  supportsCancel: true,
  emitsLiveState: true,
  emitsRawSteps: true,
  emitsStreamingText: false,
};

function makeScriptedSession(
  runId: string,
  providerId: 'antigravity' | 'custom' | 'claude-api',
  handle: string,
  events: AgentEvent[],
): AgentSession {
  return {
    runId,
    providerId,
    handle,
    capabilities: scriptedCapabilities,
    async *events(): AsyncIterable<AgentEvent> {
      for (const event of events) {
        yield event;
      }
    },
    append: async () => undefined,
    cancel: async () => undefined,
  };
}

function registerScriptedBackend(options: {
  providerId?: 'antigravity' | 'custom' | 'claude-api';
  startEvents?: (config: BackendRunConfig) => AgentEvent[];
  diagnosticsSteps?: unknown[];
  attachError?: Error;
  supportsAttach?: boolean;
  attachSessionFactory?: (config: BackendRunConfig, handle: string) => AgentSession;
  onStartConfig?(config: BackendRunConfig): void;
  onAttachConfig?(config: BackendRunConfig, handle: string): void;
}): AgentBackend {
  const providerId = options.providerId || 'antigravity';
  const backend: AgentBackend & {
    getRecentSteps?(handle: string): Promise<unknown[]>;
    annotateSession?(handle: string, annotations: Record<string, unknown>): Promise<void>;
  } = {
    providerId,
    capabilities: () => scriptedCapabilities,
    start: async (config) => {
      options.onStartConfig?.(config);
      return makeScriptedSession(
        config.runId,
        providerId,
        providerId === 'custom'
          ? 'custom-session'
          : providerId === 'claude-api'
            ? 'claude-api-session'
            : 'cascade-scripted',
        options.startEvents ? options.startEvents(config) : [{
          kind: 'started',
          runId: config.runId,
          providerId,
          handle: providerId === 'custom'
            ? 'custom-session'
            : providerId === 'claude-api'
              ? 'claude-api-session'
              : 'cascade-scripted',
          startedAt: '2026-04-10T00:00:00.000Z',
        }],
      );
    },
  };

  if (options.supportsAttach !== false) {
    backend.attach = async (config, handle) => {
      options.onAttachConfig?.(config, handle);
      if (options.attachError) {
        throw options.attachError;
      }
      if (options.attachSessionFactory) {
        return options.attachSessionFactory({ runId: config.runId }, handle);
      }
      return makeScriptedSession(config.runId, providerId, handle, [{
        kind: 'started',
        runId: config.runId,
        providerId,
        handle,
        startedAt: '2026-04-10T00:00:00.000Z',
      }]);
    };
  }

  if (providerId === 'antigravity') {
    backend.getRecentSteps = async () => options.diagnosticsSteps || [];
    backend.annotateSession = async () => undefined;
  }

  return registerAgentBackend(backend);
}

describe('group-runtime characterization', () => {
  let tempWorkspace: string;
  let tempGatewayHome: string;
  let previousGatewayHome: string | undefined;
  let runState: any;
  let antigravityExecutor: any;
  let codexExecutor: any;

  beforeEach(() => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-group-runtime-'));
    tempGatewayHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-group-runtime-home-'));
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.AG_GATEWAY_HOME = tempGatewayHome;
    runState = undefined;
    (globalThis as any).__AGENT_BACKEND_REGISTRY__?.clear();
    (globalThis as any).__AGENT_SESSION_REGISTRY__?.clear();
    (globalThis as any).__AGENT_MEMORY_HOOKS__?.clear();

    mockDiscoverLanguageServers.mockReset();
    mockGetApiKey.mockReset();
    mockRefreshOwnerMap.mockReset();
    mockPreRegisterOwner.mockReset();
    mockGetOwnerConnection.mockReset();
    mockCreateRun.mockReset();
    mockUpdateRun.mockReset();
    mockGetRun.mockReset();
    mockWatchConversation.mockReset();
    mockResolveWorkflowContent.mockClear();
    mockResolveProvider.mockReset();
    mockGetExecutor.mockReset();
    mockGetStageDefinition.mockReset();
    mockCheckTokenQuota.mockReset();
    mockShouldAutoRequestQuota.mockReset();
    mockSubmitApprovalRequest.mockReset();
    mockGrpc.addTrackedWorkspace.mockReset();
    mockGrpc.startCascade.mockReset();
    mockGrpc.updateConversationAnnotations.mockReset();
    mockGrpc.sendMessage.mockReset();
    mockGrpc.cancelCascade.mockReset();
    mockGrpc.getTrajectorySteps.mockReset();
    mockUpdatePipelineStage.mockReset();
    mockUpdatePipelineStageByStageId.mockReset();
    mockGetProject.mockReset();
    mockAddRunToProject.mockReset();
    mockTrackStageDispatch.mockReset();
    mockEmitProjectEvent.mockReset();
    mockCancelCascadeBestEffort.mockReset();
    mockGetCanonicalTaskEnvelope.mockReset();
    mockBuildRoleInputReadAudit.mockReset();
    mockEnforceCanonicalInputReadProtocol.mockReset();
    mockApplyProviderExecutionContext.mockReset();
    mockBuildTemplateProviderExecutionContext.mockReset();
    mockResolveCapabilityAwareProvider.mockReset();

    antigravityExecutor = {
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
      appendMessage: vi.fn(async (_handle: string, opts: any) => ({
        handle: 'cascade-1',
        content: opts.prompt,
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      providerId: 'antigravity',
    };
    codexExecutor = {
      capabilities: () => ({
        supportsStreaming: false,
        supportsMultiTurn: true,
        supportsIdeSkills: false,
        supportsSandbox: true,
        supportsCancel: false,
        supportsStepWatch: false,
      }),
      executeTask: vi.fn(async () => ({
        handle: 'codex-thread-1',
        content: 'done',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      cancel: vi.fn(async () => undefined),
      appendMessage: vi.fn(async (_handle: string, opts: any) => ({
        handle: 'codex-thread-1',
        content: opts.prompt,
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      providerId: 'codex',
    };

    mockCreateRun.mockImplementation((input: any) => {
      runState = {
        runId: 'run-1',
        status: 'queued',
        createdAt: '2026-04-08T00:00:00.000Z',
        workspace: input.workspace,
        stageId: input.stageId,
        prompt: input.prompt,
        templateId: input.templateId,
        projectId: input.projectId,
        ...input,
      };
      return runState;
    });

    mockUpdateRun.mockImplementation((_runId: string, updates: any) => {
      runState = { ...runState, ...updates };
      return runState;
    });

    mockGetRun.mockImplementation(() => runState);

    mockApplyProviderExecutionContext.mockImplementation((prompt: string, context?: { promptPreamble?: string }) => (
      context?.promptPreamble ? `${context.promptPreamble}\n\n${prompt}` : prompt
    ));
    mockBuildTemplateProviderExecutionContext.mockImplementation((_workspacePath: string, templateId: string) => ({
      promptPreamble: '',
      resolutionReason: `template context for ${templateId}`,
      runtimeContract: undefined,
      executionProfile: undefined,
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

    mockResolveProvider.mockReturnValue({ provider: 'antigravity', model: 'MODEL_PLACEHOLDER_M26', source: 'default' });
    mockGetExecutor.mockImplementation((provider: string) => provider === 'codex' ? codexExecutor : antigravityExecutor);
    mockDiscoverLanguageServers.mockReturnValue([{ port: 1, csrf: 'csrf', workspace: tempWorkspace }]);
    mockGetApiKey.mockReturnValue('api-key');
    mockGetOwnerConnection.mockReturnValue({ port: 1, csrf: 'csrf', apiKey: 'api-key' });
    mockCheckTokenQuota.mockReturnValue({ allowed: true, remaining: 1000 });
    mockShouldAutoRequestQuota.mockReturnValue(false);
    mockWatchConversation.mockReturnValue(vi.fn());
    mockGrpc.addTrackedWorkspace.mockResolvedValue(undefined);
    mockGrpc.startCascade.mockResolvedValue({ cascadeId: 'cascade-1' });
    mockGrpc.updateConversationAnnotations.mockResolvedValue(undefined);
    mockGrpc.sendMessage.mockResolvedValue(undefined);
    mockGrpc.getTrajectorySteps.mockResolvedValue({ steps: [] });
    mockGetProject.mockReturnValue({ pipelineState: { status: 'running', stages: [] } });
    mockGetCanonicalTaskEnvelope.mockImplementation((_runId: string, fallback: any) => fallback);
    mockBuildRoleInputReadAudit.mockReturnValue({ status: 'verified', entries: [] });
    mockEnforceCanonicalInputReadProtocol.mockImplementation((_roleId: string, result: any) => result);
  });

  afterEach(() => {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
    fs.rmSync(tempGatewayHome, { recursive: true, force: true });
    if (previousGatewayHome === undefined) {
      delete process.env.AG_GATEWAY_HOME;
    } else {
      process.env.AG_GATEWAY_HOME = previousGatewayHome;
    }
  });

  it('dispatches legacy-single template runs through the AgentBackend session path', async () => {
    mockGetStageDefinition.mockReturnValue({
      id: 'implement',
      templateId: 'tpl-1',
      executionMode: 'legacy-single',
      roles: [{ id: 'author', workflow: '/dev-worker', timeoutMs: 60_000, autoApprove: false }],
    });

    const result = await dispatchRun({
      workspace: `file://${tempWorkspace}`,
      templateId: 'tpl-1',
      stageId: 'implement',
      prompt: '修复登录接口',
      parentConversationId: 'parent-1',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result).toEqual({ runId: 'run-1' });
    expect(mockCreateRun).toHaveBeenCalledWith(expect.objectContaining({
      stageId: 'implement',
      templateId: 'tpl-1',
      prompt: '修复登录接口',
      executorKind: 'template',
      executionTarget: {
        kind: 'template',
        templateId: 'tpl-1',
        stageId: 'implement',
      },
    }));
    expect(mockCreateRun.mock.calls[0]?.[0]?.pipelineStageId).toBeUndefined();
    expect(mockResolveWorkflowContent).toHaveBeenCalledWith('/dev-worker');
    expect(antigravityExecutor.executeTask).toHaveBeenCalledWith(expect.objectContaining({
      workspace: tempWorkspace,
      prompt: expect.stringContaining('resolved:/dev-worker\n\n修复登录接口'),
      model: 'MODEL_PLACEHOLDER_M26',
      runId: 'run-1',
      stageId: 'implement',
      roleId: 'author',
      parentConversationId: 'parent-1',
    }));
    expect(mockWatchConversation).toHaveBeenCalledWith(
      { port: 1, csrf: 'csrf', apiKey: 'api-key' },
      'cascade-1',
      expect.any(Function),
      expect.any(Function),
      'api-key',
    );
    expect(runState.status).toBe('running');
    expect(runState.activeConversationId).toBe('cascade-1');
    expect(runState.childConversationId).toBe('cascade-1');
  });

  it('forwards runtime carrier from taskEnvelope into template backend config', async () => {
    const seenConfigs: BackendRunConfig[] = [];
    registerScriptedBackend({
      providerId: 'custom',
      onStartConfig: (config) => {
        seenConfigs.push(config);
      },
      startEvents: (config) => [
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
      ],
    });
    mockResolveProvider.mockReturnValue({ provider: 'custom', model: 'MODEL_PLACEHOLDER_M26', source: 'default' });
    mockGetStageDefinition.mockReturnValue({
      id: 'implement',
      templateId: 'tpl-1',
      executionMode: 'legacy-single',
      roles: [{ id: 'author', workflow: '/dev-worker', timeoutMs: 60_000, autoApprove: false }],
    });

    const executionProfile = {
      kind: 'dag-orchestration' as const,
      templateId: 'tpl-1',
      stageId: 'implement',
    };
    const departmentRuntimeContract = {
      workspaceRoot: tempWorkspace,
      toolset: 'coding',
      additionalWorkingDirectories: ['/tmp/shared-code'],
      artifactRoot: '.artifacts/runs/run-1',
    };

    await dispatchRun({
      workspace: `file://${tempWorkspace}`,
      templateId: 'tpl-1',
      stageId: 'implement',
      prompt: '修复登录接口',
      taskEnvelope: {
        goal: '修复登录接口',
        executionProfile,
        departmentRuntimeContract,
      } as any,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seenConfigs[0]).toEqual(expect.objectContaining({
      executionProfile,
      runtimeContract: expect.objectContaining({
        toolset: 'coding',
        additionalWorkingDirectories: ['/tmp/shared-code'],
        artifactRoot: path.join(tempWorkspace, 'demolong/runs/run-1/'),
      }),
    }));
  });

  it('routes artifact-heavy template runs away from native-codex before backend dispatch', async () => {
    const seenConfigs: BackendRunConfig[] = [];
    registerScriptedBackend({
      providerId: 'claude-api',
      onStartConfig: (config) => {
        seenConfigs.push(config);
      },
      startEvents: (config) => [
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
      ],
    });
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
    mockGetStageDefinition.mockReturnValue({
      id: 'implement',
      templateId: 'tpl-1',
      executionMode: 'legacy-single',
      roles: [{ id: 'author', workflow: '/dev-worker', timeoutMs: 60_000, autoApprove: false }],
    });

    await dispatchRun({
      workspace: `file://${tempWorkspace}`,
      templateId: 'tpl-1',
      stageId: 'implement',
      prompt: '产出完整交付包',
      taskEnvelope: {
        goal: '产出完整交付包',
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

  it('cancels non-active runs by marking the project stage cancelled locally', async () => {
    runState = {
      runId: 'run-1',
      status: 'running',
      workspace: `file://${tempWorkspace}`,
      projectId: 'project-1',
      pipelineStageId: 'implement',
    };
    mockGetRun.mockImplementation(() => runState);

    await cancelRun('run-1');

    expect(mockUpdatePipelineStageByStageId).toHaveBeenCalledWith('project-1', 'implement', {
      status: 'cancelled',
      runId: 'run-1',
    });
    expect(mockUpdateRun).toHaveBeenCalledWith('run-1', { status: 'cancelled' });
    expect(mockGrpc.cancelCascade).not.toHaveBeenCalled();
  });

  it('cancels session-backed runs through the active AgentSession', async () => {
    const sessionCancel = vi.fn(async () => undefined);
    const sessionRegistry = (globalThis as any).__AGENT_SESSION_REGISTRY__ || new Map();
    (globalThis as any).__AGENT_SESSION_REGISTRY__ = sessionRegistry;
    sessionRegistry.set('run-1', {
      runId: 'run-1',
      providerId: 'antigravity',
      handle: 'cascade-1',
      session: {
        runId: 'run-1',
        providerId: 'antigravity',
        handle: 'cascade-1',
        capabilities: {
          supportsAppend: true,
          supportsCancel: true,
          emitsLiveState: true,
          emitsRawSteps: true,
          emitsStreamingText: true,
        },
        events: async function* () { },
        append: async () => undefined,
        cancel: sessionCancel,
      },
      cancelRequested: false,
      terminalSeen: false,
      registeredAt: '2026-04-08T00:00:00.000Z',
    });

    runState = {
      runId: 'run-1',
      status: 'running',
      workspace: `file://${tempWorkspace}`,
      projectId: 'project-1',
      pipelineStageId: 'implement',
    };
    mockGetRun.mockImplementation(() => runState);

    await cancelRun('run-1');

    expect(sessionCancel).toHaveBeenCalledWith('cancelled_by_user');
    expect(mockUpdatePipelineStageByStageId).toHaveBeenCalledWith('project-1', 'implement', {
      status: 'cancelled',
      runId: 'run-1',
    });
    expect(mockGrpc.cancelCascade).not.toHaveBeenCalled();
  });

  it('cancels unattached antigravity runs through an attached AgentSession and keeps project stage in sync', async () => {
    runState = {
      runId: 'run-1',
      status: 'running',
      workspace: `file://${tempWorkspace}`,
      projectId: 'project-1',
      pipelineStageId: 'implement',
      activeConversationId: 'cascade-1',
    };
    mockGetRun.mockImplementation(() => runState);
    mockGetOwnerConnection.mockReturnValue({ port: 9, csrf: 'csrf-owner' });
    mockGetApiKey.mockReturnValue('api-key');

    await cancelRun('run-1');

    expect(antigravityExecutor.executeTask).not.toHaveBeenCalled();
    expect(mockWatchConversation).toHaveBeenCalledWith(
      { port: 9, csrf: 'csrf-owner', apiKey: undefined },
      'cascade-1',
      expect.any(Function),
      expect.any(Function),
      undefined,
    );
    expect(mockGrpc.cancelCascade).toHaveBeenCalledWith(9, 'csrf-owner', 'api-key', 'cascade-1');
    expect(mockUpdatePipelineStageByStageId).toHaveBeenCalledWith('project-1', 'implement', {
      status: 'cancelled',
      runId: 'run-1',
    });
    expect(mockUpdateRun).toHaveBeenCalledWith('run-1', {
      status: 'cancelled',
      lastError: undefined,
    });
  });

  it('nudges session-backed runs through AgentSession.append instead of direct grpc send', async () => {
    const appendSpy = vi.fn(async () => undefined);
    const sessionRegistry = (globalThis as any).__AGENT_SESSION_REGISTRY__ || new Map();
    (globalThis as any).__AGENT_SESSION_REGISTRY__ = sessionRegistry;
    sessionRegistry.set('run-1', {
      runId: 'run-1',
      providerId: 'antigravity',
      handle: 'cascade-1',
      session: {
        runId: 'run-1',
        providerId: 'antigravity',
        handle: 'cascade-1',
        capabilities: {
          supportsAppend: true,
          supportsCancel: true,
          emitsLiveState: true,
          emitsRawSteps: true,
          emitsStreamingText: true,
        },
        events: async function* () { },
        append: appendSpy,
        cancel: async () => undefined,
      },
      cancelRequested: false,
      terminalSeen: false,
      registeredAt: '2026-04-08T00:00:00.000Z',
    });

    runState = {
      runId: 'run-1',
      status: 'running',
      workspace: `file://${tempWorkspace}`,
      projectId: 'project-1',
      stageId: 'implement',
      pipelineStageId: 'implement',
      templateId: 'tpl-1',
      activeConversationId: 'cascade-1',
      childConversationId: 'cascade-1',
      prompt: '修复登录接口',
      model: 'MODEL_PLACEHOLDER_M26',
      roles: [{ roleId: 'author', childConversationId: 'cascade-1' }],
      liveState: {
        cascadeStatus: 'running',
        stepCount: 3,
        lastStepAt: '2026-04-08T00:00:00.000Z',
        lastStepType: 'PLANNER_RESPONSE',
        staleSince: '2026-04-08T00:00:10.000Z',
      },
      taskEnvelope: { goal: '修复登录接口' },
    };
    mockGetRun.mockImplementation(() => runState);
    mockGetStageDefinition.mockReturnValue({
      id: 'implement',
      templateId: 'tpl-1',
      executionMode: 'legacy-single',
      roles: [{ id: 'author', workflow: '/dev-worker', timeoutMs: 60_000, autoApprove: false }],
    });

    const result = await interveneRun('run-1', 'nudge', '继续补全实现');

    expect(result).toEqual({ status: 'running', action: 'nudge', cascadeId: 'cascade-1' });
    expect(appendSpy).toHaveBeenCalledWith({
      prompt: '继续补全实现',
      model: 'MODEL_PLACEHOLDER_M26',
      workspacePath: tempWorkspace,
    });
    expect(mockGrpc.sendMessage).not.toHaveBeenCalled();
  });

  it('nudges unattached antigravity runs by attaching an AgentSession to the existing cascade', async () => {
    vi.useFakeTimers();
    mockWatchConversation.mockImplementation((_conn: any, _handle: string, onUpdate: any) => {
      setTimeout(() => {
        onUpdate({
          steps: [{ type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', plannerResponse: { modifiedResponse: 'done' } }],
          cascadeStatus: 'running',
          isActive: true,
          hasErrorSteps: false,
          lastTaskBoundary: null,
          stepCount: 1,
          lastStepAt: '2026-04-09T00:00:00.000Z',
          lastStepType: 'PLANNER_RESPONSE',
        });
      }, 0);
      setTimeout(() => {
        onUpdate({
          steps: [{ type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', plannerResponse: { modifiedResponse: 'done' } }],
          cascadeStatus: 'idle',
          isActive: false,
          hasErrorSteps: false,
          lastTaskBoundary: null,
          stepCount: 1,
          lastStepAt: '2026-04-09T00:00:01.000Z',
          lastStepType: 'PLANNER_RESPONSE',
        });
      }, 1);
      return vi.fn();
    });

    runState = {
      runId: 'run-1',
      status: 'running',
      workspace: `file://${tempWorkspace}`,
      projectId: 'project-1',
      stageId: 'implement',
      pipelineStageId: 'implement',
      templateId: 'tpl-1',
      activeConversationId: 'cascade-1',
      childConversationId: 'cascade-1',
      prompt: '修复登录接口',
      model: 'MODEL_PLACEHOLDER_M26',
      roles: [{ roleId: 'author', round: 1, childConversationId: 'cascade-1', status: 'running' }],
      liveState: {
        cascadeStatus: 'running',
        stepCount: 1,
        lastStepAt: '2026-04-09T00:00:00.000Z',
        lastStepType: 'PLANNER_RESPONSE',
        staleSince: '2026-04-09T00:01:00.000Z',
      },
      taskEnvelope: { goal: '修复登录接口' },
    };
    mockGetRun.mockImplementation(() => runState);
    mockGetStageDefinition.mockReturnValue({
      id: 'implement',
      templateId: 'tpl-1',
      executionMode: 'legacy-single',
      roles: [{ id: 'author', workflow: '/dev-worker', timeoutMs: 60_000, autoApprove: false }],
    });

    const resultPromise = interveneRun('run-1', 'nudge', '继续补全实现');
    await vi.advanceTimersByTimeAsync(1700);
    const result = await resultPromise;

    expect(result).toEqual({ status: 'completed', action: 'nudge', cascadeId: 'cascade-1' });
    expect(antigravityExecutor.executeTask).not.toHaveBeenCalled();
    expect(mockGrpc.sendMessage).toHaveBeenCalledWith(
      1,
      'csrf',
      'api-key',
      'cascade-1',
      '继续补全实现',
      'MODEL_PLACEHOLDER_M26',
    );
    expect(runState.status).toBe('completed');
  });

  it('restarts roles through the AgentBackend session path instead of startCascade', async () => {
    mockResolveProvider.mockReturnValue({ provider: 'codex', model: 'MODEL_PLACEHOLDER_M26', source: 'default' });
    runState = {
      runId: 'run-1',
      status: 'failed',
      workspace: `file://${tempWorkspace}`,
      projectId: 'project-1',
      stageId: 'implement',
      pipelineStageId: 'implement',
      templateId: 'tpl-1',
      activeConversationId: 'cascade-old',
      childConversationId: 'cascade-old',
      prompt: '修复登录接口',
      model: 'MODEL_PLACEHOLDER_M26',
      roles: [{ roleId: 'author', round: 1, childConversationId: 'cascade-old', status: 'failed' }],
      taskEnvelope: { goal: '修复登录接口' },
      parentConversationId: 'parent-1',
    };
    mockGetRun.mockImplementation(() => runState);
    mockGetStageDefinition.mockReturnValue({
      id: 'implement',
      templateId: 'tpl-1',
      executionMode: 'legacy-single',
      roles: [{ id: 'author', workflow: '/dev-worker', timeoutMs: 60_000, autoApprove: false }],
    });

    const result = await interveneRun('run-1', 'restart_role', '请重新完成实现');

    expect(result).toEqual({ status: 'completed', action: 'restart_role', cascadeId: 'codex-run-1' });
    expect(codexExecutor.executeTask).toHaveBeenCalledWith(expect.objectContaining({
      workspace: tempWorkspace,
      prompt: '请重新完成实现',
      roleId: 'author',
      stageId: 'implement',
      parentConversationId: 'parent-1',
    }));
    expect(mockGrpc.startCascade).not.toHaveBeenCalled();
    expect(mockCancelCascadeBestEffort).toHaveBeenCalledWith(
      'cascade-old',
      { port: 1, csrf: 'csrf' },
      'api-key',
      'run-1',
    );
    expect(runState.status).toBe('completed');
  });

  it('evaluates runs through a one-shot AgentBackend session instead of startCascade polling', async () => {
    vi.useFakeTimers();
    antigravityExecutor.executeTask.mockResolvedValueOnce({
      handle: 'cascade-eval',
      content: '',
      steps: [],
      changedFiles: [],
      status: 'completed' as const,
    });
    mockWatchConversation.mockImplementation((_conn: any, handle: string, onUpdate: any) => {
      if (handle === 'cascade-eval') {
        setTimeout(() => {
          onUpdate({
            steps: [{
              type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
              plannerResponse: { modifiedResponse: '{"status":"DONE","analysis":"looks good"}' },
            }],
            cascadeStatus: 'running',
            isActive: true,
            hasErrorSteps: false,
            lastTaskBoundary: null,
            stepCount: 1,
            lastStepAt: '2026-04-09T00:00:00.000Z',
            lastStepType: 'PLANNER_RESPONSE',
          });
        }, 0);
        setTimeout(() => {
          onUpdate({
            steps: [{
              type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
              plannerResponse: { modifiedResponse: '{"status":"DONE","analysis":"looks good"}' },
            }],
            cascadeStatus: 'idle',
            isActive: false,
            hasErrorSteps: false,
            lastTaskBoundary: null,
            stepCount: 1,
            lastStepAt: '2026-04-09T00:00:01.000Z',
            lastStepType: 'PLANNER_RESPONSE',
          });
        }, 1);
      }
      return vi.fn();
    });
    mockGrpc.getTrajectorySteps.mockResolvedValue({
      steps: [{
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: { modifiedResponse: 'recent step' },
      }],
    });

    runState = {
      runId: 'run-1',
      status: 'running',
      workspace: `file://${tempWorkspace}`,
      projectId: 'project-1',
      stageId: 'implement',
      pipelineStageId: 'implement',
      templateId: 'tpl-1',
      activeConversationId: 'cascade-1',
      childConversationId: 'cascade-1',
      activeRoleId: 'author',
      prompt: '修复登录接口',
      lastError: undefined,
      roles: [{ roleId: 'author', round: 1, childConversationId: 'cascade-1', status: 'running' }],
      taskEnvelope: { goal: '修复登录接口' },
    };
    mockGetRun.mockImplementation(() => runState);
    mockGetStageDefinition.mockReturnValue({
      id: 'implement',
      templateId: 'tpl-1',
      executionMode: 'legacy-single',
      roles: [{ id: 'author', workflow: '/dev-worker', timeoutMs: 60_000, autoApprove: false }],
    });

    const resultPromise = interveneRun('run-1', 'evaluate');
    await vi.advanceTimersByTimeAsync(1700);
    const result = await resultPromise;

    expect(result).toEqual({ status: 'evaluated', action: 'evaluate' });
    expect(mockGrpc.startCascade).not.toHaveBeenCalled();
    expect(mockGrpc.sendMessage).not.toHaveBeenCalled();
    expect(mockGrpc.updateConversationAnnotations).toHaveBeenCalledWith(
      1,
      'csrf',
      'api-key',
      'cascade-eval',
      expect.objectContaining({
        'antigravity.task.type': 'supervisor-evaluate',
        'antigravity.task.runId': 'run-1',
      }),
    );
    expect(runState.supervisorConversationId).toBe('cascade-eval');
    expect(runState.supervisorReviews?.[0]?.decision).toEqual(expect.objectContaining({
      status: 'DONE',
      analysis: 'looks good',
    }));
  });

  it('records STUCK when evaluate session fails', async () => {
    registerScriptedBackend({
      startEvents: ({ runId }) => [
        {
          kind: 'started',
          runId,
          providerId: 'antigravity',
          handle: 'cascade-eval-failed',
          startedAt: '2026-04-10T00:00:00.000Z',
        },
        {
          kind: 'failed',
          runId,
          providerId: 'antigravity',
          handle: 'cascade-eval-failed',
          finishedAt: '2026-04-10T00:00:01.000Z',
          error: {
            code: 'watch_failed',
            message: 'evaluation backend failed',
            retryable: true,
            source: 'backend',
          },
        },
      ],
      diagnosticsSteps: [],
    });

    runState = {
      runId: 'run-1',
      status: 'running',
      workspace: `file://${tempWorkspace}`,
      projectId: 'project-1',
      stageId: 'implement',
      pipelineStageId: 'implement',
      templateId: 'tpl-1',
      activeConversationId: 'cascade-1',
      childConversationId: 'cascade-1',
      activeRoleId: 'author',
      prompt: '修复登录接口',
      roles: [{ roleId: 'author', round: 1, childConversationId: 'cascade-1', status: 'running' }],
      taskEnvelope: { goal: '修复登录接口' },
    };
    mockGetRun.mockImplementation(() => runState);
    mockGetStageDefinition.mockReturnValue({
      id: 'implement',
      templateId: 'tpl-1',
      executionMode: 'legacy-single',
      roles: [{ id: 'author', workflow: '/dev-worker', timeoutMs: 60_000, autoApprove: false }],
    });

    const result = await interveneRun('run-1', 'evaluate');

    expect(result).toEqual({ status: 'evaluated', action: 'evaluate' });
    expect(runState.supervisorReviews?.[0]?.decision).toEqual({
      status: 'STUCK',
      analysis: 'evaluation backend failed',
    });
  });

  it('records STUCK when evaluate session is cancelled', async () => {
    registerScriptedBackend({
      startEvents: ({ runId }) => [
        {
          kind: 'started',
          runId,
          providerId: 'antigravity',
          handle: 'cascade-eval-cancelled',
          startedAt: '2026-04-10T00:00:00.000Z',
        },
        {
          kind: 'cancelled',
          runId,
          providerId: 'antigravity',
          handle: 'cascade-eval-cancelled',
          finishedAt: '2026-04-10T00:00:01.000Z',
          reason: 'evaluation cancelled by test',
        },
      ],
      diagnosticsSteps: [],
    });

    runState = {
      runId: 'run-1',
      status: 'running',
      workspace: `file://${tempWorkspace}`,
      projectId: 'project-1',
      stageId: 'implement',
      pipelineStageId: 'implement',
      templateId: 'tpl-1',
      activeConversationId: 'cascade-1',
      childConversationId: 'cascade-1',
      activeRoleId: 'author',
      prompt: '修复登录接口',
      roles: [{ roleId: 'author', round: 1, childConversationId: 'cascade-1', status: 'running' }],
      taskEnvelope: { goal: '修复登录接口' },
    };
    mockGetRun.mockImplementation(() => runState);
    mockGetStageDefinition.mockReturnValue({
      id: 'implement',
      templateId: 'tpl-1',
      executionMode: 'legacy-single',
      roles: [{ id: 'author', workflow: '/dev-worker', timeoutMs: 60_000, autoApprove: false }],
    });

    const result = await interveneRun('run-1', 'evaluate');

    expect(result).toEqual({ status: 'evaluated', action: 'evaluate' });
    expect(runState.supervisorReviews?.[0]?.decision).toEqual({
      status: 'STUCK',
      analysis: 'evaluation cancelled by test',
    });
  });

  it('records STUCK when evaluate returns malformed JSON', async () => {
    registerScriptedBackend({
      startEvents: ({ runId }) => [
        {
          kind: 'started',
          runId,
          providerId: 'antigravity',
          handle: 'cascade-eval-malformed',
          startedAt: '2026-04-10T00:00:00.000Z',
        },
        {
          kind: 'completed',
          runId,
          providerId: 'antigravity',
          handle: 'cascade-eval-malformed',
          finishedAt: '2026-04-10T00:00:01.000Z',
          result: {
            status: 'completed',
            summary: 'done',
            changedFiles: [],
            blockers: [],
            needsReview: [],
          },
          rawSteps: [{
            type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
            plannerResponse: { modifiedResponse: '{not-json' },
          }],
          finalText: '{not-json',
        },
      ],
      diagnosticsSteps: [],
    });

    runState = {
      runId: 'run-1',
      status: 'running',
      workspace: `file://${tempWorkspace}`,
      projectId: 'project-1',
      stageId: 'implement',
      pipelineStageId: 'implement',
      templateId: 'tpl-1',
      activeConversationId: 'cascade-1',
      childConversationId: 'cascade-1',
      activeRoleId: 'author',
      prompt: '修复登录接口',
      roles: [{ roleId: 'author', round: 1, childConversationId: 'cascade-1', status: 'running' }],
      taskEnvelope: { goal: '修复登录接口' },
    };
    mockGetRun.mockImplementation(() => runState);
    mockGetStageDefinition.mockReturnValue({
      id: 'implement',
      templateId: 'tpl-1',
      executionMode: 'legacy-single',
      roles: [{ id: 'author', workflow: '/dev-worker', timeoutMs: 60_000, autoApprove: false }],
    });

    const result = await interveneRun('run-1', 'evaluate');

    expect(result).toEqual({ status: 'evaluated', action: 'evaluate' });
    expect(runState.supervisorReviews?.[0]?.decision.status).toBe('STUCK');
    expect(runState.supervisorReviews?.[0]?.decision.analysis).toBe('{not-json');
  });

  it('surfaces unattached cancel attach failures instead of silently cancelling locally', async () => {
    registerScriptedBackend({
      attachError: new Error('owner mapping missing'),
    });

    runState = {
      runId: 'run-1',
      status: 'running',
      workspace: `file://${tempWorkspace}`,
      projectId: 'project-1',
      pipelineStageId: 'implement',
      activeConversationId: 'cascade-1',
    };
    mockGetRun.mockImplementation(() => runState);

    await expect(cancelRun('run-1')).rejects.toThrow('owner mapping missing');
    expect(mockUpdatePipelineStageByStageId).not.toHaveBeenCalled();
    expect(mockUpdateRun).not.toHaveBeenCalledWith('run-1', { status: 'cancelled' });
  });

  it('fails unattached nudge when the resolved backend does not support attach', async () => {
    registerScriptedBackend({
      providerId: 'custom',
      supportsAttach: false,
      startEvents: ({ runId }) => [{
        kind: 'started',
        runId,
        providerId: 'custom',
        handle: 'custom-session',
        startedAt: '2026-04-10T00:00:00.000Z',
      }],
    });
    mockResolveProvider.mockReturnValue({ provider: 'custom', model: 'MODEL_PLACEHOLDER_M26', source: 'default' });

    runState = {
      runId: 'run-1',
      status: 'running',
      workspace: `file://${tempWorkspace}`,
      projectId: 'project-1',
      stageId: 'implement',
      pipelineStageId: 'implement',
      templateId: 'tpl-1',
      activeConversationId: 'cascade-1',
      childConversationId: 'cascade-1',
      prompt: '修复登录接口',
      model: 'MODEL_PLACEHOLDER_M26',
      roles: [{ roleId: 'author', round: 1, childConversationId: 'cascade-1', status: 'running' }],
      liveState: {
        cascadeStatus: 'running',
        stepCount: 1,
        lastStepAt: '2026-04-09T00:00:00.000Z',
        lastStepType: 'PLANNER_RESPONSE',
        staleSince: '2026-04-09T00:01:00.000Z',
      },
      taskEnvelope: { goal: '修复登录接口' },
    };
    mockGetRun.mockImplementation(() => runState);
    mockGetStageDefinition.mockReturnValue({
      id: 'implement',
      templateId: 'tpl-1',
      executionMode: 'legacy-single',
      roles: [{ id: 'author', workflow: '/dev-worker', timeoutMs: 60_000, autoApprove: false }],
    });

    await expect(interveneRun('run-1', 'nudge', '继续补全实现')).rejects.toThrow(
      "Provider 'custom' does not support attaching to an existing session",
    );
  });

  it('marks attached-session nudge runs as timeout when the attached session exceeds role timeout', async () => {
    vi.useFakeTimers();
    const cancelSpy = vi.fn(async () => undefined);
    let releaseCancelled!: (reason: string) => void;
    const cancelledReason = new Promise<string>((resolve) => {
      releaseCancelled = resolve;
    });

    registerScriptedBackend({
      attachSessionFactory: ({ runId }, handle) => ({
        runId,
        providerId: 'antigravity',
        handle,
        capabilities: scriptedCapabilities,
        async *events(): AsyncIterable<AgentEvent> {
          yield {
            kind: 'started',
            runId,
            providerId: 'antigravity',
            handle,
            startedAt: '2026-04-10T00:00:00.000Z',
          };
          const reason = await cancelledReason;
          yield {
            kind: 'cancelled',
            runId,
            providerId: 'antigravity',
            handle,
            finishedAt: '2026-04-10T00:00:01.000Z',
            reason,
          };
        },
        append: async () => undefined,
        cancel: async (reason) => {
          await cancelSpy(reason);
          releaseCancelled(reason || 'timeout');
        },
      }),
      diagnosticsSteps: [],
    });

    runState = {
      runId: 'run-1',
      status: 'running',
      workspace: `file://${tempWorkspace}`,
      projectId: 'project-1',
      stageId: 'implement',
      pipelineStageId: 'implement',
      templateId: 'tpl-1',
      activeConversationId: 'cascade-1',
      childConversationId: 'cascade-1',
      prompt: '修复登录接口',
      model: 'MODEL_PLACEHOLDER_M26',
      roles: [{ roleId: 'author', round: 1, childConversationId: 'cascade-1', status: 'running' }],
      liveState: {
        cascadeStatus: 'running',
        stepCount: 1,
        lastStepAt: '2026-04-09T00:00:00.000Z',
        lastStepType: 'PLANNER_RESPONSE',
        staleSince: '2026-04-09T00:01:00.000Z',
      },
      taskEnvelope: { goal: '修复登录接口' },
    };
    mockGetRun.mockImplementation(() => runState);
    mockGetStageDefinition.mockReturnValue({
      id: 'implement',
      templateId: 'tpl-1',
      executionMode: 'legacy-single',
      roles: [{ id: 'author', workflow: '/dev-worker', timeoutMs: 5, autoApprove: false }],
    });

    const resultPromise = interveneRun('run-1', 'nudge', '继续补全实现');
    await vi.advanceTimersByTimeAsync(10);
    const result = await resultPromise;

    expect(result).toEqual({ status: 'completed', action: 'nudge', cascadeId: 'cascade-1' });
    expect(cancelSpy).toHaveBeenCalledWith('timeout');
    expect(runState.status).toBe('timeout');
  });
});
