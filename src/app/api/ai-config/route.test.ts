import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/providers/ai-config', () => ({
  loadAIConfig: vi.fn(() => ({ defaultProvider: 'antigravity' })),
  saveAIConfig: vi.fn(),
  resetAIConfigCache: vi.fn(),
}));

vi.mock('@/lib/providers/provider-inventory', () => ({
  getProviderInventory: vi.fn(),
}));

import { resetAIConfigCache, saveAIConfig } from '@/lib/providers/ai-config';
import { getProviderInventory } from '@/lib/providers/provider-inventory';
import { PUT } from './route';

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/ai-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/ai-config', () => {
  beforeEach(() => {
    vi.mocked(saveAIConfig).mockClear();
    vi.mocked(resetAIConfigCache).mockClear();
    vi.mocked(getProviderInventory).mockReset();
  });

  it('rejects providers that are not configured', async () => {
    vi.mocked(getProviderInventory).mockReturnValue({
      anthropic: { set: false },
      openai: { set: false },
      gemini: { set: false },
      grok: { set: false },
      providers: {
        codex: { installed: false },
        nativeCodex: { installed: false, loggedIn: false, authFilePath: null },
        claudeCode: { installed: false, loginDetected: false, command: null, installSource: null },
      },
    });

    const res = await PUT(makeRequest({
      defaultProvider: 'openai-api',
      layers: {
        executive: { provider: 'antigravity' },
      },
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({
      error: expect.stringContaining('defaultProvider'),
      issues: [{ path: 'defaultProvider', provider: 'openai-api' }],
    }));
    expect(vi.mocked(saveAIConfig)).not.toHaveBeenCalled();
  });

  it('persists config when every provider is available', async () => {
    vi.mocked(getProviderInventory).mockReturnValue({
      anthropic: { set: true },
      openai: { set: false },
      gemini: { set: false },
      grok: { set: false },
      providers: {
        codex: { installed: true },
        nativeCodex: { installed: true, loggedIn: true, authFilePath: '/tmp/auth.json' },
        claudeCode: { installed: true, loginDetected: true, command: 'claude', installSource: 'global' },
      },
    });

    const body = {
      defaultProvider: 'claude-api',
      layers: {
        executive: { provider: 'antigravity' },
        execution: { provider: 'codex' },
      },
      scenes: {
        review: { provider: 'claude-api', model: 'claude-sonnet-4-20250514' },
      },
    };

    const res = await PUT(makeRequest(body));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(vi.mocked(resetAIConfigCache)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveAIConfig)).toHaveBeenCalledWith(body);
  });
});
