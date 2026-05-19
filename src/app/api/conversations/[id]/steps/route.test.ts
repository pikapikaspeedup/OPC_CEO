import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/bridge/gateway', () => ({
  getAllConnections: vi.fn(async () => []),
  grpc: {
    loadTrajectory: vi.fn(async () => ({})),
    getTrajectorySteps: vi.fn(async () => ({ steps: [] })),
  },
  resolveConversationRecord: vi.fn(),
}));

vi.mock('@/lib/storage/gateway-db', () => ({
  findRunRecordByConversationRef: vi.fn(() => null),
}));

vi.mock('@/lib/local-provider-conversations', () => ({
  inferLocalProviderFromConversation: vi.fn(() => 'native-codex'),
  readLocalProviderConversationSteps: vi.fn(() => [
    {
      type: 'CORTEX_STEP_TYPE_USER_INPUT',
      status: 'CORTEX_STEP_STATUS_DONE',
      userInput: { items: [{ text: 'hello' }] },
    },
    {
      type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
      status: 'CORTEX_STEP_STATUS_DONE',
      plannerResponse: { response: 'world' },
    },
  ]),
}));

vi.mock('@/lib/api-provider-conversations', () => ({
  isApiConversationProvider: vi.fn((provider: string | null | undefined) => provider === 'claude-api' || provider === 'native-codex'),
  readApiConversationSteps: vi.fn(async () => []),
}));

vi.mock('@/lib/run-conversation-transcript', () => ({
  buildStepsFromTranscriptMessages: vi.fn(() => [
    { type: 'CORTEX_STEP_TYPE_USER_INPUT' },
    { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' },
  ]),
  readLocalProviderTranscriptMessages: vi.fn(() => null),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getAllConnections, grpc, resolveConversationRecord } from '@/lib/bridge/gateway';
import { findRunRecordByConversationRef } from '@/lib/storage/gateway-db';
import {
  inferLocalProviderFromConversation,
  readLocalProviderConversationSteps,
} from '@/lib/local-provider-conversations';
import {
  isApiConversationProvider,
  readApiConversationSteps,
} from '@/lib/api-provider-conversations';
import {
  buildStepsFromTranscriptMessages,
  readLocalProviderTranscriptMessages,
} from '@/lib/run-conversation-transcript';
import { GET } from './route';

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/conversations/[id]/steps', () => {
  beforeEach(() => {
    vi.mocked(resolveConversationRecord).mockReset();
    vi.mocked(getAllConnections).mockReset();
    vi.mocked(getAllConnections).mockResolvedValue([]);
    vi.mocked(grpc.loadTrajectory).mockClear();
    vi.mocked(grpc.getTrajectorySteps).mockClear();
    vi.mocked(findRunRecordByConversationRef).mockReset();
    vi.mocked(inferLocalProviderFromConversation).mockReset();
    vi.mocked(readLocalProviderConversationSteps).mockReset();
    vi.mocked(readLocalProviderConversationSteps).mockReturnValue([
      {
        type: 'CORTEX_STEP_TYPE_USER_INPUT',
        status: 'CORTEX_STEP_STATUS_DONE',
        userInput: { items: [{ text: 'hello' }] },
      },
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        status: 'CORTEX_STEP_STATUS_DONE',
        plannerResponse: { response: 'world' },
      },
    ] as never);
    vi.mocked(isApiConversationProvider).mockClear();
    vi.mocked(readApiConversationSteps).mockReset();
    vi.mocked(readApiConversationSteps).mockResolvedValue([]);
    vi.mocked(buildStepsFromTranscriptMessages).mockClear();
    vi.mocked(readLocalProviderTranscriptMessages).mockReset();
  });

  it('returns canonical transcript steps before provider session steps', async () => {
    vi.mocked(resolveConversationRecord).mockReturnValue({
      id: 'local-native-codex-1',
      provider: 'native-codex',
      sessionHandle: 'native-codex-session-1',
    } as never);
    vi.mocked(inferLocalProviderFromConversation).mockReturnValue('native-codex');
    vi.mocked(readApiConversationSteps).mockResolvedValue([
      { type: 'CORTEX_STEP_TYPE_USER_INPUT' },
      { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' },
    ] as never);

    const res = await GET(new Request('http://localhost/api/conversations/local-native-codex-1/steps'), params('local-native-codex-1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cascadeId: 'local-native-codex-1',
      steps: expect.arrayContaining([
        expect.objectContaining({ type: 'CORTEX_STEP_TYPE_USER_INPUT' }),
        expect.objectContaining({ type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' }),
      ]),
    });
    expect(vi.mocked(readLocalProviderConversationSteps)).toHaveBeenCalledWith('local-native-codex-1');
    expect(vi.mocked(readApiConversationSteps)).not.toHaveBeenCalled();
  });

  it('falls back to transcript reconstruction for legacy native-codex handles with no API transcript', async () => {
    vi.mocked(resolveConversationRecord).mockReturnValue(null as never);
    vi.mocked(inferLocalProviderFromConversation).mockReturnValue('native-codex');
    vi.mocked(readApiConversationSteps).mockResolvedValue([]);
    vi.mocked(readLocalProviderConversationSteps).mockReturnValue([]);
    vi.mocked(findRunRecordByConversationRef).mockReturnValue({
      runId: 'run-1',
      prompt: 'legacy prompt',
      sessionProvenance: { handle: 'native-codex-session-1' },
    } as never);
    vi.mocked(readLocalProviderTranscriptMessages).mockReturnValue([
      { role: 'user', content: 'legacy prompt' },
      { role: 'assistant', content: 'legacy answer' },
    ]);

    const res = await GET(new Request('http://localhost/api/conversations/native-codex-session-1/steps'), params('native-codex-session-1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cascadeId: 'native-codex-session-1',
      steps: expect.arrayContaining([
        expect.objectContaining({ type: 'CORTEX_STEP_TYPE_USER_INPUT' }),
        expect.objectContaining({ type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' }),
      ]),
    });
    expect(vi.mocked(readLocalProviderTranscriptMessages)).toHaveBeenCalledWith(
      'native-codex',
      'native-codex-session-1',
      expect.objectContaining({ runId: 'run-1' }),
    );
  });

  it('returns API-backed transcript steps when the conversation record has an API session handle', async () => {
    vi.mocked(resolveConversationRecord).mockReturnValue({
      id: 'local-claude-api-1',
      provider: 'claude-api',
      sessionHandle: 'claude-api-session-1',
    } as never);
    vi.mocked(inferLocalProviderFromConversation).mockReturnValue('claude-api');
    vi.mocked(readLocalProviderConversationSteps).mockReturnValue([]);
    vi.mocked(readApiConversationSteps).mockResolvedValue([
      { type: 'CORTEX_STEP_TYPE_USER_INPUT' },
      { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' },
    ] as never);

    const res = await GET(new Request('http://localhost/api/conversations/local-claude-api-1/steps'), params('local-claude-api-1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cascadeId: 'local-claude-api-1',
      steps: expect.arrayContaining([
        expect.objectContaining({ type: 'CORTEX_STEP_TYPE_USER_INPUT' }),
        expect.objectContaining({ type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' }),
      ]),
    });
    expect(vi.mocked(readApiConversationSteps)).toHaveBeenCalledWith('claude-api-session-1');
  });

  it('reads API-backed steps from the provider session map for provider-neutral conversations', async () => {
    vi.mocked(resolveConversationRecord).mockReturnValue({
      id: 'conversation-1',
      provider: 'claude-api',
      sessionHandle: 'native-codex-session-1',
      providerSessions: {
        'claude-api': {
          provider: 'claude-api',
          sessionHandle: 'claude-api-session-1',
          updatedAt: '2026-05-18T00:00:00.000Z',
          stepCount: 2,
        },
      },
    } as never);
    vi.mocked(inferLocalProviderFromConversation).mockReturnValue('claude-api');
    vi.mocked(readLocalProviderConversationSteps).mockReturnValue([]);
    vi.mocked(readApiConversationSteps).mockResolvedValue([
      { type: 'CORTEX_STEP_TYPE_USER_INPUT' },
      { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' },
    ] as never);

    const res = await GET(new Request('http://localhost/api/conversations/conversation-1/steps'), params('conversation-1'));

    expect(res.status).toBe(200);
    expect(vi.mocked(readLocalProviderConversationSteps)).toHaveBeenCalledWith('conversation-1');
    expect(vi.mocked(readApiConversationSteps)).toHaveBeenCalledWith('claude-api-session-1');
  });

  it('reads Antigravity steps through the provider runtime handle', async () => {
    vi.mocked(resolveConversationRecord).mockReturnValue({
      id: 'conversation-1',
      provider: 'antigravity',
      sessionHandle: 'ag-cascade-old',
      providerSessions: {
        antigravity: {
          provider: 'antigravity',
          sessionHandle: 'ag-cascade-1',
          updatedAt: '2026-05-18T00:00:00.000Z',
          stepCount: 2,
        },
      },
    } as never);
    vi.mocked(inferLocalProviderFromConversation).mockReturnValue(null);
    vi.mocked(getAllConnections).mockResolvedValue([
      {
        port: 9211,
        csrf: 'csrf-token',
        apiKey: 'ag-key',
        workspace: 'file:///tmp/workspace',
      },
    ] as never);
    vi.mocked(grpc.getTrajectorySteps).mockResolvedValue({
      steps: [{ type: 'CORTEX_STEP_TYPE_USER_INPUT' }],
    } as never);

    const res = await GET(new Request('http://localhost/api/conversations/conversation-1/steps'), params('conversation-1'));

    expect(res.status).toBe(200);
    expect(vi.mocked(grpc.loadTrajectory)).toHaveBeenCalledWith(9211, 'csrf-token', 'ag-cascade-1');
    expect(vi.mocked(grpc.getTrajectorySteps)).toHaveBeenCalledWith(9211, 'csrf-token', 'ag-key', 'ag-cascade-1');
  });
});
