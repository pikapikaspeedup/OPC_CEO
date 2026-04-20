/**
 * Run Event Bus — In-memory pub/sub for agent run lifecycle events.
 *
 * Allows SSE endpoints and WebSocket handlers to subscribe to
 * real-time events for a specific run (text deltas, status changes, etc.)
 */

import { EventEmitter } from 'events';
import { appendRunHistoryEntry } from './run-history';

export type RunEventType = 'text_delta' | 'status_change' | 'tool_start' | 'tool_end' | 'completed' | 'failed';

export interface RunEvent {
  type: RunEventType;
  runId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

/**
 * Emit an event for a specific run.
 */
export function emitRunEvent(event: RunEvent): void {
  appendRunHistoryEntry({
    runId: event.runId,
    eventType: `provider.${event.type}`,
    details: event.data,
  });
  emitter.emit(`run:${event.runId}`, event);
  emitter.emit('run:*', event);
}

/**
 * Subscribe to events for a specific run.
 * Returns an unsubscribe function.
 */
export function onRunEvent(
  runId: string,
  handler: (event: RunEvent) => void,
): () => void {
  const channel = `run:${runId}`;
  emitter.on(channel, handler);
  return () => {
    emitter.off(channel, handler);
  };
}

/**
 * Subscribe to events for all runs.
 * Returns an unsubscribe function.
 */
export function onAllRunEvents(
  handler: (event: RunEvent) => void,
): () => void {
  emitter.on('run:*', handler);
  return () => {
    emitter.off('run:*', handler);
  };
}
