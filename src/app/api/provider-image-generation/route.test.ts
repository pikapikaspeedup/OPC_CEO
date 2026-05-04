import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/control-plane/routes/settings', () => ({
  handleProviderImageGenerationPost: vi.fn(async () => Response.json({ provider: 'openai-api', dataUrl: 'data:image/png;base64,abc' })),
}));

vi.mock('@/server/shared/proxy', () => ({
  shouldProxyControlPlaneRequest: vi.fn(() => false),
  proxyToControlPlane: vi.fn(),
}));

import { handleProviderImageGenerationPost } from '@/server/control-plane/routes/settings';
import { POST } from './route';

describe('provider-image-generation route', () => {
  beforeEach(() => {
    vi.mocked(handleProviderImageGenerationPost).mockClear();
  });

  it('delegates POST locally when control-plane proxy is disabled', async () => {
    const res = await POST(new Request('http://localhost/api/provider-image-generation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai-api', prompt: 'test' }),
    }));

    expect(res.status).toBe(200);
    expect(vi.mocked(handleProviderImageGenerationPost)).toHaveBeenCalledTimes(1);
  });
});
