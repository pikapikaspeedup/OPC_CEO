export * from './types';
export { streamQuery, query, APIClientError } from './client';
export { streamQueryWithRetry, detectProvider, FallbackTriggeredError } from './retry';
export { toolToAPISchema, toolsToAPISchemas } from './tool-schema';
export { UsageTracker, MODEL_PRICING } from './usage';
export {
  classifyAPIError,
  formatAPIError,
  isRetryableError,
  is529Error,
  isStaleConnectionError,
  extractConnectionErrorDetails,
  getRetryAfterSeconds,
  getRateLimitResetDelayMs,
  parsePromptTooLongTokens,
  type APIErrorType,
  type ConnectionErrorDetails,
} from './errors';
export {
  getCacheControl,
  addCacheToSystemBlocks,
  addCacheBreakpoints,
  estimateCacheSavings,
  type CacheControl,
  type CachedContentBlock,
} from './caching';
export {
  TokenManager,
  FileTokenStorage,
  InMemoryTokenStorage,
  createAnthropicProvider,
  createGitHubProvider,
  createGoogleProvider,
  createAzureProvider,
  type OAuthTokens,
  type OAuthProviderConfig,
  type TokenStorage,
  type RefreshResult,
} from './auth';

// Multi-provider exports
export { streamQueryOpenAI, isOpenAIThinkingEnabled } from './openai';
export { streamQueryGemini } from './gemini';
export { streamQueryGrok } from './grok';
export { streamQueryNativeCodex } from './native-codex';
export { resolveOpenAIModel } from './openai/modelMapping';
export { resolveGeminiModel } from './gemini/modelMapping';
export { resolveGrokModel } from './grok/modelMapping';

// Provider fallback
export {
  streamQueryWithProviderFallback,
  buildProviderChainFromEnv,
  type ProviderEntry,
  type ProviderFallbackConfig,
  type ProviderFallbackEvent,
  type ProviderStreamEvent,
} from './provider-fallback';

// Prompt cache monitoring
export {
  PromptCacheMonitor,
  type PromptStateSnapshot,
  type CacheBreakCause,
  type CacheBreakEvent,
  type CacheMetrics,
} from './prompt-cache-monitor';
