import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/bridge/gateway', () => ({
  getOwnerConnection: vi.fn(),
  grpc: {
    proceedArtifact: vi.fn(async () => ({ status: 'continued' })),
  },
  resolveConversationRecord: vi.fn(),
}));

vi.mock('@/lib/local-provider-conversations', () => ({
  inferLocalProviderFromConversation: vi.fn(),
}));

vi.mock('@/server/shared/proxy', () => ({
  proxyToRuntime: vi.fn(async () => Response.json({ proxied: true })),
  runControlPlaneRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
  runControlPlaneThenRuntimeRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
  runRuntimeRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
  shouldProxyRuntimeRequest: vi.fn(() => false),
}));

import { getOwnerConnection, grpc, resolveConversationRecord } from '@/lib/bridge/gateway';
import { inferLocalProviderFromConversation } from '@/lib/local-provider-conversations';
import { proxyToRuntime, shouldProxyRuntimeRequest } from '@/server/shared/proxy';
import { POST } from './route';

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/conversations/conversation-1/proceed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/conversations/[id]/proceed', () => {
  beforeEach(() => {
    vi.mocked(resolveConversationRecord).mockReset();
    vi.mocked(getOwnerConnection).mockReset();
    vi.mocked(inferLocalProviderFromConversation).mockReset();
    vi.mocked(proxyToRuntime).mockClear();
    vi.mocked(shouldProxyRuntimeRequest).mockReset();
    vi.mocked(shouldProxyRuntimeRequest).mockReturnValue(false);
    vi.mocked(grpc.proceedArtifact).mockClear();
  });

  it('does not call Antigravity artifact continuation for local provider conversations', async () => {
    vi.mocked(resolveConversationRecord).mockReturnValue({
      id: 'conversation-1',
      title: 'Provider-neutral thread',
      workspace: 'file:///tmp/workspace',
      stepCount: 2,
      provider: 'native-codex',
      sessionHandle: 'native-codex-session-1',
      providerSessions: {
        antigravity: {
          provider: 'antigravity',
          sessionHandle: 'ag-cascade-1',
          updatedAt: '2026-05-18T00:00:00.000Z',
          stepCount: 3,
        },
        'native-codex': {
          provider: 'native-codex',
          sessionHandle: 'native-codex-session-1',
          updatedAt: '2026-05-18T00:01:00.000Z',
          stepCount: 2,
        },
      },
    } as never);
    vi.mocked(inferLocalProviderFromConversation).mockReturnValue('native-codex');

    const res = await POST(makeRequest({ artifactUri: 'artifact://1', model: 'gpt-5.4' }), params('conversation-1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      data: {
        status: 'not_applicable',
        provider: 'native-codex',
        artifactUri: 'artifact://1',
        model: 'gpt-5.4',
      },
    });
    expect(vi.mocked(getOwnerConnection)).not.toHaveBeenCalled();
    expect(vi.mocked(grpc.proceedArtifact)).not.toHaveBeenCalled();
  });

  it('routes Antigravity artifact continuation through the provider runtime handle', async () => {
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
    } as never);

    const res = await POST(makeRequest({ artifactUri: 'artifact://1', model: 'gemini' }), params('conversation-1'));

    expect(res.status).toBe(200);
    expect(vi.mocked(getOwnerConnection)).toHaveBeenCalledWith('ag-cascade-1');
    expect(vi.mocked(grpc.proceedArtifact)).toHaveBeenCalledWith(
      9211,
      'csrf-token',
      'ag-key',
      'ag-cascade-1',
      'artifact://1',
      'gemini',
    );
  });

  it('proxies artifact continuation to the runtime server in split web mode', async () => {
    vi.mocked(shouldProxyRuntimeRequest).mockReturnValue(true);

    const req = makeRequest({ artifactUri: 'artifact://1', model: 'gemini' });
    const res = await POST(req, params('conversation-1'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ proxied: true });
    expect(vi.mocked(proxyToRuntime)).toHaveBeenCalledWith(req);
    expect(vi.mocked(getOwnerConnection)).not.toHaveBeenCalled();
    expect(vi.mocked(grpc.proceedArtifact)).not.toHaveBeenCalled();
  });
});
