import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessageMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
}));
const { runApiConversationTurnMock, readApiConversationStepsMock } = vi.hoisted(() => ({
  runApiConversationTurnMock: vi.fn(),
  readApiConversationStepsMock: vi.fn(),
}));
const { findRunRecordByConversationRefMock } = vi.hoisted(() => ({
  findRunRecordByConversationRefMock: vi.fn(() => null),
}));

vi.mock('@/lib/bridge/gateway', () => ({
  getOwnerConnection: vi.fn(),
  refreshOwnerMap: vi.fn(async () => {}),
  convOwnerMap: new Map(),
  ownerMapAge: 0,
  grpc: {
    sendMessage: sendMessageMock,
    loadTrajectory: vi.fn(async () => ({})),
  },
  resolveConversationRecord: vi.fn(),
  updateLocalConversation: vi.fn(),
}));

vi.mock('@/lib/providers', () => ({
  getExecutor: vi.fn(),
}));

vi.mock('@/lib/local-provider-conversations', () => ({
  appendLocalProviderConversationTurn: vi.fn(() => [
    { type: 'CORTEX_STEP_TYPE_USER_INPUT' },
    { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' },
  ]),
  inferLocalProviderFromConversation: vi.fn(() => 'native-codex'),
}));

vi.mock('@/lib/api-provider-conversations', () => ({
  isApiConversationProvider: vi.fn((provider: string | null | undefined) => (
    provider === 'claude-api'
    || provider === 'openai-api'
    || provider === 'gemini-api'
    || provider === 'grok-api'
    || provider === 'custom'
  )),
  runApiConversationTurn: runApiConversationTurnMock,
  readApiConversationSteps: readApiConversationStepsMock,
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
  findRunRecordByConversationRef: findRunRecordByConversationRefMock,
}));

import {
  resolveConversationRecord,
  getOwnerConnection,
  updateLocalConversation,
} from '@/lib/bridge/gateway';
import { getExecutor } from '@/lib/providers';
import {
  appendLocalProviderConversationTurn,
  inferLocalProviderFromConversation,
} from '@/lib/local-provider-conversations';
import {
  readApiConversationSteps,
  runApiConversationTurn,
} from '@/lib/api-provider-conversations';
import { findRunRecordByConversationRef } from '@/lib/storage/gateway-db';
import { POST } from './route';

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/conversations/local-native-codex-1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/conversations/[id]/send', () => {
  beforeEach(() => {
    vi.mocked(resolveConversationRecord).mockReset();
    vi.mocked(getOwnerConnection).mockReset();
    vi.mocked(updateLocalConversation).mockReset();
    vi.mocked(getExecutor).mockReset();
    vi.mocked(appendLocalProviderConversationTurn).mockClear();
    vi.mocked(inferLocalProviderFromConversation).mockReset();
    vi.mocked(runApiConversationTurn).mockReset();
    vi.mocked(readApiConversationSteps).mockReset();
    vi.mocked(findRunRecordByConversationRef).mockReset();
    sendMessageMock.mockReset();
  });

  it('routes local native-codex conversations through the local executor', async () => {
    vi.mocked(resolveConversationRecord).mockReturnValue({
      id: 'local-native-codex-1',
      title: 'CEO Office',
      workspace: 'file:///tmp/native-codex',
      stepCount: 0,
      provider: 'native-codex',
      sessionHandle: '',
    } as never);
    vi.mocked(inferLocalProviderFromConversation).mockReturnValue('native-codex');

    const executeTask = vi.fn(async () => ({
      handle: 'native-codex-session-1',
      content: 'native response',
      steps: [],
      changedFiles: [],
      status: 'completed',
    }));
    vi.mocked(getExecutor).mockReturnValue({
      executeTask,
      appendMessage: vi.fn(),
    } as never);

    const res = await POST(makeRequest({ text: 'hello native codex' }), params('local-native-codex-1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      data: {
        cascadeId: 'local-native-codex-1',
        state: 'idle',
        provider: 'native-codex',
      },
    });
    expect(executeTask).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'hello native codex',
      workspace: '/tmp/native-codex',
    }));
    expect(vi.mocked(appendLocalProviderConversationTurn)).toHaveBeenCalledWith(
      'local-native-codex-1',
      'hello native codex',
      'native response',
    );
    expect(vi.mocked(updateLocalConversation)).toHaveBeenCalledWith('local-native-codex-1', {
      provider: 'native-codex',
      sessionHandle: 'native-codex-session-1',
      stepCount: 2,
    });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('reuses the existing native-codex session when opening via a legacy handle url', async () => {
    vi.mocked(resolveConversationRecord).mockReturnValue(null as never);
    vi.mocked(inferLocalProviderFromConversation).mockReturnValue('native-codex');
    vi.mocked(findRunRecordByConversationRef).mockReturnValue({
      runId: 'run-1',
      workspace: 'file:///tmp/native-codex',
      sessionProvenance: { handle: 'native-codex-session-1' },
    } as never);

    const appendMessage = vi.fn(async () => ({
      handle: 'native-codex-session-1',
      content: 'continued response',
      steps: [],
      changedFiles: [],
      status: 'completed',
    }));
    vi.mocked(getExecutor).mockReturnValue({
      executeTask: vi.fn(),
      appendMessage,
    } as never);

    const res = await POST(makeRequest({ text: 'continue native codex' }), params('native-codex-session-1'));

    expect(res.status).toBe(200);
    expect(appendMessage).toHaveBeenCalledWith('native-codex-session-1', expect.objectContaining({
      prompt: 'continue native codex',
      workspace: '/tmp/native-codex',
    }));
    expect(vi.mocked(appendLocalProviderConversationTurn)).toHaveBeenCalledWith(
      'native-codex-session-1',
      'continue native codex',
      'continued response',
    );
    expect(vi.mocked(updateLocalConversation)).not.toHaveBeenCalled();
  });

  it('returns an HTTP error when a local provider reports failed status', async () => {
    vi.mocked(resolveConversationRecord).mockReturnValue({
      id: 'local-native-codex-1',
      title: 'CEO Office',
      workspace: 'file:///tmp/native-codex',
      stepCount: 0,
      provider: 'native-codex',
      sessionHandle: '',
    } as never);
    vi.mocked(inferLocalProviderFromConversation).mockReturnValue('native-codex');

    vi.mocked(getExecutor).mockReturnValue({
      executeTask: vi.fn(async () => ({
        handle: 'native-codex-session-1',
        content: 'Native Codex request timed out after 90000ms',
        steps: [],
        changedFiles: [],
        status: 'failed',
      })),
      appendMessage: vi.fn(),
    } as never);

    const res = await POST(makeRequest({ text: 'hello native codex' }), params('local-native-codex-1'));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: 'Native Codex request timed out after 90000ms',
    });
    expect(vi.mocked(appendLocalProviderConversationTurn)).not.toHaveBeenCalled();
    expect(vi.mocked(updateLocalConversation)).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('routes local API-backed conversations through the API conversation helper', async () => {
    vi.mocked(resolveConversationRecord).mockReturnValue({
      id: 'local-claude-api-1',
      title: 'Claude API Shell',
      workspace: 'file:///tmp/claude-api',
      stepCount: 0,
      provider: 'claude-api',
      sessionHandle: '',
    } as never);
    vi.mocked(inferLocalProviderFromConversation).mockReturnValue('claude-api');
    vi.mocked(runApiConversationTurn).mockResolvedValue({
      handle: 'claude-api-session-1',
      content: 'api response',
    });
    vi.mocked(readApiConversationSteps).mockResolvedValue([
      { type: 'CORTEX_STEP_TYPE_USER_INPUT' },
      { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' },
    ] as never);

    const res = await POST(makeRequest({ text: 'hello api provider' }), params('local-claude-api-1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      data: {
        cascadeId: 'local-claude-api-1',
        state: 'idle',
        provider: 'claude-api',
      },
    });
    expect(vi.mocked(runApiConversationTurn)).toHaveBeenCalledWith(
      'claude-api',
      '/tmp/claude-api',
      'hello api provider',
      undefined,
      undefined,
      'local-claude-api-1',
    );
    expect(vi.mocked(updateLocalConversation)).toHaveBeenCalledWith('local-claude-api-1', {
      provider: 'claude-api',
      sessionHandle: 'claude-api-session-1',
      stepCount: 2,
    });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('keeps Antigravity conversations on the original gRPC send path', async () => {
    vi.mocked(resolveConversationRecord).mockReturnValue(null as never);
    vi.mocked(inferLocalProviderFromConversation).mockReturnValue(null);
    vi.mocked(getOwnerConnection).mockResolvedValue({
      port: 9211,
      csrf: 'csrf-token',
      apiKey: 'ag-key',
      workspace: 'file:///tmp/antigravity',
      stepCount: 0,
    } as never);
    sendMessageMock.mockResolvedValue({ state: 'running' });

    const res = await POST(makeRequest({ text: 'hello antigravity' }), params('cascade-1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      data: { state: 'running' },
    });
    expect(sendMessageMock).toHaveBeenCalled();
    expect(vi.mocked(updateLocalConversation)).not.toHaveBeenCalled();
  });
});
