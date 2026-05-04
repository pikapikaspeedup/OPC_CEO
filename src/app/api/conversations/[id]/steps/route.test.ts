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

import { resolveConversationRecord } from '@/lib/bridge/gateway';
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
    vi.mocked(findRunRecordByConversationRef).mockReset();
    vi.mocked(inferLocalProviderFromConversation).mockReset();
    vi.mocked(readLocalProviderConversationSteps).mockClear();
    vi.mocked(isApiConversationProvider).mockClear();
    vi.mocked(readApiConversationSteps).mockClear();
    vi.mocked(buildStepsFromTranscriptMessages).mockClear();
    vi.mocked(readLocalProviderTranscriptMessages).mockReset();
  });

  it('returns API transcript steps for native-codex conversations when a session handle exists', async () => {
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
    expect(vi.mocked(readApiConversationSteps)).toHaveBeenCalledWith('native-codex-session-1');
    expect(vi.mocked(readLocalProviderConversationSteps)).not.toHaveBeenCalled();
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
});
