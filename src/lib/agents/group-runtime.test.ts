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
  cancelCascadeBestEffort: vi.fn(),
  propagateTermination: vi.fn(),
  getFailureReason: vi.fn(),
  summarizeFailureText: vi.fn(),
  getCanonicalTaskEnvelope: vi.fn(),
  normalizeComparablePath: vi.fn(),
  includesPathCandidate: vi.fn(),
  extractStepReadEvidence: vi.fn(),
  filterEvidenceByCandidates: vi.fn(() => []),
  dedupeStringList: vi.fn((items: string[]) => items),
  buildRoleInputReadAudit: vi.fn(),
  enforceCanonicalInputReadProtocol: vi.fn(),
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
  filterSourcesByContract: vi.fn(),
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

import { cancelRun, dispatchRun } from './group-runtime';

describe('group-runtime characterization', () => {
  let tempWorkspace: string;
  let runState: any;

  beforeEach(() => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-group-runtime-'));
    runState = undefined;

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
    mockUpdatePipelineStage.mockReset();
    mockUpdatePipelineStageByStageId.mockReset();
    mockGetProject.mockReset();
    mockAddRunToProject.mockReset();
    mockTrackStageDispatch.mockReset();
    mockEmitProjectEvent.mockReset();

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

    mockResolveProvider.mockReturnValue({ provider: 'antigravity', model: 'MODEL_PLACEHOLDER_M26', source: 'default' });
    mockDiscoverLanguageServers.mockReturnValue([{ port: 1, csrf: 'csrf', workspace: tempWorkspace }]);
    mockGetApiKey.mockReturnValue('api-key');
    mockCheckTokenQuota.mockReturnValue({ allowed: true, remaining: 1000 });
    mockShouldAutoRequestQuota.mockReturnValue(false);
    mockWatchConversation.mockReturnValue(vi.fn());
    mockGrpc.addTrackedWorkspace.mockResolvedValue(undefined);
    mockGrpc.startCascade.mockResolvedValue({ cascadeId: 'cascade-1' });
    mockGrpc.updateConversationAnnotations.mockResolvedValue(undefined);
    mockGrpc.sendMessage.mockResolvedValue(undefined);
    mockGetProject.mockReturnValue({ pipelineState: { status: 'running', stages: [] } });
  });

  afterEach(() => {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  });

  it('dispatches legacy-single template runs through the child conversation path', async () => {
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

    expect(result).toEqual({ runId: 'run-1' });
    expect(mockCreateRun).toHaveBeenCalledWith(expect.objectContaining({
      stageId: 'implement',
      templateId: 'tpl-1',
      prompt: '修复登录接口',
    }));
    expect(mockCreateRun.mock.calls[0]?.[0]?.pipelineStageId).toBeUndefined();
    expect(mockResolveWorkflowContent).toHaveBeenCalledWith('/dev-worker');
    expect(mockGrpc.startCascade).toHaveBeenCalled();
    expect(mockGrpc.sendMessage).toHaveBeenCalledWith(
      1,
      'csrf',
      'api-key',
      'cascade-1',
      expect.stringContaining('resolved:/dev-worker\n\n修复登录接口'),
      'MODEL_PLACEHOLDER_M26',
      false,
      undefined,
      'ARTIFACT_REVIEW_MODE_TURBO',
    );
    expect(mockWatchConversation).toHaveBeenCalledWith(
      { port: 1, csrf: 'csrf' },
      'cascade-1',
      expect.any(Function),
      expect.any(Function),
      'api-key',
    );
    expect(runState.status).toBe('running');
    expect(runState.activeConversationId).toBe('cascade-1');
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

  it('cancels active cascades through owner connection and keeps project stage in sync', async () => {
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
});