import { createLogger } from './logger';
import { nativeCodexGenerateImage } from './bridge/native-codex-adapter';
import { loadAIConfig, resolveProviderProfile } from './providers/ai-config';
import { buildOpenAICompatibleImagesUrl } from './providers/openai-compatible';
import { readStoredApiKeys } from './providers/provider-inventory';
import { AI_PROVIDER_IDS, type AIProviderConfig, type AIProviderId } from './providers/types';

const log = createLogger('ProviderImageGeneration');

export type ProviderImageGenerationRequest = {
  provider: AIProviderId;
  prompt: string;
  size?: '256x256' | '512x512' | '1024x1024';
  allowFallback?: boolean;
};

export type ProviderImageGenerationResponse = {
  provider: AIProviderId;
  model: string;
  prompt: string;
  size: string;
  dataUrl: string;
  fallbackProvider?: AIProviderId;
};

type ResolvedImageProvider = {
  kind: 'openai-compatible' | 'native-codex';
  provider: AIProviderId;
  model: string;
} & ({
  kind: 'openai-compatible';
  apiKey: string;
  baseUrl: string;
} | {
  kind: 'native-codex';
});

function providerSupportsImageGeneration(
  provider: AIProviderId,
  config: AIProviderConfig,
): boolean {
  const profile = resolveProviderProfile(provider, config);
  return profile.supportsImageGeneration === true;
}

function resolveProviderImageConfig(
  provider: AIProviderId,
  config: AIProviderConfig = loadAIConfig(),
): ResolvedImageProvider | null {
  const profile = resolveProviderProfile(provider, config);
  if (profile.supportsImageGeneration !== true || profile.enableImageGeneration !== true) {
    return null;
  }

  const keys = readStoredApiKeys();

  if (provider === 'openai-api') {
    const apiKey = keys.openai || process.env.OPENAI_API_KEY || '';
    if (!apiKey) {
      return null;
    }
    return {
      kind: 'openai-compatible',
      provider,
      model: profile.imageGenerationModel || 'gpt-image-1',
      apiKey,
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
    };
  }

  if (provider === 'native-codex') {
    return {
      kind: 'native-codex',
      provider,
      model: profile.imageGenerationModel || 'gpt-5.5',
    };
  }

  if (provider === 'custom') {
    const custom = config.customProvider;
    if (!custom?.apiKey || !custom.baseUrl) {
      return null;
    }
    return {
      kind: 'openai-compatible',
      provider,
      model: profile.imageGenerationModel || custom.defaultModel || 'gpt-image-1',
      apiKey: custom.apiKey,
      baseUrl: custom.baseUrl,
    };
  }

  return null;
}

async function dataUrlFromResponsePayload(
  payload: { data?: Array<{ b64_json?: string; url?: string }> },
): Promise<string> {
  const first = payload.data?.[0];
  if (!first) {
    throw new Error('Image provider returned no image data');
  }

  if (first.b64_json) {
    return `data:image/png;base64,${first.b64_json}`;
  }

  if (first.url) {
    const response = await fetch(first.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch generated image URL: HTTP ${response.status}`);
    }
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  throw new Error('Image provider returned unsupported image payload');
}

async function generateWithProvider(
  provider: ResolvedImageProvider,
  prompt: string,
  size: string,
): Promise<ProviderImageGenerationResponse> {
  if (provider.kind === 'native-codex') {
    const result = await nativeCodexGenerateImage({
      prompt,
      size: size as ProviderImageGenerationRequest['size'],
      model: provider.model,
    });
    return {
      provider: provider.provider,
      model: result.model,
      prompt,
      size: result.size,
      dataUrl: `data:${result.mimeType};base64,${result.imageBase64}`,
    };
  }

  const response = await fetch(buildOpenAICompatibleImagesUrl(provider.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      prompt,
      size,
      response_format: 'b64_json',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Image generation failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
  const dataUrl = await dataUrlFromResponsePayload(payload);
  return {
    provider: provider.provider,
    model: provider.model,
    prompt,
    size,
    dataUrl,
  };
}

export async function generateProviderImage(
  request: ProviderImageGenerationRequest,
  config: AIProviderConfig = loadAIConfig(),
): Promise<ProviderImageGenerationResponse> {
  const size = request.size || '512x512';
  const prompt = request.prompt.trim();
  if (!prompt) {
    throw new Error('prompt is required');
  }

  const primary = resolveProviderImageConfig(request.provider, config);
  if (!primary) {
    if (request.allowFallback !== false && request.provider !== 'openai-api') {
      const fallback = resolveProviderImageConfig('openai-api', config);
      if (fallback) {
        const result = await generateWithProvider(fallback, prompt, size);
        return { ...result, fallbackProvider: fallback.provider };
      }
    }
    throw new Error(`Provider ${request.provider} is not configured for image generation`);
  }

  try {
    return await generateWithProvider(primary, prompt, size);
  } catch (error) {
    if (request.allowFallback !== false && request.provider !== 'openai-api') {
      const fallback = resolveProviderImageConfig('openai-api', config);
      if (fallback) {
        log.warn(
          {
            provider: request.provider,
            fallbackProvider: fallback.provider,
            error: error instanceof Error ? error.message : String(error),
          },
          'Primary image provider failed, falling back to openai-api',
        );
        const result = await generateWithProvider(fallback, prompt, size);
        return { ...result, fallbackProvider: fallback.provider };
      }
    }
    throw error;
  }
}

export function listImageCapableProviders(config: AIProviderConfig = loadAIConfig()): AIProviderId[] {
  return AI_PROVIDER_IDS.filter((provider) => providerSupportsImageGeneration(provider, config));
}
