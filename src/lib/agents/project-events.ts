import { appendAuditEvent } from './ops-audit';

export type ProjectEvent =
  | { type: 'stage:completed'; projectId: string; stageId: string; runId: string; nodeKind?: 'stage' | 'fan-out' | 'join' }
  | { type: 'stage:failed'; projectId: string; stageId: string; runId: string; status: 'failed' | 'timeout' | 'blocked'; error?: string }
  | { type: 'project:completed'; projectId: string }
  | { type: 'branch:completed'; parentProjectId: string; parentStageId: string; branchIndex: number; subProjectId: string };

type Listener = (event: ProjectEvent) => void | Promise<void>;

const globalForProjectEvents = globalThis as unknown as {
  __AG_PROJECT_EVENT_LISTENERS__?: Map<string, Listener>;
};

const listeners = globalForProjectEvents.__AG_PROJECT_EVENT_LISTENERS__ || new Map<string, Listener>();

if (process.env.NODE_ENV !== 'production') {
  globalForProjectEvents.__AG_PROJECT_EVENT_LISTENERS__ = listeners;
}

export function onProjectEvent(listenerId: string, listener: Listener): void {
  listeners.set(listenerId, listener);
}

export function emitProjectEvent(event: ProjectEvent): void {
  // Auto-record audit event
  try {
    if (event.type === 'stage:completed') {
      appendAuditEvent({
        kind: 'stage:completed',
        projectId: event.projectId,
        stageId: event.stageId,
        message: `Stage '${event.stageId}' completed`,
        meta: { runId: event.runId },
      });
    } else if (event.type === 'project:completed') {
      appendAuditEvent({
        kind: 'stage:completed',
        projectId: event.projectId,
        message: 'Project completed',
      });
    } else if (event.type === 'branch:completed') {
      appendAuditEvent({
        kind: 'branch:completed',
        projectId: event.parentProjectId,
        stageId: event.parentStageId,
        branchIndex: event.branchIndex,
        message: `Branch ${event.branchIndex} completed (child: ${event.subProjectId})`,
      });
    }
  } catch {
    // Audit is non-critical — never block event dispatch
  }

  for (const listener of listeners.values()) {
    try {
      void listener(event);
    } catch {
      // Individual listeners are isolated from each other.
    }
  }
}
