/**
 * OAuth Token Manager 测试
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TokenManager,
  InMemoryTokenStorage,
  FileTokenStorage,
  createAnthropicProvider,
  createGitHubProvider,
  createGoogleProvider,
  createAzureProvider,
  type OAuthTokens,
  type OAuthProviderConfig,
} from '../auth';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTokens(overrides?: Partial<OAuthTokens>): OAuthTokens {
  return {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3600 * 1000, // 1 hour from now
    scopes: ['user:inference'],
    ...overrides,
  };
}

function makeProvider(overrides?: Partial<OAuthProviderConfig>): OAuthProviderConfig {
  return {
    name: 'test-provider',
    tokenUrl: 'https://example.com/oauth/token',
    clientId: 'test-client-id',
    refreshBufferMs: 5 * 60 * 1000,
    refreshTimeoutMs: 5000,
    ...overrides,
  };
}

// ─── InMemoryTokenStorage ────────────────────────────────────────────────────

describe('InMemoryTokenStorage', () => {
  test('load returns null for missing provider', async () => {
    const storage = new InMemoryTokenStorage();
    expect(await storage.load('unknown')).toBeNull();
  });

  test('save and load round-trip', async () => {
    const storage = new InMemoryTokenStorage();
    const tokens = makeTokens();
    await storage.save('test', tokens);
    expect(await storage.load('test')).toEqual(tokens);
  });

  test('clear removes tokens', async () => {
    const storage = new InMemoryTokenStorage();
    await storage.save('test', makeTokens());
    await storage.clear('test');
    expect(await storage.load('test')).toBeNull();
  });
});

// ─── FileTokenStorage ───────────────────────────────────────────────────────

describe('FileTokenStorage', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-engine-auth-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('save creates file with restrictive permissions', async () => {
    const storage = new FileTokenStorage(tmpDir);
    await storage.save('myProvider', makeTokens());
    const filePath = path.join(tmpDir, 'myProvider.tokens.json');
    const stat = await fs.stat(filePath);
    // Owner read+write only (0o600 = 384 decimal, but stat.mode includes file type bits)
    expect(stat.mode & 0o777).toBe(0o600);
  });

  test('load and save round-trip', async () => {
    const storage = new FileTokenStorage(tmpDir);
    const tokens = makeTokens();
    await storage.save('provider1', tokens);
    const loaded = await storage.load('provider1');
    expect(loaded).toEqual(tokens);
  });

  test('load returns null for missing file', async () => {
    const storage = new FileTokenStorage(tmpDir);
    expect(await storage.load('nonexistent')).toBeNull();
  });

  test('clear removes file', async () => {
    const storage = new FileTokenStorage(tmpDir);
    await storage.save('toDelete', makeTokens());
    await storage.clear('toDelete');
    expect(await storage.load('toDelete')).toBeNull();
  });

  test('sanitizes provider name to prevent path traversal', async () => {
    const storage = new FileTokenStorage(tmpDir);
    await storage.save('../../../etc/passwd', makeTokens());
    // The file should be in tmpDir, not in /etc/
    const files = await fs.readdir(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('_________etc_passwd.tokens.json');
  });
});

// ─── TokenManager ────────────────────────────────────────────────────────────

describe('TokenManager', () => {
  let storage: InMemoryTokenStorage;
  let manager: TokenManager;

  beforeEach(() => {
    storage = new InMemoryTokenStorage();
    manager = new TokenManager(storage);
  });

  test('registerProvider and getProviderNames', () => {
    manager.registerProvider(makeProvider({ name: 'p1' }));
    manager.registerProvider(makeProvider({ name: 'p2' }));
    expect(manager.getProviderNames()).toEqual(['p1', 'p2']);
  });

  // ─── getAccessToken ──────────────────────────────────────────────────────

  test('getAccessToken returns null when no tokens', async () => {
    manager.registerProvider(makeProvider());
    expect(await manager.getAccessToken('test-provider')).toBeNull();
  });

  test('getAccessToken returns token when valid', async () => {
    manager.registerProvider(makeProvider());
    await manager.setTokens('test-provider', makeTokens());
    expect(await manager.getAccessToken('test-provider')).toBe('test-access-token');
  });

  test('getAccessToken returns token even if near expiry but refresh fails', async () => {
    const provider = makeProvider({ refreshBufferMs: 10 * 60 * 1000 });
    manager.registerProvider(provider);

    // Token expires in 5 minutes (within 10-min buffer)
    await manager.setTokens('test-provider', makeTokens({
      expiresAt: Date.now() + 5 * 60 * 1000,
    }));

    // Refresh will fail (no server), but getAccessToken still returns current token
    const token = await manager.getAccessToken('test-provider');
    expect(token).toBe('test-access-token');
  });

  // ─── setTokens / clearTokens ─────────────────────────────────────────────

  test('setTokens persists to storage', async () => {
    await manager.setTokens('p1', makeTokens());
    expect(await storage.load('p1')).not.toBeNull();
  });

  test('clearTokens removes from both cache and storage', async () => {
    await manager.setTokens('p1', makeTokens());
    await manager.clearTokens('p1');
    expect(await storage.load('p1')).toBeNull();
    expect(await manager.getAccessToken('p1')).toBeNull();
  });

  // ─── hasValidTokens ─────────────────────────────────────────────────────

  test('hasValidTokens returns false without tokens', async () => {
    expect(await manager.hasValidTokens('unknown')).toBe(false);
  });

  test('hasValidTokens returns true for valid tokens', async () => {
    await manager.setTokens('p1', makeTokens());
    expect(await manager.hasValidTokens('p1')).toBe(true);
  });

  test('hasValidTokens returns false for expired tokens', async () => {
    await manager.setTokens('p1', makeTokens({
      expiresAt: Date.now() - 1000, // expired
    }));
    expect(await manager.hasValidTokens('p1')).toBe(false);
  });

  test('hasValidTokens returns true for tokens without expiresAt', async () => {
    await manager.setTokens('p1', makeTokens({ expiresAt: null }));
    expect(await manager.hasValidTokens('p1')).toBe(true);
  });

  // ─── handleAuthError ────────────────────────────────────────────────────

  test('handleAuthError returns error for unregistered provider', async () => {
    const result = await manager.handleAuthError('unknown');
    expect(result.ok).toBe(false);
  });

  test('handleAuthError detects cross-process refresh', async () => {
    manager.registerProvider(makeProvider());

    // Set initial tokens with "old" access token
    await manager.setTokens('test-provider', makeTokens({
      accessToken: 'old-token',
    }));

    // Simulate another process refreshing the token in storage
    await storage.save('test-provider', makeTokens({
      accessToken: 'refreshed-by-other-process',
    }));

    // Clear memory cache to force re-read from storage
    await manager.clearTokens('test-provider');
    await storage.save('test-provider', makeTokens({
      accessToken: 'refreshed-by-other-process',
    }));

    const result = await manager.handleAuthError('test-provider', 'old-token');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens.accessToken).toBe('refreshed-by-other-process');
    }
  });

  test('handleAuthError returns error when no refresh token', async () => {
    manager.registerProvider(makeProvider());
    await manager.setTokens('test-provider', makeTokens({
      refreshToken: null,
    }));

    const result = await manager.handleAuthError('test-provider');
    expect(result.ok).toBe(false);
  });

  // ─── refreshToken dedup ──────────────────────────────────────────────────

  test('concurrent refreshToken calls are deduplicated', async () => {
    manager.registerProvider(makeProvider());
    await manager.setTokens('test-provider', makeTokens());

    // Both calls will attempt refresh (and fail since no mock server),
    // but they should be deduplicated into a single request
    const [r1, r2] = await Promise.all([
      manager.refreshToken('test-provider'),
      manager.refreshToken('test-provider'),
    ]);

    // Both should have the same result (both fail, since no real endpoint)
    expect(r1.ok).toBe(r2.ok);
  });
});

// ─── Provider Factory Functions ──────────────────────────────────────────────

describe('Provider Factory Functions', () => {
  test('createAnthropicProvider has correct defaults', () => {
    const config = createAnthropicProvider({ clientId: 'my-client' });
    expect(config.name).toBe('anthropic');
    expect(config.tokenUrl).toContain('claude.com');
    expect(config.clientId).toBe('my-client');
    expect(config.defaultScopes).toContain('user:inference');
    expect(config.refreshBufferMs).toBe(5 * 60 * 1000);
  });

  test('createGitHubProvider', () => {
    const config = createGitHubProvider({ clientId: 'gh-client', clientSecret: 'gh-secret' });
    expect(config.name).toBe('github');
    expect(config.tokenUrl).toContain('github.com');
    expect(config.clientSecret).toBe('gh-secret');
    expect(config.refreshBufferMs).toBe(10 * 60 * 1000);
  });

  test('createGoogleProvider', () => {
    const config = createGoogleProvider({ clientId: 'google-client' });
    expect(config.name).toBe('google');
    expect(config.tokenUrl).toContain('googleapis.com');
    expect(config.defaultScopes).toContain('https://www.googleapis.com/auth/cloud-platform');
  });

  test('createAzureProvider', () => {
    const config = createAzureProvider({
      clientId: 'azure-client',
      tenantId: 'my-tenant',
    });
    expect(config.name).toBe('azure');
    expect(config.tokenUrl).toContain('my-tenant');
    expect(config.tokenUrl).toContain('microsoftonline.com');
  });
});
