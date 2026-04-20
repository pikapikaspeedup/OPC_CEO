import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/bridge/gateway', () => ({
  getUserInfo: vi.fn(() => ({ name: 'Test User', email: 'test@example.com', apiKey: 'secret' })),
  getDefaultConnection: vi.fn(async () => null),
  grpc: {
    getModelConfigs: vi.fn(),
  },
}));

vi.mock('@/lib/providers/ai-config', () => ({
  loadAIConfig: vi.fn(() => ({ defaultProvider: 'native-codex' })),
}));

vi.mock('@/lib/provider-usage-analytics', () => ({
  aggregateProviderUsage: vi.fn(() => ({
    entries: [],
    summary: {
      totalRuns: 5,
      providers: 2,
      tokenRuns: 3,
      totalTokens: 1200,
      windowDays: 30,
    },
  })),
  buildProviderCreditSummaries: vi.fn(() => [
    {
      provider: 'native-codex',
      category: 'oauth',
      configured: true,
      usageTracked: true,
      note: 'Uses OAuth / ChatGPT subscription.',
    },
  ]),
}));

import { GET } from './route';

describe('GET /api/me', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns provider-aware credit summaries and aggregated usage metadata', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({
      name: 'Test User',
      email: 'test@example.com',
      hasApiKey: true,
      credits: null,
      creditSource: null,
      providerAwareNotice: 'credits currently reflect Antigravity IDE runtime only',
      providerUsageSummary: {
        totalRuns: 5,
        providers: 2,
        tokenRuns: 3,
        totalTokens: 1200,
        windowDays: 30,
      },
      providerCredits: [
        expect.objectContaining({
          provider: 'native-codex',
          category: 'oauth',
          configured: true,
        }),
      ],
    }));
  });
});
