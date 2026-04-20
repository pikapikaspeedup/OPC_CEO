import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/organization', () => ({
  getCEOProfile: vi.fn(() => ({
    id: 'default-ceo',
    identity: { name: 'AI CEO', role: 'ceo', tone: 'pragmatic' },
    priorities: [],
    activeFocus: [],
    communicationStyle: { verbosity: 'normal', escalationStyle: 'balanced' },
    riskTolerance: 'medium',
    reviewPreference: 'balanced',
    recentDecisions: [],
    feedbackSignals: [],
    updatedAt: '2026-04-19T00:00:00.000Z',
  })),
  updateCEOProfile: vi.fn((patch: Record<string, unknown>) => ({
    id: 'default-ceo',
    identity: { name: 'AI CEO', role: 'ceo', tone: 'pragmatic' },
    priorities: patch.priorities || [],
    activeFocus: patch.activeFocus || [],
    communicationStyle: { verbosity: 'normal', escalationStyle: 'balanced' },
    riskTolerance: 'medium',
    reviewPreference: 'balanced',
    recentDecisions: [],
    feedbackSignals: [],
    updatedAt: '2026-04-19T00:00:00.000Z',
  })),
}));

import { GET, PATCH } from './route';

describe('/api/ceo/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the current CEO profile', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({
      id: 'default-ceo',
      identity: expect.objectContaining({ role: 'ceo' }),
    }));
  });

  it('updates the CEO profile', async () => {
    const res = await PATCH(new Request('http://localhost/api/ceo/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priorities: ['knowledge loop'], activeFocus: ['prompt retrieval'] }),
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({
      priorities: ['knowledge loop'],
      activeFocus: ['prompt retrieval'],
    }));
  });
});
