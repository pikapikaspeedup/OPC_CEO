import { describe, expect, it } from 'vitest';

import type { AIProviderConfig } from './types';
import {
  findUnavailableProviders,
  formatProviderValidationError,
  getSelectableProviderOptions,
  isProviderAvailable,
  isCustomProviderConfigured,
  type ProviderInventory,
} from './provider-availability';

const inventory: ProviderInventory = {
  anthropic: { set: true },
  openai: { set: false },
  gemini: { set: false },
  grok: { set: false },
  providers: {
    codex: { installed: true },
    nativeCodex: { installed: true, loggedIn: false, authFilePath: null },
    claudeCode: { installed: true, loginDetected: false, command: 'claude', installSource: 'global' },
  },
};

describe('provider-availability', () => {
  it('exposes all providers and disables unavailable options', () => {
    const options = getSelectableProviderOptions(inventory, undefined);

    expect(options.map((option) => option.value)).toEqual([
      'antigravity',
      'native-codex',
      'codex',
      'claude-code',
      'claude-api',
      'openai-api',
      'gemini-api',
      'grok-api',
      'custom',
    ]);
    expect(options.find((option) => option.value === 'antigravity')?.disabled).toBe(false);
    expect(options.find((option) => option.value === 'codex')?.disabled).toBe(false);
    expect(options.find((option) => option.value === 'native-codex')).toMatchObject({
      disabled: true,
      label: expect.stringContaining('未配置'),
    });
  });

  it('keeps the current invalid provider visible but disabled', () => {
    const options = getSelectableProviderOptions(inventory, undefined, 'openai-api');
    const openai = options.find((option) => option.value === 'openai-api');

    expect(openai).toMatchObject({
      value: 'openai-api',
      disabled: true,
    });
  });

  it('treats custom provider as selectable only when profile is complete', () => {
    const incomplete: AIProviderConfig['customProvider'] = {
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
    };
    const complete: AIProviderConfig['customProvider'] = {
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
    };

    expect(isCustomProviderConfigured(incomplete)).toBe(false);
    expect(isProviderAvailable('custom', inventory, incomplete)).toBe(false);
    expect(isCustomProviderConfigured(complete)).toBe(true);
    expect(isProviderAvailable('custom', inventory, complete)).toBe(true);
  });

  it('reports every unavailable provider reference in config validation', () => {
    const config: AIProviderConfig = {
      defaultProvider: 'openai-api',
      layers: {
        executive: { provider: 'antigravity' },
        management: { provider: 'native-codex' },
      },
      scenes: {
        supervisor: { provider: 'claude-api' },
        review: { provider: 'grok-api' },
      },
    };

    const issues = findUnavailableProviders(config, inventory);

    expect(issues).toEqual([
      { path: 'defaultProvider', provider: 'openai-api' },
      { path: 'layers.management', provider: 'native-codex' },
      { path: 'scenes.review', provider: 'grok-api' },
    ]);
    expect(formatProviderValidationError(issues)).toContain('defaultProvider');
  });
});
