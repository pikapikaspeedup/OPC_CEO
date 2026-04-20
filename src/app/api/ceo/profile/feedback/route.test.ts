import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/organization', () => ({
  appendCEOFeedback: vi.fn(() => ({
    id: 'default-ceo',
    identity: { name: 'AI CEO', role: 'ceo' },
    priorities: [],
    activeFocus: [],
    communicationStyle: { verbosity: 'normal', escalationStyle: 'balanced' },
    riskTolerance: 'medium',
    reviewPreference: 'balanced',
    recentDecisions: [],
    feedbackSignals: [
      {
        timestamp: '2026-04-19T00:00:00.000Z',
        type: 'preference',
        content: 'Keep updates concise',
        source: 'user',
      },
    ],
    updatedAt: '2026-04-19T00:00:00.000Z',
  })),
}));

import { POST } from './route';

describe('/api/ceo/profile/feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid feedback payload', async () => {
    const res = await POST(new Request('http://localhost/api/ceo/profile/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it('appends a CEO feedback signal', async () => {
    const res = await POST(new Request('http://localhost/api/ceo/profile/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'preference', content: 'Keep updates concise' }),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({
      feedbackSignals: [
        expect.objectContaining({
          content: 'Keep updates concise',
        }),
      ],
    }));
  });
});
