import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetOAuthApiKey } = vi.hoisted(() => ({
  mockGetOAuthApiKey: vi.fn(),
}));

vi.mock('@mariozechner/pi-ai/oauth', () => ({
  getOAuthApiKey: (...args: unknown[]) => mockGetOAuthApiKey(...args),
}));

describe('native-codex-auth', () => {
  const originalCodexHome = process.env.CODEX_HOME;
  let tempDir = '';

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(path.join(tmpdir(), 'ag-native-codex-auth-'));
    process.env.CODEX_HOME = tempDir;
  });

  afterEach(() => {
    if (originalCodexHome !== undefined) {
      process.env.CODEX_HOME = originalCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reads legacy ~/.codex/auth.json tokens and delegates refresh policy to pi-ai/oauth', async () => {
    const accessToken = [
      'header',
      Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
      'signature',
    ].join('.');
    writeFileSync(
      path.join(tempDir, 'auth.json'),
      JSON.stringify({
        tokens: {
          access_token: accessToken,
          refresh_token: 'refresh-token',
        },
      }),
      'utf-8',
    );

    mockGetOAuthApiKey.mockResolvedValue({
      newCredentials: {
        access: accessToken,
        refresh: 'refresh-token',
        expires: Date.now() + 3600_000,
      },
      apiKey: accessToken,
    });

    const { resolveCodexAccessToken, isNativeCodexAvailable } = await import('./native-codex-auth');

    expect(isNativeCodexAvailable()).toBe(true);
    await expect(resolveCodexAccessToken()).resolves.toBe(accessToken);
    expect(mockGetOAuthApiKey).toHaveBeenCalledWith('openai-codex', {
      'openai-codex': expect.objectContaining({
        access: accessToken,
        refresh: 'refresh-token',
      }),
    });
  });

  it('persists refreshed credentials back to shared auth.json', async () => {
    writeFileSync(
      path.join(tempDir, 'auth.json'),
      JSON.stringify({
        tokens: {
          access_token: 'old-access',
          refresh_token: 'old-refresh',
          expires_at: Date.now() - 1000,
        },
      }),
      'utf-8',
    );

    mockGetOAuthApiKey.mockResolvedValue({
      newCredentials: {
        access: 'new-access',
        refresh: 'new-refresh',
        expires: Date.now() + 7200_000,
      },
      apiKey: 'new-access',
    });

    const { resolveCodexAccessToken } = await import('./native-codex-auth');

    await expect(resolveCodexAccessToken()).resolves.toBe('new-access');

    const saved = JSON.parse(readFileSync(path.join(tempDir, 'auth.json'), 'utf-8')) as {
      tokens: { access_token: string; refresh_token: string; expires_at: number };
      'openai-codex': { access: string; refresh: string; expires: number };
    };
    expect(saved.tokens.access_token).toBe('new-access');
    expect(saved.tokens.refresh_token).toBe('new-refresh');
    expect(saved.tokens.expires_at).toBeGreaterThan(Date.now());
    expect(saved['openai-codex']).toMatchObject({
      access: 'new-access',
      refresh: 'new-refresh',
    });
  });
});
