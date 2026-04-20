import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/bridge/gateway', () => ({
  tryAllServers: vi.fn(),
  grpc: {
    getUserAnalyticsSummary: vi.fn(),
  },
}));

vi.mock('@/lib/provider-usage-analytics', () => ({
  aggregateProviderUsage: vi.fn(() => ({
    entries: [
      {
        provider: 'native-codex',
        runCount: 3,
        completedCount: 2,
        activeCount: 1,
        failedCount: 0,
        blockedCount: 0,
        cancelledCount: 0,
        promptRunCount: 3,
        tokenRuns: 1,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        lastRunAt: '2026-04-19T00:00:00.000Z',
      },
    ],
    summary: {
      totalRuns: 3,
      providers: 1,
      tokenRuns: 1,
      totalTokens: 150,
      windowDays: 30,
    },
  })),
}));

import { tryAllServers } from '@/lib/bridge/gateway';
import { GET } from './route';

describe('GET /api/analytics', () => {
  beforeEach(() => {
    vi.mocked(tryAllServers).mockReset();
  });

  it('returns provider-aware fallback analytics when runtime analytics are unavailable', async () => {
    vi.mocked(tryAllServers).mockRejectedValue(new Error('No language_server found'));

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      providerUsage: [
        expect.objectContaining({
          provider: 'native-codex',
          runCount: 3,
          totalTokens: 150,
        }),
      ],
      providerUsageSummary: {
        totalRuns: 3,
        providers: 1,
        tokenRuns: 1,
        totalTokens: 150,
        windowDays: 30,
      },
      dataSources: {
        antigravityRuntime: false,
        gatewayRuns: true,
      },
      providerAwareNotice: 'Runtime analytics unavailable; showing Gateway run aggregation only.',
    });
  });
});
