import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fs before importing the module
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  statSync: vi.fn().mockReturnValue({ mtimeMs: 1 }),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  }),
}));

import * as fs from 'fs';
import {
  getActiveCustomProvider,
  getCustomProviderConnections,
  resolveProvider,
  loadAIConfig,
  normalizeAIConfig,
  resolveProviderProfile,
  setAIConfig,
  resetAIConfigCache,
} from './ai-config';

describe('AI Config — resolveProvider', () => {
  beforeEach(() => {
    resetAIConfigCache();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 1 } as { mtimeMs: number });
  });

  // --- Default config ---

  it('returns antigravity by default when no config exists', () => {
    const result = resolveProvider('execution');
    expect(result.provider).toBe('antigravity');
    expect(result.source).toBe('layer');
  });

  it('returns antigravity for supervisor scene (default)', () => {
    const result = resolveProvider('supervisor');
    expect(result.provider).toBe('antigravity');
    expect(result.source).toBe('layer'); // maps to 'management' layer
  });

  it('returns antigravity for utility layer (default)', () => {
    const result = resolveProvider('code-summary');
    expect(result.provider).toBe('antigravity');
    expect(result.source).toBe('layer'); // maps to 'utility' layer
  });

  // --- Scene override ---

  it('resolves scene override with highest priority', () => {
    setAIConfig({
      defaultProvider: 'antigravity',
      scenes: {
        supervisor: { provider: 'codex' as never, model: 'o3-mini' },
      },
    });

    const result = resolveProvider('supervisor');
    expect(result.provider).toBe('native-codex');
    expect(result.model).toBe('o3-mini');
    expect(result.source).toBe('scene');
  });

  // --- Department override ---

  it('resolves department provider from .department/config.json', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
      return typeof p === 'string' && p.includes('.department/config.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ provider: 'codex' }));

    setAIConfig({ defaultProvider: 'antigravity' });

    const result = resolveProvider('execution', '/test/workspace');
    expect(result.provider).toBe('native-codex');
    expect(result.source).toBe('department');
  });

  it('scene override takes priority over department config', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
      return typeof p === 'string' && p.includes('.department/config.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ provider: 'codex' }));

    setAIConfig({
      defaultProvider: 'antigravity',
      scenes: {
        execution: { provider: 'claude-api', model: 'claude-sonnet-4' },
      },
    });

    // Even though department says 'codex', scene says 'claude-api'
    const result = resolveProvider('execution', '/test/workspace');
    expect(result.provider).toBe('claude-api');
    expect(result.source).toBe('scene');
  });

  // --- Layer config ---

  it('resolves layer-level config', () => {
    setAIConfig({
      defaultProvider: 'antigravity',
      layers: {
        management: { provider: 'codex' as never, model: 'gpt-4o' },
      },
    });

    const result = resolveProvider('supervisor'); // maps to 'management'
    expect(result.provider).toBe('native-codex');
    expect(result.model).toBe('gpt-4o');
    expect(result.source).toBe('layer');
  });

  it('resolves direct layer name', () => {
    setAIConfig({
      defaultProvider: 'native-codex',
      layers: {
        executive: { provider: 'antigravity', model: 'gemini-ultra' },
      },
    });

    const result = resolveProvider('executive');
    expect(result.provider).toBe('antigravity');
    expect(result.model).toBe('gemini-ultra');
    expect(result.source).toBe('layer');
  });

  // --- Unknown scene falls back to default ---

  it('falls back to defaultProvider for unknown scene', () => {
    setAIConfig({ defaultProvider: 'codex' as never });

    const result = resolveProvider('unknown-scene' as Parameters<typeof resolveProvider>[0]);
    expect(result.provider).toBe('native-codex');
    expect(result.source).toBe('default');
  });

  // --- Model fallback ---

  it('uses defaultModel when layer has no model', () => {
    setAIConfig({
      defaultProvider: 'antigravity',
      defaultModel: 'gemini-2.5-flash',
      layers: {
        utility: { provider: 'antigravity' },
      },
    });

    const result = resolveProvider('utility');
    expect(result.model).toBe('gemini-2.5-flash');
  });

  it('layer model overrides defaultModel', () => {
    setAIConfig({
      defaultProvider: 'antigravity',
      defaultModel: 'gemini-2.5-flash',
      layers: {
        utility: { provider: 'antigravity', model: 'gemini-nano' },
      },
    });

    const result = resolveProvider('utility');
    expect(result.model).toBe('gemini-nano');
  });
});

describe('AI Config — loadAIConfig', () => {
  beforeEach(() => {
    resetAIConfigCache();
  });

  it('returns default config when no file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadAIConfig();
    expect(config.defaultProvider).toBe('antigravity');
    expect(config.providerProfiles?.['native-codex']?.supportsImageGeneration).toBe(true);
    expect(config.providerProfiles?.['native-codex']?.imageGenerationModel).toBe('gpt-5.5');
  });

  it('loads config from file when it exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 10 } as { mtimeMs: number });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      defaultProvider: 'codex',
      defaultModel: 'gpt-4o',
      providerProfiles: {
        'native-codex': { transport: 'native' },
      },
    }));

    const config = loadAIConfig();
    expect(config.defaultProvider).toBe('native-codex');
    expect(config.defaultModel).toBe('gpt-4o');
    expect(config.providerProfiles?.['native-codex']?.transport).toBe('pi-ai');
    expect(config.providerProfiles?.['openai-api']?.transport).toBe('pi-ai');
  });

  it('caches config after first load', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 10 } as { mtimeMs: number });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      defaultProvider: 'antigravity',
    }));
    loadAIConfig();
    loadAIConfig(); // second call should use cache

    const readCalls = vi.mocked(fs.readFileSync).mock.calls.filter(
      c => typeof c[0] === 'string' && c[0].includes('ai-config.json'),
    );
    expect(readCalls.length).toBe(1);
  });

  it('reloads config when file mtime changes', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync)
      .mockReturnValueOnce({ mtimeMs: 10 } as { mtimeMs: number })
      .mockReturnValueOnce({ mtimeMs: 20 } as { mtimeMs: number });
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce(JSON.stringify({ defaultProvider: 'antigravity' }))
      .mockReturnValueOnce(JSON.stringify({ defaultProvider: 'native-codex' }));

    const first = loadAIConfig();
    const second = loadAIConfig();

    expect(first.defaultProvider).toBe('antigravity');
    expect(second.defaultProvider).toBe('native-codex');
  });

  it('resolves provider profiles with defaults and overrides', () => {
    setAIConfig({
      providerProfiles: {
        'native-codex': { transport: 'native' },
      },
    });

    expect(resolveProviderProfile('native-codex').transport).toBe('pi-ai');
    expect(resolveProviderProfile('openai-api').transport).toBe('pi-ai');
    expect(resolveProviderProfile('antigravity').authMode).toBe('runtime');
  });

  it('normalizes legacy customProvider into customProviders and active selection', () => {
    const config = normalizeAIConfig({
      defaultProvider: 'custom',
      customProvider: {
        name: 'BaogaoAI',
        baseUrl: 'https://new.baogaoai.com/v1',
        apiKey: 'sk-test',
        defaultModel: 'glm-4-flash-250414',
      },
    });

    expect(config.customProviders).toHaveLength(1);
    expect(config.activeCustomProviderId).toBe('custom-default');
    expect(getActiveCustomProvider(config)).toMatchObject({
      id: 'custom-default',
      name: 'BaogaoAI',
      baseUrl: 'https://new.baogaoai.com/v1',
    });
  });

  it('keeps explicit customProviders and materializes the active connection', () => {
    setAIConfig({
      defaultProvider: 'custom',
      customProviders: [
        { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-a', defaultModel: 'deepseek-chat' },
        { id: 'glm', name: 'BaogaoAI', baseUrl: 'https://new.baogaoai.com/v1', apiKey: 'sk-b', defaultModel: 'glm-4-flash-250414' },
      ],
      activeCustomProviderId: 'glm',
    });

    const config = loadAIConfig();
    expect(getCustomProviderConnections(config)).toHaveLength(2);
    expect(getActiveCustomProvider(config)?.id).toBe('glm');
    expect(config.customProvider?.defaultModel).toBe('glm-4-flash-250414');
  });
});
