import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/bridge/gateway', () => ({
  getOwnerConnection: vi.fn(),
  grpc: {
    revertToStep: vi.fn(async () => ({ stepCount: 2 })),
  },
  resolveConversationRecord: vi.fn(),
  updateLocalConversation: vi.fn(),
}));

vi.mock('@/lib/local-provider-conversations', () => ({
  inferLocalProviderFromConversation: vi.fn(),
  revertLocalProviderConversationSteps: vi.fn(() => []),
  writeLocalProviderConversationSteps: vi.fn((_: string, steps: unknown[]) => steps),
}));

vi.mock('@/lib/api-provider-conversations', () => ({
  isApiConversationProvider: vi.fn((provider: string | null | undefined) => provider === 'native-codex' || provider === 'claude-api'),
  revertApiConversation: vi.fn(async () => []),
}));

vi.mock('@/server/shared/proxy', () => ({
  proxyToRuntime: vi.fn(async () => Response.json({ proxied: true })),
  runControlPlaneRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
  runControlPlaneThenRuntimeRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
  runRuntimeRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
  shouldProxyRuntimeRequest: vi.fn(() => false),
}));

import { getOwnerConnection, grpc, resolveConversationRecord, updateLocalConversation } from '@/lib/bridge/gateway';
import {
  inferLocalProviderFromConversation,
  revertLocalProviderConversationSteps,
  writeLocalProviderConversationSteps,
} from '@/lib/local-provider-conversations';
import { revertApiConversation } from '@/lib/api-provider-conversations';
import { proxyToRuntime, shouldProxyRuntimeRequest } from '@/server/shared/proxy';
import { POST } from './route';

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/conversations/conversation-1/revert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/conversations/[id]/revert', () => {
  beforeEach(() => {
    vi.mocked(resolveConversationRecord).mockReset();
    vi.mocked(getOwnerConnection).mockReset();
    vi.mocked(updateLocalConversation).mockReset();
    vi.mocked(inferLocalProviderFromConversation).mockReset();
    vi.mocked(revertLocalProviderConversationSteps).mockReset();
    vi.mocked(revertLocalProviderConversationSteps).mockReturnValue([]);
    vi.mocked(writeLocalProviderConversationSteps).mockClear();
    vi.mocked(revertApiConversation).mockReset();
    vi.mocked(proxyToRuntime).mockClear();
    vi.mocked(shouldProxyRuntimeRequest).mockReset();
    vi.mocked(shouldProxyRuntimeRequest).mockReturnValue(false);
    vi.mocked(grpc.revertToStep).mockClear();
  });

  it('reverts API provider sessions through providerSessions while updating the business record', async () => {
    const revertedSteps = [
      { type: 'CORTEX_STEP_TYPE_USER_INPUT' },
      { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' },
    ];
    vi.mocked(resolveConversationRecord).mockReturnValue({
      id: 'conversation-1',
      title: 'Provider-neutral thread',
      workspace: 'file:///tmp/workspace',
      stepCount: 4,
      provider: 'claude-api',
      sessionHandle: 'claude-api-session-current',
      providerSessions: {
        'native-codex': {
          provider: 'native-codex',
          sessionHandle: 'native-codex-session-1',
          updatedAt: '2026-05-18T00:00:00.000Z',
          stepCount: 2,
        },
        'claude-api': {
          provider: 'claude-api',
          sessionHandle: 'claude-api-session-1',
          updatedAt: '2026-05-18T00:01:00.000Z',
          stepCount: 4,
        },
      },
    } as never);
    vi.mocked(inferLocalProviderFromConversation).mockReturnValue('claude-api');
    vi.mocked(revertApiConversation).mockResolvedValue(revertedSteps as never);

    const res = await POST(makeRequest({ stepIndex: 1, model: 'claude-sonnet' }), params('conversation-1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      data: {
        cascadeId: 'conversation-1',
        stepIndex: 1,
        model: 'claude-sonnet',
        stepCount: 2,
      },
    });
    expect(vi.mocked(revertLocalProviderConversationSteps)).toHaveBeenCalledWith('conversation-1', 1);
    expect(vi.mocked(revertApiConversation)).toHaveBeenCalledWith('claude-api-session-1', 1);
    expect(vi.mocked(writeLocalProviderConversationSteps)).toHaveBeenCalledWith('conversation-1', revertedSteps);
    expect(vi.mocked(updateLocalConversation)).toHaveBeenCalledWith('conversation-1', {
      stepCount: 2,
      providerSessions: expect.objectContaining({
        'native-codex': expect.objectContaining({ sessionHandle: 'native-codex-session-1' }),
        'claude-api': expect.objectContaining({
          sessionHandle: 'claude-api-session-1',
          stepCount: 2,
        }),
      }),
    });
  });

  it('routes Antigravity revert through the provider runtime handle', async () => {
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

    const res = await POST(makeRequest({ stepIndex: 1, model: 'gemini' }), params('conversation-1'));

    expect(res.status).toBe(200);
    expect(vi.mocked(getOwnerConnection)).toHaveBeenCalledWith('ag-cascade-1');
    expect(vi.mocked(grpc.revertToStep)).toHaveBeenCalledWith(9211, 'csrf-token', 'ag-key', 'ag-cascade-1', 1, 'gemini');
  });

  it('proxies reverts to the runtime server in split web mode', async () => {
    vi.mocked(shouldProxyRuntimeRequest).mockReturnValue(true);

    const req = makeRequest({ stepIndex: 1, model: 'gemini' });
    const res = await POST(req, params('conversation-1'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ proxied: true });
    expect(vi.mocked(proxyToRuntime)).toHaveBeenCalledWith(req);
    expect(vi.mocked(getOwnerConnection)).not.toHaveBeenCalled();
    expect(vi.mocked(grpc.revertToStep)).not.toHaveBeenCalled();
  });
});
