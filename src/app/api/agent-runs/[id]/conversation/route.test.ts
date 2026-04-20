import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage/gateway-db', () => ({
  getRunRecord: vi.fn(),
}));

vi.mock('@/lib/bridge/gateway', () => ({
  ensureConversationRecordForSession: vi.fn((input: { title: string }) => ({
    id: 'conversation-1',
    title: input.title,
  })),
}));

vi.mock('@/lib/local-provider-conversations', () => ({
  isSupportedLocalProvider: vi.fn((provider: string) => provider === 'native-codex' || provider === 'codex'),
}));

vi.mock('@/lib/run-conversation-transcript', () => ({
  readLocalProviderTranscriptMessages: vi.fn(() => null),
  readTranscriptFromRunHistory: vi.fn(() => null),
}));

import { getRunRecord } from '@/lib/storage/gateway-db';
import { ensureConversationRecordForSession } from '@/lib/bridge/gateway';
import { readLocalProviderTranscriptMessages } from '@/lib/run-conversation-transcript';
import { GET } from './route';

describe('GET /api/agent-runs/[id]/conversation', () => {
  beforeEach(() => {
    vi.mocked(getRunRecord).mockReset();
    vi.mocked(ensureConversationRecordForSession).mockClear();
    vi.mocked(readLocalProviderTranscriptMessages).mockReset();
  });

  it('returns a readable transcript plus viewer conversation id for local provider runs', async () => {
    vi.mocked(getRunRecord).mockReturnValue({
      runId: 'run-1',
      prompt: '用户原始 prompt',
      provider: 'native-codex',
      sessionProvenance: { handle: 'native-codex-run-1' },
      workspace: 'file:///tmp/ws',
      status: 'completed',
      stageId: 'prompt-mode',
      createdAt: '2026-04-18T00:00:00.000Z',
    } as any);
    vi.mocked(readLocalProviderTranscriptMessages).mockReturnValue([
      { role: 'user', content: '用户原始 prompt' },
      { role: 'assistant', content: 'AI 回复内容' },
    ]);

    const response = await GET(new Request('http://localhost/api/agent-runs/run-1/conversation'), {
      params: Promise.resolve({ id: 'run-1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      kind: 'transcript',
      provider: 'native-codex',
      handle: 'native-codex-run-1',
      messages: [
        { role: 'user', content: '用户原始 prompt' },
        { role: 'assistant', content: 'AI 回复内容' },
      ],
      viewerConversationId: 'conversation-1',
      viewerTitle: '用户原始 prompt',
    });
  });
});
