/**
 * Native Codex OAuth Token Manager
 *
 * Reads and refreshes OpenAI Codex OAuth tokens from ~/.codex/auth.json
 * (shared with the official Codex CLI and VS Code extension).
 *
 * This module enables "native login" — using the user's ChatGPT Plus/Pro
 * subscription instead of burning API credits through OPENAI_API_KEY.
 *
 * Token lifecycle:
 *   1. User runs `codex` once in their terminal → tokens stored in ~/.codex/auth.json
 *   2. We read access_token + refresh_token from that file
 *   3. Before expiry (JWT exp claim), we POST to auth.openai.com/oauth/token
 *      to rotate the access_token
 *   4. Refreshed tokens are written back to ~/.codex/auth.json so the
 *      Codex CLI stays in sync
 *
 * Reference: hermes-agent/hermes_cli/auth.py (Codex OAuth section)
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';

const log = createLogger('NativeCodexAuth');

// ─── Constants ─────────────────────────────────────────────────────────────

/** OpenAI's official OAuth Client ID (shared by Codex CLI, web, VS Code). */
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

/** OpenAI's token refresh endpoint. */
const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';

/** Refresh access_token this many seconds before JWT expiry. */
const REFRESH_SKEW_SECONDS = 120;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CodexTokens {
  access_token: string;
  refresh_token: string;
}

interface CodexAuthFile {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
  };
  last_refresh?: string;
}

// ─── Token Storage ─────────────────────────────────────────────────────────

/**
 * Resolve the path to the Codex auth file.
 * Respects CODEX_HOME env var, falls back to ~/.codex/auth.json.
 */
function getCodexAuthPath(): string {
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(process.env.HOME || '~', '.codex');
  return path.join(codexHome, 'auth.json');
}

/**
 * Read tokens from ~/.codex/auth.json.
 * Returns null if the file doesn't exist or tokens are missing.
 */
export function readCodexTokens(): CodexTokens | null {
  const authPath = getCodexAuthPath();
  try {
    if (!fs.existsSync(authPath)) {
      log.debug({ authPath }, 'Codex auth file not found');
      return null;
    }
    const raw: CodexAuthFile = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    const accessToken = raw.tokens?.access_token?.trim();
    const refreshToken = raw.tokens?.refresh_token?.trim();

    if (!accessToken || !refreshToken) {
      log.debug({ authPath }, 'Codex auth file missing access_token or refresh_token');
      return null;
    }

    return { access_token: accessToken, refresh_token: refreshToken };
  } catch (err: any) {
    log.warn({ err: err.message, authPath }, 'Failed to read Codex auth file');
    return null;
  }
}

/**
 * Write refreshed tokens back to ~/.codex/auth.json.
 * This keeps the Codex CLI and VS Code extension in sync.
 */
function writeCodexTokens(tokens: CodexTokens): void {
  const authPath = getCodexAuthPath();
  try {
    let existing: Record<string, any> = {};
    if (fs.existsSync(authPath)) {
      existing = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    }
    if (!existing.tokens || typeof existing.tokens !== 'object') {
      existing.tokens = {};
    }
    existing.tokens.access_token = tokens.access_token;
    existing.tokens.refresh_token = tokens.refresh_token;
    existing.last_refresh = new Date().toISOString();

    const dir = path.dirname(authPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(authPath, JSON.stringify(existing, null, 2), 'utf-8');
    fs.chmodSync(authPath, 0o600);
    log.debug({ authPath }, 'Wrote refreshed tokens back to Codex auth file');
  } catch (err: any) {
    log.warn({ err: err.message }, 'Failed to write tokens back to Codex auth file');
  }
}

// ─── JWT Expiry Check ──────────────────────────────────────────────────────

/**
 * Check if a JWT access token is expired or about to expire.
 * Returns true if the token should be refreshed.
 */
function isTokenExpiring(accessToken: string): boolean {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return false; // Not a JWT, use as-is

    // Decode the payload (Base64URL → JSON)
    let payload = parts[1];
    payload += '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));

    const exp = decoded.exp;
    if (!exp || typeof exp !== 'number') return false;

    const now = Math.floor(Date.now() / 1000);
    const remaining = exp - now;

    if (remaining <= 0) {
      log.info({ exp, remaining }, 'Codex access token is expired');
      return true;
    }
    if (remaining < REFRESH_SKEW_SECONDS) {
      log.info({ exp, remaining }, 'Codex access token expiring soon, will refresh');
      return true;
    }

    return false;
  } catch {
    // If we can't parse, don't force a refresh — use the token as-is
    return false;
  }
}

// ─── Token Refresh ─────────────────────────────────────────────────────────

/**
 * Refresh the Codex OAuth access token using the refresh token.
 * Returns the updated token pair, or null on failure.
 *
 * IMPORTANT: OpenAI refresh tokens are single-use. Once consumed,
 * the response includes a new refresh_token that must be stored.
 */
async function refreshTokens(currentTokens: CodexTokens): Promise<CodexTokens | null> {
  log.info('Refreshing Codex OAuth access token...');

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: currentTokens.refresh_token,
      client_id: CODEX_OAUTH_CLIENT_ID,
    });

    const response = await fetch(CODEX_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      log.error(
        { status: response.status, body: errText.slice(0, 300) },
        'Codex token refresh failed'
      );

      // Check for unrecoverable errors
      try {
        const errJson = JSON.parse(errText);
        if (
          errJson.error === 'invalid_grant' ||
          errJson.error === 'refresh_token_reused'
        ) {
          log.error(
            'Codex refresh token was invalidated. Run `codex` in your terminal to re-authenticate.'
          );
        }
      } catch {}

      return null;
    }

    const payload = await response.json();
    const newAccessToken = payload.access_token?.trim();
    if (!newAccessToken) {
      log.error('Codex token refresh response missing access_token');
      return null;
    }

    const newRefreshToken = payload.refresh_token?.trim() || currentTokens.refresh_token;

    const updated: CodexTokens = {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
    };

    // Write back to keep Codex CLI in sync
    writeCodexTokens(updated);

    log.info('Codex OAuth tokens refreshed successfully');
    return updated;
  } catch (err: any) {
    log.error({ err: err.message }, 'Codex token refresh failed with exception');
    return null;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Resolve a valid Codex access token, refreshing if necessary.
 *
 * Returns the access_token string ready for use as a Bearer token,
 * or null if no valid Codex credentials are available.
 *
 * Usage:
 * ```ts
 * const token = await resolveCodexAccessToken();
 * if (!token) throw new Error('No Codex auth — run `codex` to login');
 * ```
 */
export async function resolveCodexAccessToken(): Promise<string | null> {
  let tokens = readCodexTokens();
  if (!tokens) return null;

  // Check if the access token needs refreshing
  if (isTokenExpiring(tokens.access_token)) {
    const refreshed = await refreshTokens(tokens);
    if (!refreshed) {
      // Refresh failed — but the current token might still be valid
      // (maybe expiry check was aggressive)
      if (isTokenExpiring(tokens.access_token)) {
        log.warn('Codex access token is expired and refresh failed');
        return null;
      }
      // Current token still has some life, use it
      return tokens.access_token;
    }
    tokens = refreshed;
  }

  return tokens.access_token;
}

/**
 * Check if Codex native auth is available (tokens exist on disk).
 */
export function isNativeCodexAvailable(): boolean {
  return readCodexTokens() !== null;
}
