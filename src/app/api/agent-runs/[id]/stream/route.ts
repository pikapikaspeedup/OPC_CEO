/**
 * SSE endpoint for streaming real-time agent run events.
 *
 * GET /api/agent-runs/[id]/stream
 *
 * Returns a Server-Sent Events stream with events:
 * - text_delta: Incremental text from LLM
 * - status_change: Run status transitions
 * - tool_start / tool_end: Tool execution events
 * - completed / failed: Terminal events (stream closes after)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRun } from '@/lib/agents/run-registry';
import { onRunEvent, type RunEvent } from '@/lib/agents/run-events';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ runId: id, status: run.status })}\n\n`),
      );

      // Subscribe to run events
      const unsubscribe = onRunEvent(id, (event: RunEvent) => {
        try {
          const sseEvent = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
          controller.enqueue(encoder.encode(sseEvent));

          // Close stream on terminal events
          if (event.type === 'completed' || event.type === 'failed') {
            setTimeout(() => {
              unsubscribe();
              try {
                controller.close();
              } catch { /* already closed */ }
            }, 100);
          }
        } catch {
          // Controller may be closed
          unsubscribe();
        }
      });

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 30_000);

      // Clean up when client disconnects
      _req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
