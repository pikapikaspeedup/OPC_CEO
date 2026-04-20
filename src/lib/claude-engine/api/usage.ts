import type { TokenUsage } from './types';

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-3-7-sonnet-20250219': { input: 3, output: 15 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
  'claude-3-5-haiku-latest': { input: 0.8, output: 4 },
};

export class UsageTracker {
  private totalUsage: TokenUsage;

  constructor() {
    this.totalUsage = createEmptyUsage();
  }

  /** 累加一次 API 调用的 usage */
  add(usage: TokenUsage): void {
    this.totalUsage = {
      input_tokens: this.totalUsage.input_tokens + usage.input_tokens,
      output_tokens: this.totalUsage.output_tokens + usage.output_tokens,
      cache_creation_input_tokens:
        (this.totalUsage.cache_creation_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0),
      cache_read_input_tokens:
        (this.totalUsage.cache_read_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0),
    };
  }

  /** 获取累计 usage */
  getTotal(): Readonly<TokenUsage> {
    return Object.freeze({ ...this.totalUsage });
  }

  /** 重置 */
  reset(): void {
    this.totalUsage = createEmptyUsage();
  }

  /** 估算 USD 费用（使用模型定价） */
  estimateCost(model: string): number {
    const pricing = findModelPricing(model);

    if (!pricing) {
      return 0;
    }

    const billableInputTokens =
      this.totalUsage.input_tokens +
      (this.totalUsage.cache_creation_input_tokens ?? 0);

    return (
      (billableInputTokens / 1_000_000) * pricing.input +
      (this.totalUsage.output_tokens / 1_000_000) * pricing.output
    );
  }
}

function createEmptyUsage(): TokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

function findModelPricing(model: string): { input: number; output: number } | undefined {
  const normalizedModel = model.toLowerCase();

  if (MODEL_PRICING[normalizedModel]) {
    return MODEL_PRICING[normalizedModel];
  }

  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (normalizedModel.startsWith(key) || normalizedModel.includes(key)) {
      return pricing;
    }
  }

  if (normalizedModel.includes('opus')) {
    return MODEL_PRICING['claude-opus-4-20250514'];
  }

  if (normalizedModel.includes('sonnet')) {
    return MODEL_PRICING['claude-sonnet-4-20250514'];
  }

  if (normalizedModel.includes('haiku')) {
    return MODEL_PRICING['claude-3-5-haiku-latest'];
  }

  return undefined;
}