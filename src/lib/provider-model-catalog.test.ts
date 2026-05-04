import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./bridge/gateway', () => ({
  tryAllServers: vi.fn(),
  grpc: {
    getModelConfigs: vi.fn(),
  },
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('provider-model-catalog', () => {
  const originalHome = process.env.HOME;
  let tempHome = '';

  beforeEach(async () => {
    vi.resetModules();
    tempHome = mkdtempSync(path.join(tmpdir(), 'ag-provider-models-'));
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (tempHome) {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('returns pi-ai registry models for native-codex', async () => {
    const { setAIConfig } = await import('./providers/ai-config');
    const { getProviderModelCatalog } = await import('./provider-model-catalog');

    setAIConfig({
      defaultProvider: 'antigravity',
      providerProfiles: {
        'native-codex': { transport: 'pi-ai' },
      },
    });

    const entry = await getProviderModelCatalog({ provider: 'native-codex', refresh: true });

    expect(entry.provider).toBe('native-codex');
    expect(entry.source).toBe('pi-registry');
    expect(entry.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'gpt-5.5', supportsImageGeneration: true }),
      ]),
    );
  }, 15000);

  it('falls back to manual custom model when discovery config is incomplete', async () => {
    const { setAIConfig } = await import('./providers/ai-config');
    const { getProviderModelCatalog } = await import('./provider-model-catalog');

    setAIConfig({
      defaultProvider: 'custom',
      customProvider: {
        defaultModel: 'qwen2.5-coder:14b',
      },
    });

    const entry = await getProviderModelCatalog({ provider: 'custom', refresh: true });

    expect(entry.provider).toBe('custom');
    expect(entry.source).toBe('manual');
    expect(entry.models).toEqual([
      expect.objectContaining({ id: 'qwen2.5-coder:14b' }),
    ]);
  });
});
