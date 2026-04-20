import { streamQueryWithRetry, type RetryOptions, FallbackTriggeredError } from './retry';
import type { QueryOptions, StreamEvent, ModelConfig } from './types';
import type { RetryEvent } from './retry';

// ─── Types ──────────────────────────────────────────────────────────

export type ProviderEntry = {
  /** Provider name (used for logging) */
  name: string;
  /** Model configuration for this provider */
  model: ModelConfig;
  /** Optional retry options override for this provider */
  retryOptions?: Partial<RetryOptions>;
};

export type ProviderFallbackConfig = {
  /** Ordered list of providers to try (first = primary, rest = fallbacks) */
  providers: ProviderEntry[];
  /** Max consecutive failures on a provider before trying the next */
  maxFailuresBeforeFallback?: number;
  /** Whether to propagate model-level FallbackTriggeredError to trigger provider switch */
  catchModelFallback?: boolean;
};

export type ProviderFallbackEvent = {
  type: 'provider_fallback';
  fromProvider: string;
  toProvider: string;
  fromModel: string;
  toModel: string;
  reason: string;
  attemptIndex: number;
};

export type ProviderStreamEvent = StreamEvent | RetryEvent | ProviderFallbackEvent;

// ─── Default config ─────────────────────────────────────────────────

const DEFAULT_MAX_FAILURES = 1;

// ─── Provider Fallback Chain ────────────────────────────────────────

/**
 * Wraps `streamQueryWithRetry` with provider-level fallback.
 *
 * When a provider exhausts all retries, the next provider in the chain is tried.
 * Model-level FallbackTriggeredError can optionally trigger a provider switch too.
 *
 * Flow:
 * 1. Try primary provider (providers[0])
 * 2. If all retries fail → yield provider_fallback event → try providers[1]
 * 3. Continue until a provider succeeds or all providers are exhausted
 */
export async function* streamQueryWithProviderFallback(
  baseQueryOptions: Omit<QueryOptions, 'model'>,
  config: ProviderFallbackConfig,
  retryOptions: RetryOptions = {},
): AsyncGenerator<ProviderStreamEvent> {
  const { providers, maxFailuresBeforeFallback = DEFAULT_MAX_FAILURES, catchModelFallback = true } = config;

  if (providers.length === 0) {
    throw new Error('ProviderFallbackChain: at least one provider is required');
  }

  let lastError: unknown = null;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!;
    const queryOptions: QueryOptions = {
      ...baseQueryOptions,
      model: provider.model,
    };

    const mergedRetryOptions: RetryOptions = {
      ...retryOptions,
      ...provider.retryOptions,
    };

    let failures = 0;

    // Allow multiple attempts per provider if maxFailuresBeforeFallback > 1
    while (failures < maxFailuresBeforeFallback) {
      try {
        const stream = streamQueryWithRetry(queryOptions, mergedRetryOptions);

        for await (const event of stream) {
          yield event;
        }

        // Success — return
        return;
      } catch (error) {
        failures++;
        lastError = error;

        // Model-level fallback: optionally catch and move to next provider
        if (catchModelFallback && error instanceof FallbackTriggeredError) {
          // Try to find the next provider
          if (i < providers.length - 1) {
            const nextProvider = providers[i + 1]!;
            yield {
              type: 'provider_fallback',
              fromProvider: provider.name,
              toProvider: nextProvider.name,
              fromModel: provider.model.model,
              toModel: nextProvider.model.model,
              reason: `Model fallback triggered: ${error.originalModel} overloaded`,
              attemptIndex: i + 1,
            };
            break; // Break inner loop, move to next provider in outer loop
          }
          // No more providers — throw
          throw error;
        }

        // Other errors: if more failures allowed, retry whole provider
        if (failures < maxFailuresBeforeFallback) {
          continue;
        }

        // Provider exhausted: try next provider
        if (i < providers.length - 1) {
          const nextProvider = providers[i + 1]!;
          yield {
            type: 'provider_fallback',
            fromProvider: provider.name,
            toProvider: nextProvider.name,
            fromModel: provider.model.model,
            toModel: nextProvider.model.model,
            reason: error instanceof Error ? error.message : String(error),
            attemptIndex: i + 1,
          };
          break; // Move to next provider
        }

        // All providers exhausted
        throw error;
      }
    }
  }

  // Should not reach here, but if it does, throw last error
  if (lastError) {
    throw lastError;
  }
}

// ─── Utilities ──────────────────────────────────────────────────────

/**
 * Build a provider chain from environment variables.
 * Returns configured providers ordered by priority.
 */
export function buildProviderChainFromEnv(): ProviderEntry[] {
  const chain: ProviderEntry[] = [];

  // Primary: from env
  const primaryProvider = detectPrimaryProvider();
  const primaryEntry = buildProviderEntry(primaryProvider);
  if (primaryEntry) {
    chain.push(primaryEntry);
  }

  // Fallback providers: add others that have API keys configured
  const allProviders = ['anthropic', 'openai', 'gemini', 'grok'] as const;
  for (const p of allProviders) {
    if (p === primaryProvider) continue;
    const entry = buildProviderEntry(p);
    if (entry) {
      chain.push(entry);
    }
  }

  return chain;
}

function detectPrimaryProvider(): string {
  if (process.env.CLAUDE_CODE_USE_OPENAI === '1') return 'openai';
  if (process.env.CLAUDE_CODE_USE_GEMINI === '1') return 'gemini';
  if (process.env.CLAUDE_CODE_USE_GROK === '1') return 'grok';
  return 'anthropic';
}

function buildProviderEntry(provider: string): ProviderEntry | null {
  switch (provider) {
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return null;
      return {
        name: 'anthropic',
        model: {
          model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
          apiKey,
          provider: 'anthropic',
        },
      };
    }
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return null;
      return {
        name: 'openai',
        model: {
          model: process.env.OPENAI_MODEL ?? 'gpt-4o',
          apiKey,
          baseUrl: process.env.OPENAI_BASE_URL,
          provider: 'openai',
        },
      };
    }
    case 'gemini': {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return null;
      return {
        name: 'gemini',
        model: {
          model: process.env.GEMINI_MODEL ?? 'gemini-2.5-pro',
          apiKey,
          provider: 'gemini',
        },
      };
    }
    case 'grok': {
      const apiKey = process.env.XAI_API_KEY ?? process.env.GROK_API_KEY;
      if (!apiKey) return null;
      return {
        name: 'grok',
        model: {
          model: process.env.GROK_MODEL ?? 'grok-3',
          apiKey,
          provider: 'grok',
        },
      };
    }
    default:
      return null;
  }
}
