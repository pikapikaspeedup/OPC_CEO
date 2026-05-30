import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/bridge/gateway', () => ({
  getOwnerConnection: vi.fn(),
  grpc: {
    getRevertPreview: vi.fn(async () => ({ steps: [{ type: 'CORTEX_STEP_TYPE_USER_INPUT' }] })),
  },
  resolveConversationRecord: vi.fn(),
}));

vi.mock('@/lib/local-provider-conversations', () => ({
  inferLocalProviderFromConversation: vi.fn(),
  previewLocalProviderConversationSteps: vi.fn(() => []),
}));

vi.mock('@/lib/api-provider-conversations', () => ({
  isApiConversationProvider: vi.fn((provider: string | null | undefined) => provider === 'native-codex' || provider === 'claude-api'),
  previewApiConversationSteps: vi.fn(async () => [
    { type: 'CORTEX_STEP_TYPE_USER_INPUT' },
    { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' },
  ]),
}));

vi.mock('@/server/shared/proxy', () => ({
  proxyToRuntime: vi.fn(async () => Response.json({ proxied: true })),
  runControlPlaneRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
  runControlPlaneThenRuntimeRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
  runRuntimeRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
  shouldProxyRuntimeRequest: vi.fn(() => false),
}));

import { getOwnerConnection, grpc, resolveConversationRecord } from '@/lib/bridge/gateway';
import {
  inferLocalProviderFromConversation,
  previewLocalProviderConversationSteps,
} from '@/lib/local-provider-conversations';
import { previewApiConversationSteps } from '@/lib/api-provider-conversations';
import { proxyToRuntime, shouldProxyRuntimeRequest } from '@/server/shared/proxy';
import { GET } from './route';

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/conversations/[id]/revert-preview', () => {
  beforeEach(() => {
    vi.mocked(resolveConversationRecord).mockReset();
    vi.mocked(getOwnerConnection).mockReset();
    vi.mocked(inferLocalProviderFromConversation).mockReset();
    vi.mocked(previewLocalProviderConversationSteps).mockReset();
    vi.mocked(previewLocalProviderConversationSteps).mockReturnValue([]);
    vi.mocked(previewApiConversationSteps).mockReset();
    vi.mocked(previewApiConversationSteps).mockResolvedValue([
      { type: 'CORTEX_STEP_TYPE_USER_INPUT' },
      { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' },
    ] as never);
    vi.mocked(proxyToRuntime).mockClear();
    vi.mocked(shouldProxyRuntimeRequest).mockReset();
    vi.mocked(shouldProxyRuntimeRequest).mockReturnValue(false);
    vi.mocked(grpc.getRevertPreview).mockClear();
  });

  it('previews API provider sessions through providerSessions while preserving the business conversation id', async () => {
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

    const res = await GET(
      new Request('http://localhost/api/conversations/conversation-1/revert-preview?stepIndex=1&model=claude-sonnet'),
      params('conversation-1'),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cascadeId: 'conversation-1',
      stepIndex: 1,
      model: 'claude-sonnet',
      steps: expect.arrayContaining([
        expect.objectContaining({ type: 'CORTEX_STEP_TYPE_USER_INPUT' }),
        expect.objectContaining({ type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' }),
      ]),
    });
    expect(vi.mocked(previewLocalProviderConversationSteps)).toHaveBeenCalledWith('conversation-1', 1);
    expect(vi.mocked(previewApiConversationSteps)).toHaveBeenCalledWith('claude-api-session-1', 1);
    expect(vi.mocked(grpc.getRevertPreview)).not.toHaveBeenCalled();
  });

  it('routes Antigravity revert previews through the provider runtime handle', async () => {
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

    const res = await GET(
      new Request('http://localhost/api/conversations/conversation-1/revert-preview?stepIndex=1&model=gemini'),
      params('conversation-1'),
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(getOwnerConnection)).toHaveBeenCalledWith('ag-cascade-1');
    expect(vi.mocked(grpc.getRevertPreview)).toHaveBeenCalledWith(
      9211,
      'csrf-token',
      'ag-key',
      'ag-cascade-1',
      1,
      'gemini',
    );
  });

  it('proxies revert previews to the runtime server in split web mode', async () => {
    vi.mocked(shouldProxyRuntimeRequest).mockReturnValue(true);

    const req = new Request('http://localhost/api/conversations/conversation-1/revert-preview?stepIndex=1&model=gemini');
    const res = await GET(req, params('conversation-1'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ proxied: true });
    expect(vi.mocked(proxyToRuntime)).toHaveBeenCalledWith(req);
    expect(vi.mocked(getOwnerConnection)).not.toHaveBeenCalled();
    expect(vi.mocked(grpc.getRevertPreview)).not.toHaveBeenCalled();
  });
});
