/**
 * POST /api/codex/sessions
 *
 * Start a new Codex MCP session (multi-turn).
 * Uses `codex mcp-server` under the hood — the server process is shared and kept alive
 * across requests so that thread IDs remain valid for subsequent `/reply` calls.
 *
 * Request body:
 *   {
 *     prompt:            string   — Initial user prompt (required)
 *     cwd?:              string   — Working directory
 *     model?:            string   — Override model (e.g. "o3", "o4-mini")
 *     sandbox?:          "read-only" | "workspace-write" | "danger-full-access"
 *     approvalPolicy?:   "untrusted" | "on-request" | "never"
 *     baseInstructions?: string   — Replace default Codex system instructions
 *   }
 *
 * Response (200):
 *   { threadId: string; content: string }
 *
 * The returned `threadId` must be supplied to POST /api/codex/sessions/[threadId]
 * to continue the conversation.
 */

import { NextResponse } from 'next/server';
import { getOrStartMCPClient } from '@/app/api/codex/_mcp-client';
import { isCodexAvailable, type CodexSandbox, type CodexApprovalPolicy } from '@/lib/bridge/codex-adapter';
import { createLogger } from '@/lib/logger';

const log = createLogger('CodexSessionsAPI');

const ALLOWED_SANDBOXES = new Set(['read-only', 'workspace-write', 'danger-full-access']);
const ALLOWED_POLICIES  = new Set(['untrusted', 'on-request', 'never']);

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

  const { prompt, cwd, model, sandbox, approvalPolicy, baseInstructions } =
    body as Record<string, unknown>;

  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return NextResponse.json(
      { error: '"prompt" is required and must be a non-empty string' },
      { status: 422 },
    );
  }

  if (sandbox !== undefined && !ALLOWED_SANDBOXES.has(sandbox as string)) {
    return NextResponse.json(
      { error: `"sandbox" must be one of: ${[...ALLOWED_SANDBOXES].join(', ')}` },
      { status: 422 },
    );
  }

  if (approvalPolicy !== undefined && !ALLOWED_POLICIES.has(approvalPolicy as string)) {
    return NextResponse.json(
      { error: `"approvalPolicy" must be one of: ${[...ALLOWED_POLICIES].join(', ')}` },
      { status: 422 },
    );
  }

  if (!(await isCodexAvailable())) {
    return NextResponse.json(
      { error: 'Codex CLI not found in PATH. Install: npm i -g @openai/codex' },
      { status: 503 },
    );
  }

  try {
    const client = await getOrStartMCPClient(typeof cwd === 'string' ? cwd : undefined);

    log.info({ prompt: prompt.slice(0, 80), sandbox, approvalPolicy }, 'codex MCP session start');

    const result = await client.startSession(prompt.trim(), {
      cwd: typeof cwd === 'string' ? cwd : undefined,
      model: typeof model === 'string' ? model : undefined,
      sandbox: (sandbox as CodexSandbox | undefined) ?? 'workspace-write',
      approvalPolicy: (approvalPolicy as CodexApprovalPolicy | undefined) ?? 'never',
      baseInstructions: typeof baseInstructions === 'string' ? baseInstructions : undefined,
    });

    log.info({ threadId: result.threadId }, 'codex MCP session started');
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ err: msg }, 'codex MCP session start failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
