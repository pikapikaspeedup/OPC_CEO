import {
  listRecentApprovalNotificationEvents,
  subscribeApprovalNotificationEvents,
  type ApprovalNotificationEvent,
} from '@/lib/approval/notification-events';

function encodeSseEvent(event: ApprovalNotificationEvent): string {
  return [
    `id: ${event.id}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n');
}

export function handleApprovalEventsStream(req: Request): Response {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        controller.enqueue(encoder.encode(chunk));
      };

      send('retry: 5000\n\n');
      for (const event of listRecentApprovalNotificationEvents()) {
        send(encodeSseEvent(event));
      }

      unsubscribe = subscribeApprovalNotificationEvents((event) => {
        send(encodeSseEvent(event));
      });

      heartbeat = setInterval(() => {
        send(`: heartbeat ${Date.now()}\n\n`);
      }, 25_000);

      req.signal.addEventListener('abort', () => {
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        try {
          controller.close();
        } catch {
          // Connection may already be closed by the client.
        }
      }, { once: true });
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = null;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
