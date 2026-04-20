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

vi.mock('@/lib/storage/gateway-db', () => ({
  listConversationProjections: vi.fn(() => []),
}));

import { addLocalConversation, getLanguageServer } from '@/lib/bridge/gateway';
import { listConversationProjections } from '@/lib/storage/gateway-db';
import { resolveProvider } from '@/lib/providers';
import { buildLocalProviderConversationId } from '@/lib/local-provider-conversations';
import { GET, POST } from './route';

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
    vi.mocked(listConversationProjections).mockReset();
  });

  it('reads conversation lists from the SQLite projection', async () => {
    vi.mocked(listConversationProjections).mockReturnValue([
      {
        id: 'cascade-1',
        title: 'Conversation One',
        workspace: 'file:///tmp/workspace',
        stepCount: 12,
        createdAt: '2026-04-20T10:00:00.000Z',
        updatedAt: '2026-04-20T10:05:00.000Z',
        lastActivityAt: '2026-04-20T10:06:00.000Z',
        visibility: 'visible',
        sourceKind: 'antigravity-live',
        isLocalOnly: false,
        mtimeMs: 123456,
      },
    ] as never);

    const res = await GET(new Request('http://localhost/api/conversations?workspace=file:///tmp/workspace'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [
        {
          id: 'cascade-1',
          title: 'Conversation One',
          workspace: 'file:///tmp/workspace',
          mtime: 123456,
          steps: 12,
        },
      ],
      page: 1,
      pageSize: 100,
      total: 1,
      hasMore: false,
    });
    expect(vi.mocked(listConversationProjections)).toHaveBeenCalledWith({ workspace: 'file:///tmp/workspace' });
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
