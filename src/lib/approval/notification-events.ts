import type { ApprovalRequest } from './types';

export type ApprovalNotificationEventType = 'approval_request' | 'approval_response';

export interface ApprovalNotificationEvent {
  id: string;
  type: ApprovalNotificationEventType;
  requestId: string;
  request: ApprovalRequest;
  createdAt: string;
}

type ApprovalNotificationListener = (event: ApprovalNotificationEvent) => void;

const globalForApprovalEvents = globalThis as unknown as {
  __AG_APPROVAL_NOTIFICATION_LISTENERS__?: Set<ApprovalNotificationListener>;
  __AG_APPROVAL_NOTIFICATION_RECENT__?: ApprovalNotificationEvent[];
  __AG_APPROVAL_NOTIFICATION_SEQ__?: number;
};

const listeners = globalForApprovalEvents.__AG_APPROVAL_NOTIFICATION_LISTENERS__ || new Set<ApprovalNotificationListener>();
const recentEvents = globalForApprovalEvents.__AG_APPROVAL_NOTIFICATION_RECENT__ || [];
let sequence = globalForApprovalEvents.__AG_APPROVAL_NOTIFICATION_SEQ__ || 0;

if (process.env.NODE_ENV !== 'production') {
  globalForApprovalEvents.__AG_APPROVAL_NOTIFICATION_LISTENERS__ = listeners;
  globalForApprovalEvents.__AG_APPROVAL_NOTIFICATION_RECENT__ = recentEvents;
  globalForApprovalEvents.__AG_APPROVAL_NOTIFICATION_SEQ__ = sequence;
}

export function publishApprovalNotificationEvent(input: {
  type: ApprovalNotificationEventType;
  request: ApprovalRequest;
}): ApprovalNotificationEvent {
  sequence += 1;
  globalForApprovalEvents.__AG_APPROVAL_NOTIFICATION_SEQ__ = sequence;

  const event: ApprovalNotificationEvent = {
    id: `${Date.now()}-${sequence}`,
    type: input.type,
    requestId: input.request.id,
    request: input.request,
    createdAt: new Date().toISOString(),
  };

  recentEvents.push(event);
  while (recentEvents.length > 50) {
    recentEvents.shift();
  }

  for (const listener of listeners) {
    listener(event);
  }

  return event;
}

export function subscribeApprovalNotificationEvents(listener: ApprovalNotificationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listRecentApprovalNotificationEvents(limit = 20): ApprovalNotificationEvent[] {
  return recentEvents.slice(-limit);
}
