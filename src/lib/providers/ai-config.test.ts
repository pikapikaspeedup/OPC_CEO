import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fs before importing the module
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
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
  resolveProvider,
  loadAIConfig,
  setAIConfig,
  resetAIConfigCache,
} from './ai-config';

describe('AI Config — resolveProvider', () => {
  beforeEach(() => {
    resetAIConfigCache();
    vi.mocked(fs.existsSync).mockReturnValue(false);
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
        supervisor: { provider: 'codex', model: 'o3-mini' },
      },
    });

    const result = resolveProvider('supervisor');
    expect(result.provider).toBe('codex');
    expect(result.model).toBe('o3-mini');
    expect(result.source).toBe('scene');
  });

  // --- Department override ---

  it('resolves department provider from .department/config.json', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      return typeof p === 'string' && p.includes('.department/config.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ provider: 'codex' }));

    setAIConfig({ defaultProvider: 'antigravity' });

    const result = resolveProvider('execution', '/test/workspace');
    expect(result.provider).toBe('codex');
    expect(result.source).toBe('department');
  });

  it('scene override takes priority over department config', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
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
        management: { provider: 'codex', model: 'gpt-4o' },
      },
    });

    const result = resolveProvider('supervisor'); // maps to 'management'
    expect(result.provider).toBe('codex');
    expect(result.model).toBe('gpt-4o');
    expect(result.source).toBe('layer');
  });

  it('resolves direct layer name', () => {
    setAIConfig({
      defaultProvider: 'codex',
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
    setAIConfig({ defaultProvider: 'codex' });

    const result = resolveProvider('unknown-scene' as any);
    expect(result.provider).toBe('codex');
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
  });

  it('loads config from file when it exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      defaultProvider: 'codex',
      defaultModel: 'gpt-4o',
    }));

    const config = loadAIConfig();
    expect(config.defaultProvider).toBe('codex');
    expect(config.defaultModel).toBe('gpt-4o');
  });

  it('caches config after first load', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    loadAIConfig();
    loadAIConfig(); // second call should use cache

    // existsSync called once for the config path
    // (the first call triggers the load, second uses cache)
    const calls = vi.mocked(fs.existsSync).mock.calls.filter(
      c => typeof c[0] === 'string' && c[0].includes('ai-config.json'),
    );
    expect(calls.length).toBe(1);
  });
});
