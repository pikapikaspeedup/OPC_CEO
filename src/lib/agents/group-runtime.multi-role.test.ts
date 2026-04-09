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
  mockBuildRolePrompt,
  mockBuildRoleSwitchPrompt,
  mockBuildDeliveryPrompt,
  mockExtractReviewDecision,
  mockBuildRoleInputReadAudit,
  mockEnforceCanonicalInputReadProtocol,
  mockGetCanonicalTaskEnvelope,
  mockGetDownstreamStages,
  mockCanActivateStage,
  mockFilterSourcesByContract,
  mockPropagateTermination,
  mockFinalizeAdvisoryRun,
  mockFinalizeDeliveryRun,
  mockWriteEnvelopeFile,
  mockCopyUpstreamArtifacts,
  mockCompactCodingResult,
  mockStartSupervisorLoop,
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
    proceedArtifact: vi.fn(),
  },
  mockCreateRun: vi.fn(),
  mockUpdateRun: vi.fn(),
  mockGetRun: vi.fn(),
  mockWatchConversation: vi.fn(),
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
  mockBuildRolePrompt: vi.fn(),
  mockBuildRoleSwitchPrompt: vi.fn(),
  mockBuildDeliveryPrompt: vi.fn(),
  mockExtractReviewDecision: vi.fn(),
  mockBuildRoleInputReadAudit: vi.fn(),
  mockEnforceCanonicalInputReadProtocol: vi.fn(),
  mockGetCanonicalTaskEnvelope: vi.fn(),
  mockGetDownstreamStages: vi.fn(),
  mockCanActivateStage: vi.fn(),
  mockFilterSourcesByContract: vi.fn(),
  mockPropagateTermination: vi.fn(),
  mockFinalizeAdvisoryRun: vi.fn(),
  mockFinalizeDeliveryRun: vi.fn(),
  mockWriteEnvelopeFile: vi.fn(),
  mockCopyUpstreamArtifacts: vi.fn(),
  mockCompactCodingResult: vi.fn(),
  mockStartSupervisorLoop: vi.fn(),
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
    resolveWorkflowContent: vi.fn((workflow: string) => `resolved:${workflow}`),
    getTemplate: vi.fn(),
    getReviewPolicy: vi.fn(() => null),
  },
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
  ReviewEngine: {
    evaluate: vi.fn(() => undefined),
  },
}));

vi.mock('./prompt-builder', () => ({
  buildRolePrompt: (...args: any[]) => mockBuildRolePrompt(...args),
  buildRoleSwitchPrompt: (...args: any[]) => mockBuildRoleSwitchPrompt(...args),
  buildDeliveryPrompt: (...args: any[]) => mockBuildDeliveryPrompt(...args),
  formatPromptArtifactLines: vi.fn(() => []),
  extractReviewDecision: (...args: any[]) => mockExtractReviewDecision(...args),
  parseDecisionMarker: vi.fn(),
  getCopiedArtifactPath: vi.fn(),
}));

vi.mock('./supervisor', () => ({
  startSupervisorLoop: (...args: any[]) => mockStartSupervisorLoop(...args),
  summarizeStepForSupervisor: vi.fn(),
  SUPERVISOR_MODEL: 'MODEL_PLACEHOLDER_SUP',
}));

vi.mock('./run-artifacts', () => ({
  readDeliveryPacket: vi.fn(),
  buildWriteScopeAudit: vi.fn(),
  scanArtifactManifest: vi.fn(),
  copyUpstreamArtifacts: (...args: any[]) => mockCopyUpstreamArtifacts(...args),
  buildResultEnvelope: vi.fn(),
  writeEnvelopeFile: (...args: any[]) => mockWriteEnvelopeFile(...args),
}));

vi.mock('./runtime-helpers', () => ({
  isAuthoritativeConversation: vi.fn((run: any, conversationId: string) => !!run && (!run.activeConversationId || run.activeConversationId === conversationId)),
  cancelCascadeBestEffort: vi.fn(),
  propagateTermination: (...args: any[]) => mockPropagateTermination(...args),
  getFailureReason: vi.fn((result: any) => result?.blockers?.[0] || result?.summary),
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
  compactCodingResult: (...args: any[]) => mockCompactCodingResult(...args),
}));

vi.mock('./finalization', () => ({
  finalizeAdvisoryRun: (...args: any[]) => mockFinalizeAdvisoryRun(...args),
  finalizeDeliveryRun: (...args: any[]) => mockFinalizeDeliveryRun(...args),
}));

vi.mock('./scope-governor', () => ({
  checkWriteScopeConflicts: vi.fn(() => []),
}));

vi.mock('./pipeline/pipeline-registry', () => ({
  canActivateStage: (...args: any[]) => mockCanActivateStage(...args),
  filterSourcesByContract: (...args: any[]) => mockFilterSourcesByContract(...args),
  getDownstreamStages: (...args: any[]) => mockGetDownstreamStages(...args),
}));

vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { dispatchRun, interveneRun } from './group-runtime';

describe('group-runtime multi-role AgentBackend migration', () => {
  let tempWorkspace: string;
  let runState: any;
  let antigravityExecutor: any;
  let codexExecutor: any;

  beforeEach(() => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-group-multirole-'));
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
    mockResolveProvider.mockReset();
    mockGetExecutor.mockReset();
    mockGetStageDefinition.mockReset();
    mockCheckTokenQuota.mockReset();
    mockShouldAutoRequestQuota.mockReset();
    mockSubmitApprovalRequest.mockReset();
    mockUpdatePipelineStage.mockReset();
    mockUpdatePipelineStageByStageId.mockReset();
    mockGetProject.mockReset();
    mockAddRunToProject.mockReset();
    mockTrackStageDispatch.mockReset();
    mockEmitProjectEvent.mockReset();
    mockBuildRolePrompt.mockReset();
    mockBuildRoleSwitchPrompt.mockReset();
    mockBuildDeliveryPrompt.mockReset();
    mockExtractReviewDecision.mockReset();
    mockBuildRoleInputReadAudit.mockReset();
    mockEnforceCanonicalInputReadProtocol.mockReset();
    mockGetCanonicalTaskEnvelope.mockReset();
    mockGetDownstreamStages.mockReset();
    mockCanActivateStage.mockReset();
    mockFilterSourcesByContract.mockReset();
    mockPropagateTermination.mockReset();
    mockFinalizeAdvisoryRun.mockReset();
    mockFinalizeDeliveryRun.mockReset();
    mockWriteEnvelopeFile.mockReset();
    mockCopyUpstreamArtifacts.mockReset();
    mockCompactCodingResult.mockReset();
    mockStartSupervisorLoop.mockReset();
    mockGrpc.addTrackedWorkspace.mockReset();
    mockGrpc.startCascade.mockReset();
    mockGrpc.updateConversationAnnotations.mockReset();
    mockGrpc.sendMessage.mockReset();
    mockGrpc.cancelCascade.mockReset();
    mockGrpc.proceedArtifact.mockReset();

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
        handle: 'cascade-default',
        content: '',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
      cancel: vi.fn(async () => undefined),
      appendMessage: vi.fn(async () => ({
        handle: 'cascade-default',
        content: 'append',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
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
      appendMessage: vi.fn(async () => ({
        handle: 'codex-thread-1',
        content: 'append',
        steps: [],
        changedFiles: [],
        status: 'completed' as const,
      })),
    };

    mockCreateRun.mockImplementation((input: any) => {
      runState = {
        runId: 'run-1',
        status: 'queued',
        createdAt: '2026-04-09T00:00:00.000Z',
        workspace: input.workspace,
        stageId: input.stageId,
        prompt: input.prompt,
        templateId: input.templateId,
        projectId: input.projectId,
        model: input.model || 'MODEL_PLACEHOLDER_M26',
        liveState: undefined,
        roles: [],
        ...input,
      };
      return runState;
    });

    mockUpdateRun.mockImplementation((_runId: string, updates: any) => {
      runState = { ...runState, ...updates };
      return runState;
    });

    mockGetRun.mockImplementation(() => runState);
    mockDiscoverLanguageServers.mockReturnValue([{ port: 1, csrf: 'csrf', workspace: tempWorkspace }]);
    mockGetApiKey.mockReturnValue('api-key');
    mockGetOwnerConnection.mockReturnValue({ port: 1, csrf: 'csrf', apiKey: 'api-key' });
    mockCheckTokenQuota.mockReturnValue({ allowed: true, remaining: 1000 });
    mockShouldAutoRequestQuota.mockReturnValue(false);
    mockGetProject.mockReturnValue({ pipelineState: { status: 'running', stages: [] } });
    mockGetCanonicalTaskEnvelope.mockImplementation((_runId: string, fallback: any) => fallback);
    mockBuildRoleInputReadAudit.mockReturnValue({ status: 'verified', entries: [] });
    mockEnforceCanonicalInputReadProtocol.mockImplementation((_roleId: string, result: any) => result);
    mockGetDownstreamStages.mockReturnValue([]);
    mockCanActivateStage.mockReturnValue({ ready: false, missingUpstreams: [] });
    mockFilterSourcesByContract.mockImplementation((_templateId: string, _stageId: string, runIds: string[]) => runIds);
    mockPropagateTermination.mockImplementation((_runId: string, status: string, reason?: string) => {
      runState = {
        ...runState,
        status,
        lastError: reason,
      };
    });
    mockGetExecutor.mockImplementation((provider: string) => provider === 'codex' ? codexExecutor : antigravityExecutor);
    mockBuildRoleSwitchPrompt.mockImplementation(() => 'switch prompt');
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  });

  it('dispatches delivery-single-pass runs through AgentBackend sessions and finalizes delivery', async () => {
    vi.useFakeTimers();
    mockResolveProvider.mockReturnValue({ provider: 'antigravity', model: 'MODEL_PLACEHOLDER_M26', source: 'default' });
    mockGetStageDefinition.mockReturnValue({
      id: 'delivery-stage',
      templateId: 'tpl-delivery',
      executionMode: 'delivery-single-pass',
      capabilities: { delivery: true },
      roles: [{ id: 'delivery-author', workflow: '/delivery-worker', timeoutMs: 60_000, autoApprove: false }],
    });
    mockBuildDeliveryPrompt.mockReturnValue('delivery prompt');
    mockCompactCodingResult.mockReturnValue({
      status: 'completed',
      summary: 'delivery done',
      changedFiles: ['src/app.ts'],
      blockers: [],
      needsReview: [],
    });
    antigravityExecutor.executeTask.mockResolvedValue({
      handle: 'cascade-delivery',
      content: '',
      steps: [],
      changedFiles: [],
      status: 'completed' as const,
    });
    mockWatchConversation.mockImplementation((_conn: any, handle: string, onUpdate: any) => {
      if (handle === 'cascade-delivery') {
        setTimeout(() => {
          onUpdate({
            steps: [],
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
            steps: [],
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

    const result = await dispatchRun({
      workspace: `file://${tempWorkspace}`,
      templateId: 'tpl-delivery',
      stageId: 'delivery-stage',
      prompt: '交付新版能力',
      model: 'MODEL_PLACEHOLDER_M26',
    });

    await vi.advanceTimersByTimeAsync(1700);
    await Promise.resolve();

    expect(result).toEqual({ runId: 'run-1' });
    expect(antigravityExecutor.executeTask).toHaveBeenCalledWith(expect.objectContaining({
      workspace: tempWorkspace,
      prompt: 'delivery prompt',
      roleId: 'delivery-author',
      stageId: 'delivery-stage',
      artifactDir: expect.stringContaining('runs/run-1/'),
    }));
    expect(mockStartSupervisorLoop).toHaveBeenCalledWith(
      'run-1',
      'cascade-delivery',
      '交付新版能力',
      'api-key',
      expect.objectContaining({ port: 1, csrf: 'csrf' }),
      `file://${tempWorkspace}`,
    );
    expect(mockFinalizeDeliveryRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ id: 'delivery-stage' }),
      expect.stringContaining(path.join('runs', 'run-1')),
      expect.objectContaining({ status: 'completed', summary: 'delivery done' }),
      undefined,
    );
    expect(runState.activeConversationId).toBe('cascade-delivery');
    expect(runState.roles).toHaveLength(1);
    expect(runState.roles[0]).toEqual(expect.objectContaining({
      roleId: 'delivery-author',
      childConversationId: 'cascade-delivery',
      status: 'completed',
    }));
  });

  it('runs review-loop isolated roles through AgentBackend sessions across revise and approve rounds', async () => {
    mockResolveProvider.mockReturnValue({ provider: 'codex', model: 'MODEL_PLACEHOLDER_M26', source: 'default' });
    mockGetStageDefinition.mockReturnValue({
      id: 'review-stage',
      templateId: 'tpl-review',
      executionMode: 'review-loop',
      capabilities: { advisory: true, emitsManifest: true },
      reviewPolicyId: 'policy-review',
      roles: [
        { id: 'author', workflow: '/author', timeoutMs: 60_000, autoApprove: false },
        { id: 'reviewer', workflow: '/reviewer', timeoutMs: 60_000, autoApprove: false },
      ],
    });
    mockBuildRolePrompt.mockImplementation((role: any, _goal: string, _artifactDir: string, _artifactAbsDir: string, round: number, isReviewer: boolean) => (
      `${role.id}-round-${round}-${isReviewer ? 'reviewer' : 'author'}`
    ));
    mockExtractReviewDecision
      .mockReturnValueOnce('revise')
      .mockReturnValueOnce('approved');

    codexExecutor.executeTask.mockImplementation(async (input: any) => {
      const artifactAbsDir = path.join(tempWorkspace, input.artifactDir);
      if (input.roleId === 'author') {
        fs.mkdirSync(path.join(artifactAbsDir, 'specs'), { recursive: true });
        fs.writeFileSync(path.join(artifactAbsDir, 'specs', `round-${runState.currentRound || 1}.md`), 'spec body');
      }

      return {
        handle: `codex-thread-${input.roleId}-${runState.currentRound || 1}`,
        content: `${input.roleId} completed`,
        steps: [],
        changedFiles: input.roleId === 'author' ? ['specs/spec.md'] : [],
        status: 'completed' as const,
      };
    });

    const result = await dispatchRun({
      workspace: `file://${tempWorkspace}`,
      templateId: 'tpl-review',
      stageId: 'review-stage',
      prompt: '编写并审查方案',
      model: 'MODEL_PLACEHOLDER_M26',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result).toEqual({ runId: 'run-1' });
    expect(codexExecutor.executeTask).toHaveBeenCalledTimes(4);
    expect(codexExecutor.executeTask.mock.calls.map((call) => call[0].roleId)).toEqual([
      'author',
      'reviewer',
      'author',
      'reviewer',
    ]);
    expect(mockFinalizeAdvisoryRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ id: 'review-stage' }),
      expect.stringContaining(path.join('runs', 'run-1')),
      'approved',
      expect.objectContaining({ status: 'completed' }),
    );
    expect(runState.currentRound).toBe(2);
    expect(runState.reviewOutcome).toBe('approved');
    expect(runState.status).toBe('completed');
    expect(runState.roles).toHaveLength(4);
  });

  it('reuses author handles through attached sessions for shared-conversation review rounds', async () => {
    vi.useFakeTimers();
    mockResolveProvider.mockReturnValue({ provider: 'antigravity', model: 'MODEL_PLACEHOLDER_M26', source: 'default' });
    mockGetStageDefinition.mockReturnValue({
      id: 'review-stage',
      templateId: 'tpl-review',
      executionMode: 'review-loop',
      capabilities: { advisory: true, emitsManifest: true },
      reviewPolicyId: 'policy-review',
      roles: [
        { id: 'author', workflow: '/author', timeoutMs: 60_000, autoApprove: false },
        { id: 'reviewer', workflow: '/reviewer', timeoutMs: 60_000, autoApprove: false },
      ],
    });
    mockBuildRolePrompt.mockImplementation((role: any, _goal: string, _artifactDir: string, _artifactAbsDir: string, round: number, isReviewer: boolean) => (
      `${role.id}-round-${round}-${isReviewer ? 'reviewer' : 'author'}`
    ));
    mockBuildRoleSwitchPrompt.mockReturnValue('switch prompt');
    mockExtractReviewDecision
      .mockReturnValueOnce('revise')
      .mockReturnValueOnce('approved');
    mockCompactCodingResult.mockReturnValue({
      status: 'completed',
      summary: 'shared done',
      changedFiles: [],
      blockers: [],
      needsReview: [],
    });

    const handlePlan = ['cascade-author-r1', 'cascade-reviewer-r1', 'cascade-reviewer-r2'];
    antigravityExecutor.executeTask.mockImplementation(async () => ({
      handle: handlePlan.shift() || 'cascade-fallback',
      content: '',
      steps: [],
      changedFiles: [],
      status: 'completed' as const,
    }));

    const watchCounts = new Map<string, number>();
    mockWatchConversation.mockImplementation((_conn: any, handle: string, onUpdate: any) => {
      const count = (watchCounts.get(handle) || 0) + 1;
      watchCounts.set(handle, count);

      if (handle === 'cascade-author-r1' && count === 1 && runState?.artifactDir) {
        const artifactAbsDir = path.join(tempWorkspace, runState.artifactDir);
        fs.mkdirSync(path.join(artifactAbsDir, 'specs'), { recursive: true });
        fs.writeFileSync(path.join(artifactAbsDir, 'specs', 'shared-author.md'), 'shared author output');
      }

      setTimeout(() => {
        onUpdate({
          steps: [],
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
          steps: [],
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

    const result = await dispatchRun({
      workspace: `file://${tempWorkspace}`,
      templateId: 'tpl-review',
      stageId: 'review-stage',
      prompt: '共享对话复审',
      model: 'MODEL_PLACEHOLDER_M26',
      conversationMode: 'shared',
    });

    for (let index = 0; index < 6; index++) {
      await vi.advanceTimersByTimeAsync(2200);
      await Promise.resolve();
    }

    expect(result).toEqual({ runId: 'run-1' });
    expect(antigravityExecutor.executeTask).toHaveBeenCalledTimes(3);
    expect(antigravityExecutor.executeTask.mock.calls.map((call) => call[0].roleId)).toEqual([
      'author',
      'reviewer',
      'reviewer',
    ]);
    expect(mockBuildRoleSwitchPrompt).toHaveBeenCalledTimes(1);
    expect(mockGrpc.sendMessage).toHaveBeenCalledWith(
      1,
      'csrf',
      'api-key',
      'cascade-author-r1',
      'switch prompt',
      'MODEL_PLACEHOLDER_M26',
    );
    expect(mockFinalizeAdvisoryRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ id: 'review-stage' }),
      expect.stringContaining(path.join('runs', 'run-1')),
      'approved',
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('propagates failed terminal sessions for delivery-single-pass runs', async () => {
    mockResolveProvider.mockReturnValue({ provider: 'codex', model: 'MODEL_PLACEHOLDER_M26', source: 'default' });
    mockGetStageDefinition.mockReturnValue({
      id: 'delivery-stage',
      templateId: 'tpl-delivery',
      executionMode: 'delivery-single-pass',
      capabilities: { delivery: true },
      roles: [{ id: 'delivery-author', workflow: '/delivery-worker', timeoutMs: 60_000, autoApprove: false }],
    });
    mockBuildDeliveryPrompt.mockReturnValue('delivery prompt');
    codexExecutor.executeTask.mockRejectedValue(new Error('codex crashed'));

    const result = await dispatchRun({
      workspace: `file://${tempWorkspace}`,
      templateId: 'tpl-delivery',
      stageId: 'delivery-stage',
      prompt: '交付失败路径',
      model: 'MODEL_PLACEHOLDER_M26',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result).toEqual({ runId: 'run-1' });
    expect(mockPropagateTermination).toHaveBeenCalledWith('run-1', 'failed', 'codex crashed');
    expect(mockFinalizeDeliveryRun).not.toHaveBeenCalled();
    expect(runState.status).toBe('failed');
    expect(runState.roles[0]).toEqual(expect.objectContaining({
      roleId: 'delivery-author',
      status: 'failed',
    }));
  });

  it('propagates completed-but-blocked delivery results instead of finalizing success', async () => {
    mockResolveProvider.mockReturnValue({ provider: 'codex', model: 'MODEL_PLACEHOLDER_M26', source: 'default' });
    mockGetStageDefinition.mockReturnValue({
      id: 'delivery-stage',
      templateId: 'tpl-delivery',
      executionMode: 'delivery-single-pass',
      capabilities: { delivery: true },
      roles: [{ id: 'delivery-author', workflow: '/delivery-worker', timeoutMs: 60_000, autoApprove: false }],
    });
    mockBuildDeliveryPrompt.mockReturnValue('delivery prompt');
    codexExecutor.executeTask.mockResolvedValue({
      handle: 'codex-thread-blocked',
      content: 'waiting for review',
      steps: [],
      changedFiles: [],
      status: 'blocked' as const,
    });

    const result = await dispatchRun({
      workspace: `file://${tempWorkspace}`,
      templateId: 'tpl-delivery',
      stageId: 'delivery-stage',
      prompt: '交付阻塞路径',
      model: 'MODEL_PLACEHOLDER_M26',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result).toEqual({ runId: 'run-1' });
    expect(mockPropagateTermination).toHaveBeenCalledWith('run-1', 'blocked', 'waiting for review');
    expect(mockFinalizeDeliveryRun).not.toHaveBeenCalled();
    expect(runState.status).toBe('blocked');
    expect(runState.roles[0]).toEqual(expect.objectContaining({
      roleId: 'delivery-author',
      status: 'blocked',
    }));
  });

  it('propagates failed terminal sessions during review-loop before finalization', async () => {
    mockResolveProvider.mockReturnValue({ provider: 'codex', model: 'MODEL_PLACEHOLDER_M26', source: 'default' });
    mockGetStageDefinition.mockReturnValue({
      id: 'review-stage',
      templateId: 'tpl-review',
      executionMode: 'review-loop',
      capabilities: { advisory: true, emitsManifest: true },
      reviewPolicyId: 'policy-review',
      roles: [
        { id: 'author', workflow: '/author', timeoutMs: 60_000, autoApprove: false },
        { id: 'reviewer', workflow: '/reviewer', timeoutMs: 60_000, autoApprove: false },
      ],
    });
    mockBuildRolePrompt.mockImplementation((role: any) => role.id);
    codexExecutor.executeTask.mockRejectedValue(new Error('review author crashed'));

    const result = await dispatchRun({
      workspace: `file://${tempWorkspace}`,
      templateId: 'tpl-review',
      stageId: 'review-stage',
      prompt: '失败复审路径',
      model: 'MODEL_PLACEHOLDER_M26',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result).toEqual({ runId: 'run-1' });
    expect(mockPropagateTermination).toHaveBeenCalledWith('run-1', 'failed', 'review author crashed');
    expect(mockFinalizeAdvisoryRun).not.toHaveBeenCalled();
    expect(runState.status).toBe('failed');
    expect(runState.roles).toHaveLength(1);
    expect(runState.roles[0]).toEqual(expect.objectContaining({
      roleId: 'author',
      status: 'failed',
    }));
  });

  it('propagates completed-but-blocked reviewer results instead of extracting a decision', async () => {
    mockResolveProvider.mockReturnValue({ provider: 'codex', model: 'MODEL_PLACEHOLDER_M26', source: 'default' });
    mockGetStageDefinition.mockReturnValue({
      id: 'review-stage',
      templateId: 'tpl-review',
      executionMode: 'review-loop',
      capabilities: { advisory: true, emitsManifest: true },
      reviewPolicyId: 'policy-review',
      roles: [
        { id: 'author', workflow: '/author', timeoutMs: 60_000, autoApprove: false },
        { id: 'reviewer', workflow: '/reviewer', timeoutMs: 60_000, autoApprove: false },
      ],
    });
    mockBuildRolePrompt.mockImplementation((role: any) => role.id);
    codexExecutor.executeTask.mockImplementation(async (input: any) => {
      const artifactAbsDir = path.join(tempWorkspace, input.artifactDir);
      if (input.roleId === 'author') {
        fs.mkdirSync(path.join(artifactAbsDir, 'specs'), { recursive: true });
        fs.writeFileSync(path.join(artifactAbsDir, 'specs', 'review-author.md'), 'author output');
        return {
          handle: 'codex-thread-author',
          content: 'author completed',
          steps: [],
          changedFiles: ['specs/review-author.md'],
          status: 'completed' as const,
        };
      }

      return {
        handle: 'codex-thread-reviewer',
        content: 'review needs clarification',
        steps: [],
        changedFiles: [],
        status: 'blocked' as const,
      };
    });

    const result = await dispatchRun({
      workspace: `file://${tempWorkspace}`,
      templateId: 'tpl-review',
      stageId: 'review-stage',
      prompt: '阻塞复审路径',
      model: 'MODEL_PLACEHOLDER_M26',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result).toEqual({ runId: 'run-1' });
    expect(mockPropagateTermination).toHaveBeenCalledWith('run-1', 'blocked', 'review needs clarification');
    expect(mockExtractReviewDecision).not.toHaveBeenCalled();
    expect(mockFinalizeAdvisoryRun).not.toHaveBeenCalled();
    expect(runState.status).toBe('blocked');
    expect(runState.roles).toHaveLength(2);
    expect(runState.roles[1]).toEqual(expect.objectContaining({
      roleId: 'reviewer',
      status: 'blocked',
    }));
  });

  it('rejects nudging active codex sessions that do not support append', async () => {
    const sessionRegistry = (globalThis as any).__AGENT_SESSION_REGISTRY__ || new Map();
    (globalThis as any).__AGENT_SESSION_REGISTRY__ = sessionRegistry;
    sessionRegistry.set('run-1', {
      runId: 'run-1',
      providerId: 'codex',
      handle: 'codex-run-1',
      session: {
        runId: 'run-1',
        providerId: 'codex',
        handle: 'codex-run-1',
        capabilities: {
          supportsAppend: false,
          supportsCancel: true,
          emitsLiveState: false,
          emitsRawSteps: false,
          emitsStreamingText: false,
        },
        events: async function* () { },
        append: async () => undefined,
        cancel: async () => undefined,
      },
      cancelRequested: false,
      terminalSeen: false,
      registeredAt: '2026-04-09T00:00:00.000Z',
    });

    runState = {
      runId: 'run-1',
      status: 'running',
      workspace: `file://${tempWorkspace}`,
      templateId: 'tpl-review',
      stageId: 'review-stage',
      pipelineStageId: 'review-stage',
      prompt: '编写并审查方案',
      model: 'MODEL_PLACEHOLDER_M26',
      liveState: {
        cascadeStatus: 'idle',
        stepCount: 3,
        lastStepAt: '2026-04-09T00:00:00.000Z',
        staleSince: '2026-04-09T00:01:00.000Z',
      },
      roles: [{ roleId: 'author', round: 1, childConversationId: 'codex-run-1', status: 'running' }],
      childConversationId: 'codex-run-1',
      activeConversationId: 'codex-run-1',
    };
    mockGetRun.mockImplementation(() => runState);
    mockGetStageDefinition.mockReturnValue({
      id: 'review-stage',
      templateId: 'tpl-review',
      executionMode: 'review-loop',
      reviewPolicyId: 'policy-review',
      roles: [
        { id: 'author', workflow: '/author', timeoutMs: 60_000, autoApprove: false },
        { id: 'reviewer', workflow: '/reviewer', timeoutMs: 60_000, autoApprove: false },
      ],
    });

    await expect(interveneRun('run-1', 'nudge', '继续完善')).rejects.toThrow("provider 'codex' does not support append");
    expect(mockGrpc.sendMessage).not.toHaveBeenCalled();
  });

  it('calls afterRun memory hooks for each completed role session in review-loop', async () => {
    const { registerMemoryHook, clearMemoryHooks } = await import('../backends');
    clearMemoryHooks();

    const afterRunSpy = vi.fn();
    registerMemoryHook({
      id: 'test-afterRun-hook',
      afterRun: afterRunSpy,
    });

    mockResolveProvider.mockReturnValue({ provider: 'codex', model: 'MODEL_PLACEHOLDER_M26', source: 'default' });
    mockGetStageDefinition.mockReturnValue({
      id: 'review-stage',
      templateId: 'tpl-review',
      executionMode: 'review-loop',
      capabilities: { advisory: true, emitsManifest: true },
      reviewPolicyId: 'policy-review',
      roles: [
        { id: 'author', workflow: '/author', timeoutMs: 60_000, autoApprove: false },
        { id: 'reviewer', workflow: '/reviewer', timeoutMs: 60_000, autoApprove: false },
      ],
    });
    mockBuildRolePrompt.mockImplementation((role: any) => role.id);
    mockExtractReviewDecision.mockReturnValueOnce('approved');

    codexExecutor.executeTask.mockImplementation(async (input: any) => {
      const artifactAbsDir = path.join(tempWorkspace, input.artifactDir);
      if (input.roleId === 'author') {
        fs.mkdirSync(path.join(artifactAbsDir, 'specs'), { recursive: true });
        fs.writeFileSync(path.join(artifactAbsDir, 'specs', 'memory-test.md'), 'memory test');
      }
      return {
        handle: `codex-thread-${input.roleId}`,
        content: `${input.roleId} completed`,
        steps: [],
        changedFiles: input.roleId === 'author' ? ['specs/memory-test.md'] : [],
        status: 'completed' as const,
      };
    });

    await dispatchRun({
      workspace: `file://${tempWorkspace}`,
      templateId: 'tpl-review',
      stageId: 'review-stage',
      prompt: '验证 afterRun hooks',
      model: 'MODEL_PLACEHOLDER_M26',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // afterRun should have been called once per role: author + reviewer = 2 calls
    expect(afterRunSpy).toHaveBeenCalledTimes(2);
    expect(afterRunSpy.mock.calls[0][0]).toEqual(expect.objectContaining({
      providerId: 'codex',
      event: expect.objectContaining({ kind: 'completed' }),
    }));
    expect(afterRunSpy.mock.calls[1][0]).toEqual(expect.objectContaining({
      providerId: 'codex',
      event: expect.objectContaining({ kind: 'completed' }),
    }));

    clearMemoryHooks();
  });
});