import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/bridge/gateway', () => ({
  getAllConnections: vi.fn(async () => []),
  getConversations: vi.fn(() => []),
  addLocalConversation: vi.fn(),
  refreshOwnerMap: vi.fn(async () => {}),
  convOwnerMap: new Map(),
  preRegisterOwner: vi.fn(),
  getApiKey: vi.fn(() => 'antigravity-key'),
  discoverLanguageServers: vi.fn(async () => []),
  getLanguageServer: vi.fn(async () => null),
  generatePlaygroundName: vi.fn(() => 'playground-demo'),
  PLAYGROUND_DIR_PATH: '/tmp/playground',
  grpc: {
    addTrackedWorkspace: vi.fn(async () => ({})),
    startCascade: vi.fn(async () => ({ cascadeId: 'cascade-1' })),
    updateConversationAnnotations: vi.fn(async () => ({})),
    loadTrajectory: vi.fn(async () => ({})),
    getAllCascadeTrajectories: vi.fn(async () => ({ trajectorySummaries: {} })),
  },
}));

vi.mock('@/lib/providers', () => ({
  resolveProvider: vi.fn(() => ({ provider: 'native-codex' })),
}));

vi.mock('@/lib/local-provider-conversations', () => ({
  buildLocalProviderConversationId: vi.fn(() => 'local-native-codex-123'),
  isSupportedLocalProvider: (provider: string | null | undefined) => (
    provider === 'codex'
    || provider === 'native-codex'
    || provider === 'claude-api'
    || provider === 'openai-api'
    || provider === 'gemini-api'
    || provider === 'grok-api'
    || provider === 'custom'
  ),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { addLocalConversation, getLanguageServer } from '@/lib/bridge/gateway';
import { resolveProvider } from '@/lib/providers';
import { buildLocalProviderConversationId } from '@/lib/local-provider-conversations';
import { POST } from './route';

function makeRequest(workspace: string) {
  return new Request('http://localhost/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace }),
  });
}

describe('POST /api/conversations', () => {
  beforeEach(() => {
    vi.mocked(addLocalConversation).mockClear();
    vi.mocked(getLanguageServer).mockClear();
    vi.mocked(resolveProvider).mockReset();
  });

  it('creates local native-codex conversations without requiring IDE routing', async () => {
    vi.mocked(resolveProvider).mockReturnValue({ provider: 'native-codex' } as never);
    vi.mocked(buildLocalProviderConversationId).mockReturnValue('local-native-codex-123');

    const res = await POST(makeRequest('file:///tmp/ceo-workspace'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cascadeId: 'local-native-codex-123',
      state: 'idle',
      provider: 'native-codex',
    });
    expect(vi.mocked(addLocalConversation)).toHaveBeenCalledWith(
      'local-native-codex-123',
      'file:///tmp/ceo-workspace',
      'Native Codex: ceo-workspace',
      expect.objectContaining({
        provider: 'native-codex',
        sessionHandle: '',
      }),
    );
    expect(vi.mocked(getLanguageServer)).not.toHaveBeenCalled();
  });

  it('creates local API-backed conversations without requiring IDE routing', async () => {
    vi.mocked(resolveProvider).mockReturnValue({ provider: 'claude-api' } as never);
    vi.mocked(buildLocalProviderConversationId).mockReturnValue('local-claude-api-123');

    const res = await POST(makeRequest('file:///tmp/api-workspace'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cascadeId: 'local-claude-api-123',
      state: 'idle',
      provider: 'claude-api',
    });
    expect(vi.mocked(addLocalConversation)).toHaveBeenCalledWith(
      'local-claude-api-123',
      'file:///tmp/api-workspace',
      'Claude API: api-workspace',
      expect.objectContaining({
        provider: 'claude-api',
      }),
    );
    expect(vi.mocked(getLanguageServer)).not.toHaveBeenCalled();
  });

  it('keeps Antigravity workspaces on the original language-server path', async () => {
    vi.mocked(resolveProvider).mockReturnValue({ provider: 'antigravity' } as never);
    vi.mocked(getLanguageServer).mockResolvedValue(null as never);

    const res = await POST(makeRequest('file:///tmp/antigravity-workspace'));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'workspace_not_running',
      message: 'Workspace is not running. Please open it in Antigravity first.',
      workspace: 'file:///tmp/antigravity-workspace',
    });
    expect(vi.mocked(addLocalConversation)).not.toHaveBeenCalled();
    expect(vi.mocked(getLanguageServer)).toHaveBeenCalledWith('file:///tmp/antigravity-workspace');
  });
});
