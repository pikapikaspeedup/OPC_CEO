import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

vi.mock('@/lib/bridge/gateway', () => ({
  getOwnerConnection: vi.fn(),
  resolveConversationRecord: vi.fn(),
}));

vi.mock('@/lib/local-provider-conversations', () => ({
  inferLocalProviderFromConversation: vi.fn(),
}));

vi.mock('@/lib/storage/gateway-db', () => ({
  findRunRecordByConversationRef: vi.fn(() => null),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    warn: vi.fn(),
  }),
}));

vi.mock('@/server/shared/proxy', () => ({
  proxyToRuntime: vi.fn(async () => Response.json({ proxied: true })),
  runControlPlaneRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
  runControlPlaneThenRuntimeRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
  runRuntimeRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
  shouldProxyRuntimeRequest: vi.fn(() => false),
}));

import { getOwnerConnection, resolveConversationRecord } from '@/lib/bridge/gateway';
import { inferLocalProviderFromConversation } from '@/lib/local-provider-conversations';
import { findRunRecordByConversationRef } from '@/lib/storage/gateway-db';
import { proxyToRuntime, shouldProxyRuntimeRequest } from '@/server/shared/proxy';
import { GET } from './route';

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/conversations/[id]/files', () => {
  beforeEach(() => {
    vi.mocked(resolveConversationRecord).mockReset();
    vi.mocked(getOwnerConnection).mockReset();
    vi.mocked(inferLocalProviderFromConversation).mockReset();
    vi.mocked(findRunRecordByConversationRef).mockReset();
    vi.mocked(findRunRecordByConversationRef).mockReturnValue(null as never);
    vi.mocked(proxyToRuntime).mockClear();
    vi.mocked(shouldProxyRuntimeRequest).mockReset();
    vi.mocked(shouldProxyRuntimeRequest).mockReturnValue(false);
    execFileMock.mockReset();
    execFileMock.mockImplementation((_: unknown, __: unknown, callback: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      callback(null, {
        stdout: '/tmp/workspace/src/index.ts\n/tmp/workspace/docs/index.md\n',
        stderr: '',
      });
    });
  });

  it('searches provider-neutral Antigravity conversations by the provider runtime handle and workspace record', async () => {
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
      workspace: 'file:///tmp/connection-workspace',
    } as never);

    const res = await GET(new Request('http://localhost/api/conversations/conversation-1/files?q=index.ts;rm'), params('conversation-1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: [
        {
          absolutePath: '/tmp/workspace/src/index.ts',
          relativePath: 'src/index.ts',
          name: 'index.ts',
        },
        {
          absolutePath: '/tmp/workspace/docs/index.md',
          relativePath: 'docs/index.md',
          name: 'index.md',
        },
      ],
    });
    expect(vi.mocked(getOwnerConnection)).toHaveBeenCalledWith('ag-cascade-1');
    expect(vi.mocked(findRunRecordByConversationRef)).toHaveBeenCalledWith({
      sessionHandles: ['conversation-1', 'ag-cascade-1', 'ag-cascade-old'],
      conversationIds: ['conversation-1', 'conversation-1'],
    });
    expect(execFileMock).toHaveBeenCalledWith(
      'find',
      expect.arrayContaining(['/tmp/workspace', '-iname', '*index.tsrm*']),
      expect.any(Function),
    );
  });

  it('searches local provider conversations without resolving an Antigravity owner', async () => {
    vi.mocked(resolveConversationRecord).mockReturnValue({
      id: 'conversation-1',
      title: 'Native Codex thread',
      workspace: 'file:///tmp/workspace',
      stepCount: 2,
      provider: 'native-codex',
      sessionHandle: 'native-codex-session-1',
    } as never);
    vi.mocked(inferLocalProviderFromConversation).mockReturnValue('native-codex');

    const res = await GET(new Request('http://localhost/api/conversations/conversation-1/files?q=index'), params('conversation-1'));

    expect(res.status).toBe(200);
    expect(vi.mocked(getOwnerConnection)).not.toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledWith(
      'find',
      expect.arrayContaining(['/tmp/workspace', '-iname', '*index*']),
      expect.any(Function),
    );
  });

  it('proxies file search to the runtime server in split web mode', async () => {
    vi.mocked(shouldProxyRuntimeRequest).mockReturnValue(true);

    const req = new Request('http://localhost/api/conversations/conversation-1/files?q=index');
    const res = await GET(req, params('conversation-1'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ proxied: true });
    expect(vi.mocked(proxyToRuntime)).toHaveBeenCalledWith(req);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
