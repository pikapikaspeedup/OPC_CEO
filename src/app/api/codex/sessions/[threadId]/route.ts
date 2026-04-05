/**
 * POST /api/codex/sessions/[threadId]
 *
 * Continue an existing Codex MCP session (multi-turn reply).
 *
 * URL param:
 *   threadId — The thread ID from the initial POST /api/codex/sessions response.
 *
 * Request body:
 *   {
 *     prompt: string  — The next user message (required)
 *   }
 *
 * Response (200):
 *   { threadId: string; content: string }
 */

import { NextResponse } from 'next/server';
import { getOrStartMCPClient } from '@/app/api/codex/_mcp-client';
import { isCodexAvailable } from '@/lib/bridge/codex-adapter';
import { createLogger } from '@/lib/logger';

const log = createLogger('CodexSessionReplyAPI');

export async function POST(
  req: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;

  if (!threadId || typeof threadId !== 'string') {
    return NextResponse.json({ error: 'Missing threadId in URL' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
  }

  const { prompt } = body as Record<string, unknown>;

  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return NextResponse.json(
      { error: '"prompt" is required and must be a non-empty string' },
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
    const client = await getOrStartMCPClient();

    log.info({ threadId: threadId.slice(0, 8), prompt: prompt.slice(0, 80) }, 'codex MCP reply');

    const result = await client.reply(threadId, prompt.trim());

    log.info({ threadId: result.threadId.slice(0, 8) }, 'codex MCP reply complete');
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ threadId: threadId.slice(0, 8), err: msg }, 'codex MCP reply failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
