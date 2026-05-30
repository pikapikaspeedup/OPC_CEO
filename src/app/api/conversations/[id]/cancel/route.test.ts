import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/bridge/gateway', () => ({
  getOwnerConnection: vi.fn(),
  grpc: {
    cancelCascade: vi.fn(async () => ({ status: 'cancelled' })),
  },
  resolveConversationRecord: vi.fn(),
}));

vi.mock('@/lib/local-provider-conversations', () => ({
  inferLocalProviderFromConversation: vi.fn(),
}));

vi.mock('@/lib/api-provider-conversations', () => ({
  cancelApiConversationRequest: vi.fn(),
  isApiConversationProvider: vi.fn((provider: string | null | undefined) => provider === 'native-codex' || provider === 'claude-api'),
}));

vi.mock('@/server/shared/proxy', () => ({
  shouldProxyRuntimeRequest: vi.fn(() => false),
  proxyToRuntime: vi.fn(),
  runControlPlaneRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
  runControlPlaneThenRuntimeRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
  runRuntimeRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
}));

import { getOwnerConnection, grpc, resolveConversationRecord } from '@/lib/bridge/gateway';
import { inferLocalProviderFromConversation } from '@/lib/local-provider-conversations';
import { cancelApiConversationRequest } from '@/lib/api-provider-conversations';
import { POST } from './route';

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/conversations/[id]/cancel', () => {
  beforeEach(() => {
    vi.mocked(resolveConversationRecord).mockReset();
    vi.mocked(getOwnerConnection).mockReset();
    vi.mocked(inferLocalProviderFromConversation).mockReset();
    vi.mocked(cancelApiConversationRequest).mockReset();
    vi.mocked(grpc.cancelCascade).mockClear();
  });

  it('cancels API-backed provider-neutral conversations by business conversation id', async () => {
    vi.mocked(resolveConversationRecord).mockReturnValue({
      id: 'conversation-1',
      title: 'Provider-neutral thread',
      workspace: 'file:///tmp/workspace',
      stepCount: 2,
      provider: 'native-codex',
      sessionHandle: 'native-codex-session-1',
      providerSessions: {
        'native-codex': {
          provider: 'native-codex',
          sessionHandle: 'native-codex-session-1',
          updatedAt: '2026-05-18T00:00:00.000Z',
          stepCount: 2,
        },
      },
    } as never);
    vi.mocked(inferLocalProviderFromConversation).mockReturnValue('native-codex');
    vi.mocked(cancelApiConversationRequest).mockImplementation((conversationId: string) => conversationId === 'conversation-1');

    const res = await POST(new Request('http://localhost/api/conversations/conversation-1/cancel', { method: 'POST' }), params('conversation-1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      data: {
        status: 'cancelled',
        provider: 'native-codex',
      },
    });
    expect(vi.mocked(cancelApiConversationRequest)).toHaveBeenCalledWith('conversation-1');
    expect(vi.mocked(cancelApiConversationRequest)).not.toHaveBeenCalledWith('native-codex-session-1');
  });

  it('routes Antigravity cancel through the provider runtime handle', async () => {
    vi.mocked(resolveConversationRecord).mockReturnValue({
      id: 'conversation-1',
      title: 'Antigravity thread',
      workspace: 'file:///tmp/workspace',
      stepCount: 3,
      provider: 'antigravity',
      sessionHandle: 'ag-cascade-old',
      providerSessions: {
        antigravity: {
          provider: 'antigravity',
          sessionHandle: 'ag-cascade-1',
          updatedAt: '2026-05-18T00:00:00.000Z',
          stepCount: 3,
        },
      },
    } as never);
    vi.mocked(inferLocalProviderFromConversation).mockReturnValue(null);
    vi.mocked(getOwnerConnection).mockResolvedValue({
      port: 9211,
      csrf: 'csrf-token',
      apiKey: 'ag-key',
      stepCount: 3,
    } as never);

    const res = await POST(new Request('http://localhost/api/conversations/conversation-1/cancel', { method: 'POST' }), params('conversation-1'));

    expect(res.status).toBe(200);
    expect(vi.mocked(getOwnerConnection)).toHaveBeenCalledWith('ag-cascade-1');
    expect(vi.mocked(grpc.cancelCascade)).toHaveBeenCalledWith(9211, 'csrf-token', 'ag-key', 'ag-cascade-1');
  });
});
