import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./providers/provider-inventory', () => ({
  readStoredApiKeys: vi.fn(),
}));

vi.mock('./bridge/native-codex-adapter', () => ({
  nativeCodexGenerateImage: vi.fn(),
}));

vi.mock('./providers/ai-config', () => ({
  loadAIConfig: vi.fn(),
  resolveProviderProfile: vi.fn(),
}));

import { nativeCodexGenerateImage } from './bridge/native-codex-adapter';
import { loadAIConfig, resolveProviderProfile } from './providers/ai-config';
import { readStoredApiKeys } from './providers/provider-inventory';
import { generateProviderImage, listImageCapableProviders } from './provider-image-generation';

describe('provider-image-generation', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readStoredApiKeys).mockReturnValue({ openai: 'openai-key' });
    vi.mocked(loadAIConfig).mockReturnValue({
      defaultProvider: 'native-codex',
      providerProfiles: {
        'native-codex': { supportsImageGeneration: true, enableImageGeneration: true, imageGenerationModel: 'gpt-5.5' },
        'openai-api': { supportsImageGeneration: true, enableImageGeneration: true, imageGenerationModel: 'gpt-image-1' },
        custom: { supportsImageGeneration: true, enableImageGeneration: true, imageGenerationModel: 'custom-image' },
      },
      customProvider: {
        baseUrl: 'https://proxy.example.com',
        apiKey: 'proxy-key',
        defaultModel: 'custom-image',
      },
    });
    vi.mocked(resolveProviderProfile).mockImplementation((provider) => {
      if (provider === 'native-codex') {
        return { supportsImageGeneration: true, enableImageGeneration: true, imageGenerationModel: 'gpt-5.5', transport: 'pi-ai' };
      }
      if (provider === 'openai-api') {
        return { supportsImageGeneration: true, enableImageGeneration: true, imageGenerationModel: 'gpt-image-1', transport: 'pi-ai' };
      }
      if (provider === 'custom') {
        return { supportsImageGeneration: true, enableImageGeneration: true, imageGenerationModel: 'custom-image', transport: 'pi-ai' };
      }
      return {};
    });
    vi.mocked(nativeCodexGenerateImage).mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('generates a data URL for openai-api', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ b64_json: 'ZmFrZS1pbWFnZQ==' }],
    }), { status: 200 })) as typeof fetch;

    const result = await generateProviderImage({
      provider: 'openai-api',
      prompt: 'blue square icon',
    });

    expect(result.provider).toBe('openai-api');
    expect(result.model).toBe('gpt-image-1');
    expect(result.dataUrl).toBe('data:image/png;base64,ZmFrZS1pbWFnZQ==');
  });

  it('generates a data URL for native-codex via Codex subscription auth', async () => {
    vi.mocked(nativeCodexGenerateImage).mockResolvedValue({
      model: 'gpt-5.5',
      size: '1024x1024',
      imageBase64: 'bmF0aXZlLWNvZGV4LWltYWdl',
      mimeType: 'image/png',
    });

    const result = await generateProviderImage({
      provider: 'native-codex',
      prompt: 'orange cat product mascot',
    });

    expect(vi.mocked(nativeCodexGenerateImage)).toHaveBeenCalledWith({
      prompt: 'orange cat product mascot',
      size: '512x512',
      model: 'gpt-5.5',
    });
    expect(result.provider).toBe('native-codex');
    expect(result.model).toBe('gpt-5.5');
    expect(result.size).toBe('1024x1024');
    expect(result.dataUrl).toBe('data:image/png;base64,bmF0aXZlLWNvZGV4LWltYWdl');
  });

  it('falls back to openai-api when custom image generation fails', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream failed', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ b64_json: 'ZmFsbGJhY2staW1hZ2U=' }],
      }), { status: 200 })) as typeof fetch;

    const result = await generateProviderImage({
      provider: 'custom',
      prompt: 'fallback test image',
    });

    expect(result.provider).toBe('openai-api');
    expect(result.fallbackProvider).toBe('openai-api');
    expect(result.dataUrl).toBe('data:image/png;base64,ZmFsbGJhY2staW1hZ2U=');
  });

  it('lists providers by image capability rather than static whitelist', () => {
    const providers = listImageCapableProviders();
    expect(providers).toEqual(expect.arrayContaining(['native-codex', 'openai-api', 'custom']));
  });
});
