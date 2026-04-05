/**
 * Shared `CodexMCPClient` singleton for API routes.
 *
 * The `codex mcp-server` process is long-lived so that thread IDs from
 * `POST /api/codex/sessions` remain valid when calling
 * `POST /api/codex/sessions/[threadId]`.
 *
 * The client is stored on `globalThis` so it survives Next.js hot-reloads in
 * development without spawning duplicate server processes.
 */

import { CodexMCPClient } from '@/lib/bridge/codex-adapter';
import { createLogger } from '@/lib/logger';

const log = createLogger('CodexMCPClientSingleton');

declare global {
  // eslint-disable-next-line no-var
  var __ag_codex_mcp: { client: CodexMCPClient; cwd: string | undefined } | undefined;
}

/**
 * Return the shared `CodexMCPClient`, starting it first if necessary.
 * If the requested `cwd` differs from the running instance's `cwd`, the old
 * process is stopped and a fresh one is started.
 */
export async function getOrStartMCPClient(cwd?: string): Promise<CodexMCPClient> {
  const existing = globalThis.__ag_codex_mcp;

  if (existing) {
    if (existing.cwd === cwd) return existing.client;
    // cwd changed — restart
    log.info({ oldCwd: existing.cwd, newCwd: cwd }, 'cwd changed, restarting MCP server');
    existing.client.stop();
    globalThis.__ag_codex_mcp = undefined;
  }

  log.info({ cwd }, 'Starting codex mcp-server');
  const client = new CodexMCPClient();
  await client.start(cwd);
  globalThis.__ag_codex_mcp = { client, cwd };
  return client;
}
