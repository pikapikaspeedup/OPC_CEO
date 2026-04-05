/**
 * POST /api/codex
 *
 * Execute a task via Codex CLI (non-interactive `codex exec` mode).
 *
 * Request body:
 *   {
 *     prompt:          string  — Task description (required)
 *     cwd?:            string  — Working directory (default: process.cwd())
 *     model?:          string  — Override model (e.g. "o3", "o4-mini")
 *     sandbox?:        "read-only" | "workspace-write" | "danger-full-access"
 *     timeoutMs?:      number  — Max milliseconds to wait (0 = unlimited)
 *   }
 *
 * Response (200):
 *   { output: string }
 *
 * Error (422 / 500):
 *   { error: string }
 *
 * This endpoint is intentionally minimal. For multi-turn sessions use the
 * MCP Server mode: `codex mcp-server` + `CodexMCPClient` from the bridge.
 */

import { NextResponse } from 'next/server';
import { codexExec, isCodexAvailable, type CodexSandbox } from '@/lib/bridge/codex-adapter';
import { createLogger } from '@/lib/logger';

const log = createLogger('CodexAPI');

const ALLOWED_SANDBOXES: Set<string> = new Set(['read-only', 'workspace-write', 'danger-full-access']);

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
  }

  const { prompt, cwd, model, sandbox, timeoutMs } = body as Record<string, unknown>;

  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return NextResponse.json({ error: '"prompt" is required and must be a non-empty string' }, { status: 422 });
  }

  if (sandbox !== undefined && !ALLOWED_SANDBOXES.has(sandbox as string)) {
    return NextResponse.json(
      { error: `"sandbox" must be one of: ${[...ALLOWED_SANDBOXES].join(', ')}` },
      { status: 422 },
    );
  }

  if (!(await isCodexAvailable())) {
    return NextResponse.json(
      { error: 'Codex CLI is not installed or not found in PATH. Install with: npm i -g @openai/codex' },
      { status: 503 },
    );
  }

  try {
    log.info({ prompt: prompt.slice(0, 80), sandbox, model }, 'codex exec start');

    const output = await codexExec(prompt.trim(), {
      cwd: typeof cwd === 'string' ? cwd : undefined,
      model: typeof model === 'string' ? model : undefined,
      sandbox: (sandbox as CodexSandbox | undefined) ?? 'read-only',
      timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : 0,
    });

    log.info({ chars: output.length }, 'codex exec complete');
    return NextResponse.json({ output });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ err: msg }, 'codex exec failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
