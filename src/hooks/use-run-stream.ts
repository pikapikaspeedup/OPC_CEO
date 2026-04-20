'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface UseRunStreamOptions {
  runId: string | undefined;
  enabled?: boolean;
}

interface RunStreamState {
  text: string;
  isStreaming: boolean;
  events: Array<{ type: string; data: Record<string, unknown>; timestamp: string }>;
}

/**
 * Hook to subscribe to a run's SSE stream for real-time text deltas.
 */
export function useRunStream({ runId, enabled = true }: UseRunStreamOptions): RunStreamState {
  const [text, setText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [events, setEvents] = useState<RunStreamState['events']>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!runId || !enabled) {
      cleanup();
      return;
    }

    cleanup();
    setText('');
    setEvents([]);

    const es = new EventSource(`/api/agent-runs/${encodeURIComponent(runId)}/stream`);
    eventSourceRef.current = es;

    es.addEventListener('connected', () => {
      setIsStreaming(true);
    });

    es.addEventListener('text_delta', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.text) {
          setText((prev) => prev + data.text);
        }
      } catch { /* ignore */ }
    });

    es.addEventListener('tool_start', (e) => {
      try {
        const data = JSON.parse(e.data);
        setEvents((prev) => [...prev, { type: 'tool_start', data, timestamp: new Date().toISOString() }]);
      } catch { /* ignore */ }
    });

    es.addEventListener('tool_end', (e) => {
      try {
        const data = JSON.parse(e.data);
        setEvents((prev) => [...prev, { type: 'tool_end', data, timestamp: new Date().toISOString() }]);
      } catch { /* ignore */ }
    });

    es.addEventListener('completed', () => {
      setIsStreaming(false);
      cleanup();
    });

    es.addEventListener('failed', () => {
      setIsStreaming(false);
      cleanup();
    });

    es.onerror = () => {
      setIsStreaming(false);
      cleanup();
    };

    return cleanup;
  }, [runId, enabled, cleanup]);

  return { text, isStreaming, events };
}
