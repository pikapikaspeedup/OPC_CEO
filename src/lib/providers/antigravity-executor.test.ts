import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDiscoverLanguageServers,
  mockGetApiKey,
  mockGetOwnerConnection,
  mockPreRegisterOwner,
  mockAppendRunHistoryEntry,
  mockGrpc,
} = vi.hoisted(() => ({
  mockDiscoverLanguageServers: vi.fn(),
  mockGetApiKey: vi.fn(),
  mockGetOwnerConnection: vi.fn(),
  mockPreRegisterOwner: vi.fn(),
  mockAppendRunHistoryEntry: vi.fn(),
  mockGrpc: {
    addTrackedWorkspace: vi.fn(),
    startCascade: vi.fn(),
    updateConversationAnnotations: vi.fn(),
    sendMessage: vi.fn(),
    cancelCascade: vi.fn(),
  },
}));

vi.mock('../bridge/gateway', () => ({
  discoverLanguageServers: (...args: any[]) => mockDiscoverLanguageServers(...args),
  getApiKey: (...args: any[]) => mockGetApiKey(...args),
  getOwnerConnection: (...args: any[]) => mockGetOwnerConnection(...args),
  preRegisterOwner: (...args: any[]) => mockPreRegisterOwner(...args),
  grpc: mockGrpc,
}));

vi.mock('../agents/run-history', () => ({
  appendRunHistoryEntry: (...args: any[]) => mockAppendRunHistoryEntry(...args),
}));

import { AntigravityExecutor } from './antigravity-executor';

describe('AntigravityExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApiKey.mockReturnValue('api-key');
    mockDiscoverLanguageServers.mockResolvedValue([
      { port: 4315, csrf: 'csrf-token', workspace: '/tmp/workspace' },
    ]);
    mockGetOwnerConnection.mockResolvedValue({
      port: 4315,
      csrf: 'csrf-token',
      apiKey: 'owner-api-key',
      stepCount: 0,
    });
    mockGrpc.addTrackedWorkspace.mockResolvedValue(undefined);
    mockGrpc.startCascade.mockResolvedValue({ cascadeId: 'cascade-1' });
    mockGrpc.updateConversationAnnotations.mockResolvedValue(undefined);
    mockGrpc.sendMessage.mockResolvedValue(undefined);
    mockGrpc.cancelCascade.mockResolvedValue(undefined);
  });

  it('routes appendMessage through the owning connection instead of servers[0]', async () => {
    const executor = new AntigravityExecutor();

    await executor.appendMessage('cascade-123', {
      prompt: 'Continue the task',
    });

    expect(mockGetOwnerConnection).toHaveBeenCalledWith('cascade-123');
    expect(mockGrpc.sendMessage).toHaveBeenCalledWith(
      4315,
      'csrf-token',
      'owner-api-key',
      'cascade-123',
      'Continue the task',
      'MODEL_PLACEHOLDER_M26',
    );
  });

  it('surfaces cancel failures instead of swallowing them', async () => {
    mockGrpc.cancelCascade.mockRejectedValueOnce(new Error('grpc timeout'));
    const executor = new AntigravityExecutor();

    await expect(executor.cancel('cascade-123')).rejects.toThrow(
      'Failed to cancel Antigravity cascade cascade-123: grpc timeout',
    );
  });

  it('rethrows addTrackedWorkspace failures that are not already-tracked warnings', async () => {
    mockGrpc.addTrackedWorkspace.mockRejectedValueOnce(new Error('permission denied'));
    const executor = new AntigravityExecutor();

    await expect(executor.executeTask({
      workspace: '/tmp/workspace',
      prompt: 'Do work',
    })).rejects.toThrow('permission denied');
  });

  it('tolerates already-tracked workspace errors and still dispatches the cascade', async () => {
    mockGrpc.addTrackedWorkspace.mockRejectedValueOnce(new Error('workspace already tracked'));
    const executor = new AntigravityExecutor();

    const result = await executor.executeTask({
      workspace: '/tmp/workspace',
      prompt: 'Ship the change',
      model: 'MODEL_PLACEHOLDER_M26',
      runId: 'run-12345678',
    });

    expect(result).toMatchObject({
      handle: 'cascade-1',
      status: 'completed',
    });
    expect(mockPreRegisterOwner).toHaveBeenCalledWith('cascade-1', {
      port: 4315,
      csrf: 'csrf-token',
      apiKey: 'api-key',
      stepCount: 0,
    });
  });
});
