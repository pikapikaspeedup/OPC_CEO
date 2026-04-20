/**
 * 通用 OAuth Token 管理器
 * 
 * 从 claude-code auth.ts + oauth/client.ts 提取通用模式：
 * - 双保险：请求前主动刷新 + 服务端 401 被动恢复
 * - 并发去重：同时多个请求不会重复刷新
 * - 多 Provider 支持：不只是 Anthropic，任何 OAuth2 provider 都能用
 * - 安全存储：token 持久化委托给调用方（文件/keychain/env）
 * 
 * 设计参考 claude-code：
 * - auth.ts L1195-1428: handleOAuth401Error, checkAndRefreshIfNeeded
 * - oauth/client.ts L146-200: refresh token HTTP 流程
 * - withRetry.ts L231: 认证失败的重试交互
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Unix ms timestamp when token expires */
  expiresAt: number | null;
  /** Scopes this token was issued for */
  scopes?: string[];
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
}

export interface OAuthProviderConfig {
  /** Unique provider name */
  name: string;
  /** Token endpoint URL */
  tokenUrl: string;
  /** Client ID for refresh requests */
  clientId: string;
  /** Client secret (optional, some providers use PKCE) */
  clientSecret?: string;
  /** Default scopes to request on refresh */
  defaultScopes?: string[];
  /** Buffer in ms before expiration to trigger proactive refresh (default 5 min) */
  refreshBufferMs?: number;
  /** Timeout for refresh requests in ms (default 15s) */
  refreshTimeoutMs?: number;
}

export interface TokenStorage {
  /** Read stored tokens for a provider */
  load(providerName: string): Promise<OAuthTokens | null>;
  /** Persist tokens for a provider */
  save(providerName: string, tokens: OAuthTokens): Promise<void>;
  /** Clear stored tokens for a provider */
  clear(providerName: string): Promise<void>;
}

export type RefreshResult =
  | { ok: true; tokens: OAuthTokens }
  | { ok: false; error: string };

// ─── Token Manager ───────────────────────────────────────────────────────────

export class TokenManager {
  private providers = new Map<string, OAuthProviderConfig>();
  private cachedTokens = new Map<string, OAuthTokens>();
  /** In-flight refresh promise dedup (prevents concurrent refreshes) */
  private refreshing = new Map<string, Promise<RefreshResult>>();
  private storage: TokenStorage;

  constructor(storage: TokenStorage) {
    this.storage = storage;
  }

  /**
   * Register an OAuth provider configuration.
   */
  registerProvider(config: OAuthProviderConfig): void {
    this.providers.set(config.name, config);
  }

  /**
   * Get a valid access token for the provider.
   * Will proactively refresh if close to expiration.
   * 
   * This is the main entry point for getting auth tokens before API requests.
   */
  async getAccessToken(providerName: string): Promise<string | null> {
    const tokens = await this.getTokens(providerName);
    if (!tokens) return null;

    // Proactively refresh if near expiration
    if (this.isNearExpiry(providerName, tokens)) {
      const result = await this.refreshToken(providerName);
      if (result.ok) return result.tokens.accessToken;
      // If refresh fails, return the current token (it might still work)
      return tokens.accessToken;
    }

    return tokens.accessToken;
  }

  /**
   * Handle a 401/403 auth error from the API.
   * This is the "passive recovery" path from claude-code's handleOAuth401Error.
   * 
   * Flow:
   * 1. Check if another process already refreshed (storage changed)
   * 2. If not, force refresh
   * 3. Return new tokens or error
   */
  async handleAuthError(
    providerName: string,
    failedAccessToken?: string,
  ): Promise<RefreshResult> {
    const config = this.providers.get(providerName);
    if (!config) {
      return { ok: false, error: `Provider "${providerName}" not registered` };
    }

    // Check if another process already refreshed
    const stored = await this.storage.load(providerName);
    if (stored && failedAccessToken && stored.accessToken !== failedAccessToken) {
      // Another process already refreshed — use the new token
      this.cachedTokens.set(providerName, stored);
      return { ok: true, tokens: stored };
    }

    // Force refresh
    return this.refreshToken(providerName);
  }

  /**
   * Refresh the token for a provider.
   * Deduplicates concurrent refresh calls.
   */
  async refreshToken(providerName: string): Promise<RefreshResult> {
    // Dedup: if already refreshing, wait for the in-flight promise
    const existing = this.refreshing.get(providerName);
    if (existing) return existing;

    const refreshPromise = this.doRefresh(providerName);
    this.refreshing.set(providerName, refreshPromise);

    try {
      return await refreshPromise;
    } finally {
      this.refreshing.delete(providerName);
    }
  }

  /**
   * Set tokens directly (e.g., after initial OAuth flow, or from env vars).
   */
  async setTokens(providerName: string, tokens: OAuthTokens): Promise<void> {
    this.cachedTokens.set(providerName, tokens);
    await this.storage.save(providerName, tokens);
  }

  /**
   * Clear tokens for a provider (e.g., on logout).
   */
  async clearTokens(providerName: string): Promise<void> {
    this.cachedTokens.delete(providerName);
    await this.storage.clear(providerName);
  }

  /**
   * Check if a provider has valid (non-expired) tokens.
   */
  async hasValidTokens(providerName: string): Promise<boolean> {
    const tokens = await this.getTokens(providerName);
    if (!tokens) return false;
    if (!tokens.expiresAt) return true;
    return Date.now() < tokens.expiresAt;
  }

  /**
   * Get registered provider names.
   */
  getProviderNames(): string[] {
    return [...this.providers.keys()];
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async getTokens(providerName: string): Promise<OAuthTokens | null> {
    // Memory cache first
    const cached = this.cachedTokens.get(providerName);
    if (cached) return cached;

    // Persistent storage
    const stored = await this.storage.load(providerName);
    if (stored) {
      this.cachedTokens.set(providerName, stored);
      return stored;
    }

    return null;
  }

  private isNearExpiry(providerName: string, tokens: OAuthTokens): boolean {
    if (!tokens.expiresAt || !tokens.refreshToken) return false;
    const config = this.providers.get(providerName);
    const bufferMs = config?.refreshBufferMs ?? 5 * 60 * 1000; // 5 minutes default
    return Date.now() + bufferMs >= tokens.expiresAt;
  }

  private async doRefresh(providerName: string): Promise<RefreshResult> {
    const config = this.providers.get(providerName);
    if (!config) {
      return { ok: false, error: `Provider "${providerName}" not registered` };
    }

    const tokens = await this.getTokens(providerName);
    if (!tokens?.refreshToken) {
      return { ok: false, error: 'No refresh token available' };
    }

    try {
      const result = await this.executeRefresh(config, tokens);
      if (result.ok) {
        this.cachedTokens.set(providerName, result.tokens);
        await this.storage.save(providerName, result.tokens);
      }
      return result;
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Execute the OAuth2 token refresh HTTP request.
   * Standard OAuth2 refresh_token grant.
   */
  private async executeRefresh(
    config: OAuthProviderConfig,
    currentTokens: OAuthTokens,
  ): Promise<RefreshResult> {
    const timeoutMs = config.refreshTimeoutMs ?? 15_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body: Record<string, string> = {
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refreshToken!,
        client_id: config.clientId,
      };

      if (config.clientSecret) {
        body.client_secret = config.clientSecret;
      }

      if (config.defaultScopes?.length) {
        body.scope = config.defaultScopes.join(' ');
      }

      const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return {
          ok: false,
          error: `Token refresh failed (${response.status}): ${text}`,
        };
      }

      const data: Record<string, unknown> = await response.json();
      const accessToken = data.access_token as string;
      if (!accessToken) {
        return { ok: false, error: 'No access_token in refresh response' };
      }

      const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : null;

      const newTokens: OAuthTokens = {
        accessToken,
        refreshToken: (data.refresh_token as string) ?? currentTokens.refreshToken,
        expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
        scopes: typeof data.scope === 'string' ? data.scope.split(' ') : currentTokens.scopes,
        metadata: currentTokens.metadata,
      };

      return { ok: true, tokens: newTokens };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── File-based Token Storage ────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Simple file-based token storage.
 * Each provider gets a separate JSON file in the storage directory.
 */
export class FileTokenStorage implements TokenStorage {
  constructor(private storageDir: string) {}

  async load(providerName: string): Promise<OAuthTokens | null> {
    try {
      const filePath = this.getFilePath(providerName);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as OAuthTokens;
    } catch {
      return null;
    }
  }

  async save(providerName: string, tokens: OAuthTokens): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
    const filePath = this.getFilePath(providerName);
    await fs.writeFile(filePath, JSON.stringify(tokens, null, 2), {
      mode: 0o600, // Owner-only read/write
    });
  }

  async clear(providerName: string): Promise<void> {
    try {
      await fs.unlink(this.getFilePath(providerName));
    } catch {
      // Ignore if file doesn't exist
    }
  }

  private getFilePath(providerName: string): string {
    // Sanitize provider name to prevent path traversal
    const safeName = providerName.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.storageDir, `${safeName}.tokens.json`);
  }
}

// ─── In-Memory Token Storage (for testing) ───────────────────────────────────

export class InMemoryTokenStorage implements TokenStorage {
  private store = new Map<string, OAuthTokens>();

  async load(providerName: string): Promise<OAuthTokens | null> {
    return this.store.get(providerName) ?? null;
  }

  async save(providerName: string, tokens: OAuthTokens): Promise<void> {
    this.store.set(providerName, tokens);
  }

  async clear(providerName: string): Promise<void> {
    this.store.delete(providerName);
  }
}

// ─── Pre-configured Provider Configs ─────────────────────────────────────────

/**
 * Factory for common OAuth provider configurations.
 * Call manager.registerProvider(createAnthropicProvider({ clientId: '...' }));
 */
export function createAnthropicProvider(opts: {
  clientId: string;
  tokenUrl?: string;
  scopes?: string[];
}): OAuthProviderConfig {
  return {
    name: 'anthropic',
    tokenUrl: opts.tokenUrl ?? 'https://platform.claude.com/v1/oauth/token',
    clientId: opts.clientId,
    defaultScopes: opts.scopes ?? [
      'user:inference',
      'user:profile',
      'user:read_settings',
    ],
    refreshBufferMs: 5 * 60 * 1000, // 5 minutes
    refreshTimeoutMs: 15_000,
  };
}

export function createGitHubProvider(opts: {
  clientId: string;
  clientSecret?: string;
}): OAuthProviderConfig {
  return {
    name: 'github',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    refreshBufferMs: 10 * 60 * 1000, // 10 minutes (GitHub tokens last 1 hour)
    refreshTimeoutMs: 15_000,
  };
}

export function createGoogleProvider(opts: {
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
}): OAuthProviderConfig {
  return {
    name: 'google',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    defaultScopes: opts.scopes ?? ['https://www.googleapis.com/auth/cloud-platform'],
    refreshBufferMs: 5 * 60 * 1000,
    refreshTimeoutMs: 15_000,
  };
}

export function createAzureProvider(opts: {
  clientId: string;
  tenantId: string;
  clientSecret?: string;
  scopes?: string[];
}): OAuthProviderConfig {
  return {
    name: 'azure',
    tokenUrl: `https://login.microsoftonline.com/${opts.tenantId}/oauth2/v2.0/token`,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    defaultScopes: opts.scopes ?? ['https://cognitiveservices.azure.com/.default'],
    refreshBufferMs: 5 * 60 * 1000,
    refreshTimeoutMs: 15_000,
  };
}
