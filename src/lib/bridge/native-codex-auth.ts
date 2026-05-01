/**
 * Native Codex OAuth storage adapter
 *
 * `pi-ai/oauth` owns the OAuth protocol and refresh lifecycle.
 * We only own storage + compatibility with `~/.codex/auth.json`,
 * so the Codex CLI and this app can share the same login state.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { OAuthCredentials } from '@mariozechner/pi-ai/oauth';

import { createLogger } from '../logger';

const log = createLogger('NativeCodexAuth');

type CodexAuthFile = {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
  };
  last_refresh?: string;
  'openai-codex'?: OAuthCredentials;
};

type CodexStoredCredentials = {
  credentials: OAuthCredentials;
  source: 'legacy' | 'pi-ai';
  raw: CodexAuthFile;
};

function getCodexAuthPath(): string {
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(process.env.HOME || '~', '.codex');
  return path.join(codexHome, 'auth.json');
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function coercePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function decodeJwtExpiryMs(accessToken: string): number | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const payload = parts[1];
    if (!payload) {
      return null;
    }
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      exp?: unknown;
    };
    return typeof decoded.exp === 'number' && Number.isFinite(decoded.exp)
      ? decoded.exp * 1000
      : null;
  } catch {
    return null;
  }
}

function readCodexAuthFile(): CodexAuthFile | null {
  const authPath = getCodexAuthPath();
  try {
    if (!fs.existsSync(authPath)) {
      log.debug({ authPath }, 'Codex auth file not found');
      return null;
    }
    return JSON.parse(fs.readFileSync(authPath, 'utf-8')) as CodexAuthFile;
  } catch (error: unknown) {
    log.warn(
      {
        authPath,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to read Codex auth file',
    );
    return null;
  }
}

function readPiAiCredentials(raw: CodexAuthFile): OAuthCredentials | null {
  const stored = raw['openai-codex'];
  if (!stored || typeof stored !== 'object') {
    return null;
  }
  return hasText(stored.access)
    && hasText(stored.refresh)
    && typeof stored.expires === 'number'
    && Number.isFinite(stored.expires)
    ? stored
    : null;
}

function readLegacyCredentials(raw: CodexAuthFile): OAuthCredentials | null {
  const access = raw.tokens?.access_token?.trim();
  const refresh = raw.tokens?.refresh_token?.trim();
  if (!access || !refresh) {
    return null;
  }
  const expires = coercePositiveNumber(raw.tokens?.expires_at) ?? decodeJwtExpiryMs(access);
  return expires
    ? { access, refresh, expires }
    : null;
}

function readStoredCredentials(): CodexStoredCredentials | null {
  const raw = readCodexAuthFile();
  if (!raw) {
    return null;
  }

  const piAiCredentials = readPiAiCredentials(raw);
  if (piAiCredentials) {
    return {
      credentials: piAiCredentials,
      source: 'pi-ai',
      raw,
    };
  }

  const legacyCredentials = readLegacyCredentials(raw);
  if (legacyCredentials) {
    return {
      credentials: legacyCredentials,
      source: 'legacy',
      raw,
    };
  }

  log.debug({ authPath: getCodexAuthPath() }, 'Codex auth file missing usable OAuth credentials');
  return null;
}

function writeStoredCredentials(
  previous: CodexAuthFile | null,
  credentials: OAuthCredentials,
): void {
  const authPath = getCodexAuthPath();
  const next: CodexAuthFile = previous && typeof previous === 'object'
    ? { ...previous }
    : {};

  next.tokens = {
    ...(next.tokens ?? {}),
    access_token: credentials.access,
    refresh_token: credentials.refresh,
    expires_at: credentials.expires,
  };
  next['openai-codex'] = credentials;
  next.last_refresh = new Date().toISOString();

  try {
    const dir = path.dirname(authPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(authPath, JSON.stringify(next, null, 2), 'utf-8');
    fs.chmodSync(authPath, 0o600);
  } catch (error: unknown) {
    log.warn(
      {
        authPath,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to persist Codex OAuth credentials',
    );
  }
}

async function getOAuthApiKeyFromPiAi(
  providerId: string,
  credentials: Record<string, OAuthCredentials>,
) {
  const { getOAuthApiKey } = await import('@mariozechner/pi-ai/oauth');
  return getOAuthApiKey(providerId, credentials);
}

export async function resolveCodexAccessToken(): Promise<string | null> {
  const stored = readStoredCredentials();
  if (!stored) {
    return null;
  }

  const result = await getOAuthApiKeyFromPiAi('openai-codex', {
    'openai-codex': stored.credentials,
  });
  if (!result) {
    return null;
  }

  const credentialsChanged =
    result.newCredentials.access !== stored.credentials.access
    || result.newCredentials.refresh !== stored.credentials.refresh
    || result.newCredentials.expires !== stored.credentials.expires;
  if (credentialsChanged || stored.source !== 'pi-ai') {
    writeStoredCredentials(stored.raw, result.newCredentials);
  }

  return result.apiKey;
}

export function isNativeCodexAvailable(): boolean {
  return readStoredCredentials() !== null;
}
