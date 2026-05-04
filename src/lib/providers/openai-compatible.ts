function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function normalizeOpenAICompatibleBaseUrl(baseUrl: string): string {
  return trimTrailingSlash(baseUrl);
}

export function buildOpenAICompatiblePath(baseUrl: string, suffix: string): string {
  const normalized = normalizeOpenAICompatibleBaseUrl(baseUrl);
  const normalizedSuffix = suffix.startsWith('/') ? suffix : `/${suffix}`;
  if (normalized.endsWith('/v1')) {
    return `${normalized}${normalizedSuffix}`;
  }
  return `${normalized}/v1${normalizedSuffix}`;
}

export function buildOpenAICompatibleModelsUrl(baseUrl: string): string {
  return buildOpenAICompatiblePath(baseUrl, '/models');
}

export function buildOpenAICompatibleImagesUrl(baseUrl: string): string {
  return buildOpenAICompatiblePath(baseUrl, '/images/generations');
}
