import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/bridge/gateway', () => ({
  tryAllServers: vi.fn(),
  grpc: {
    getModelConfigs: vi.fn(),
  },
}));

vi.mock('@/lib/provider-model-catalog', () => ({
  buildProviderAwareModelResponse: vi.fn(() => ({
    clientModelConfigs: [
      { label: 'Native Codex · GPT-5.4', modelOrAlias: { model: 'gpt-5.4' } },
    ],
  })),
  mergeModelResponses: vi.fn((primary, fallback) => ({
    clientModelConfigs: [...(primary.clientModelConfigs || []), ...(fallback.clientModelConfigs || [])],
  })),
}));

import { tryAllServers } from '@/lib/bridge/gateway';
import { GET } from './route';

describe('GET /api/models', () => {
  beforeEach(() => {
    vi.mocked(tryAllServers).mockReset();
  });

  it('falls back to provider-aware models when no Antigravity model service is available', async () => {
    vi.mocked(tryAllServers).mockRejectedValue(new Error('No language_server found'));

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      clientModelConfigs: [
        { label: 'Native Codex · GPT-5.4', modelOrAlias: { model: 'gpt-5.4' } },
      ],
    });
  });
});
