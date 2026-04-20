import { listRuns } from './agents/run-registry';
import { loadAIConfig } from './providers/ai-config';
import { getProviderInventory } from './providers/provider-inventory';
import type { ProviderId } from './providers/types';

export type ProviderUsageEntry = {
  provider: string;
  runCount: number;
  completedCount: number;
  activeCount: number;
  failedCount: number;
  blockedCount: number;
  cancelledCount: number;
  promptRunCount: number;
  tokenRuns: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastRunAt?: string;
};

export type ProviderUsageSummary = {
  totalRuns: number;
  providers: number;
  tokenRuns: number;
  totalTokens: number;
  windowDays: number;
};

export type ProviderCreditSummary = {
  provider: string;
  category: 'runtime' | 'oauth' | 'api-key' | 'custom-profile';
  configured: boolean;
  usageTracked: boolean;
  note: string;
};

function isActiveStatus(status: string): boolean {
  return status === 'queued' || status === 'starting' || status === 'running';
}

function isFailedStatus(status: string): boolean {
  return status === 'failed' || status === 'timeout';
}

export function aggregateProviderUsage(windowDays = 30): {
  entries: ProviderUsageEntry[];
  summary: ProviderUsageSummary;
} {
  const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const runs = listRuns().filter((run) => new Date(run.createdAt).getTime() >= cutoffMs);
  const map = new Map<string, ProviderUsageEntry>();

  for (const run of runs) {
    const provider = run.provider || 'unknown';
    const existing = map.get(provider) || {
      provider,
      runCount: 0,
      completedCount: 0,
      activeCount: 0,
      failedCount: 0,
      blockedCount: 0,
      cancelledCount: 0,
      promptRunCount: 0,
      tokenRuns: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      lastRunAt: undefined,
    };

    existing.runCount += 1;
    if (run.status === 'completed') existing.completedCount += 1;
    if (isActiveStatus(run.status)) existing.activeCount += 1;
    if (isFailedStatus(run.status)) existing.failedCount += 1;
    if (run.status === 'blocked') existing.blockedCount += 1;
    if (run.status === 'cancelled') existing.cancelledCount += 1;
    if (run.executorKind === 'prompt') existing.promptRunCount += 1;

    if (run.tokenUsage) {
      existing.tokenRuns += 1;
      existing.inputTokens += run.tokenUsage.inputTokens;
      existing.outputTokens += run.tokenUsage.outputTokens;
      existing.totalTokens += run.tokenUsage.totalTokens;
    }

    if (!existing.lastRunAt || new Date(run.createdAt).getTime() > new Date(existing.lastRunAt).getTime()) {
      existing.lastRunAt = run.createdAt;
    }

    map.set(provider, existing);
  }

  const entries = [...map.values()].sort((a, b) => b.runCount - a.runCount || a.provider.localeCompare(b.provider));
  return {
    entries,
    summary: {
      totalRuns: entries.reduce((sum, entry) => sum + entry.runCount, 0),
      providers: entries.length,
      tokenRuns: entries.reduce((sum, entry) => sum + entry.tokenRuns, 0),
      totalTokens: entries.reduce((sum, entry) => sum + entry.totalTokens, 0),
      windowDays,
    },
  };
}

function hasApiKeyProviderConfig(provider: ProviderId, inventory: ReturnType<typeof getProviderInventory>): boolean {
  switch (provider) {
    case 'claude-api':
      return inventory.anthropic.set;
    case 'openai-api':
      return inventory.openai.set;
    case 'gemini-api':
      return inventory.gemini.set;
    case 'grok-api':
      return inventory.grok.set;
    default:
      return false;
  }
}

export function buildProviderCreditSummaries(): ProviderCreditSummary[] {
  const inventory = getProviderInventory();
  const aiConfig = loadAIConfig();

  const summaries: ProviderCreditSummary[] = [
    {
      provider: 'antigravity',
      category: 'runtime',
      configured: true,
      usageTracked: true,
      note: 'Runtime credits come from Antigravity language_server model configs.',
    },
    {
      provider: 'native-codex',
      category: 'oauth',
      configured: inventory.providers.nativeCodex.loggedIn,
      usageTracked: true,
      note: 'Uses OAuth / ChatGPT subscription. Remaining credits are not exposed via a stable public API.',
    },
  ];

  const apiProviders: ProviderId[] = ['claude-api', 'openai-api', 'gemini-api', 'grok-api'];
  for (const provider of apiProviders) {
    summaries.push({
      provider,
      category: 'api-key',
      configured: hasApiKeyProviderConfig(provider, inventory),
      usageTracked: true,
      note: 'Gateway can aggregate local run token usage, but not all vendors expose unified remaining-credit APIs.',
    });
  }

  summaries.push({
    provider: 'custom',
    category: 'custom-profile',
    configured: Boolean(aiConfig.customProvider?.baseUrl && aiConfig.customProvider?.apiKey),
    usageTracked: true,
    note: 'Usage is aggregated from local runs. Remaining credits depend on the upstream OpenAI-compatible vendor.',
  });

  return summaries;
}
