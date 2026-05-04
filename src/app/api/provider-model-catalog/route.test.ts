import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/control-plane/routes/settings', () => ({
  handleProviderModelCatalogGet: vi.fn(async () => Response.json({ entry: { provider: 'native-codex', models: [] } })),
  handleProviderModelCatalogPost: vi.fn(async () => Response.json({ entry: { provider: 'native-codex', models: [] } })),
}));

vi.mock('@/server/shared/proxy', () => ({
  shouldProxyControlPlaneRequest: vi.fn(() => false),
  proxyToControlPlane: vi.fn(),
}));

import { handleProviderModelCatalogGet, handleProviderModelCatalogPost } from '@/server/control-plane/routes/settings';
import { GET, POST } from './route';

describe('provider-model-catalog route', () => {
  beforeEach(() => {
    vi.mocked(handleProviderModelCatalogGet).mockClear();
    vi.mocked(handleProviderModelCatalogPost).mockClear();
  });

  it('delegates GET locally when control-plane proxy is disabled', async () => {
    const res = await GET(new Request('http://localhost/api/provider-model-catalog?provider=native-codex'));

    expect(res.status).toBe(200);
    expect(vi.mocked(handleProviderModelCatalogGet)).toHaveBeenCalledTimes(1);
  });

  it('delegates POST locally when control-plane proxy is disabled', async () => {
    const res = await POST(new Request('http://localhost/api/provider-model-catalog', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'native-codex', refresh: true }),
    }));

    expect(res.status).toBe(200);
    expect(vi.mocked(handleProviderModelCatalogPost)).toHaveBeenCalledTimes(1);
  });
});
