/**
 * Web Notification Channel
 *
 * Pushes approval notifications to the Web UI via SSE / WebSocket.
 * CEO can approve/reject directly from the dashboard.
 *
 * Input:  ApprovalRequest
 * Output: NotificationResult (success + delivery metadata)
 */

import { createLogger } from '../../logger';
import type {
  ApprovalRequest,
  NotificationChannel,
  NotificationResult,
} from '../types';
import { getApprovalInboxUrl } from '../approval-urls';
import { publishApprovalNotificationEvent } from '../notification-events';

const log = createLogger('WebChannel');

export class WebChannel implements NotificationChannel {
  readonly id = 'web';
  readonly enabled = true;

  constructor(private gatewayUrl: string) {}

  async send(request: ApprovalRequest): Promise<NotificationResult> {
    const event = publishApprovalNotificationEvent({
      type: 'approval_request',
      request,
    });

    log.info({
      requestId: request.id,
      eventId: event.id,
      type: request.type,
      urgency: request.urgency,
      title: request.title,
    }, 'Web approval notification published');

    return {
      success: true,
      channel: this.id,
      messageId: event.id,
    };
  }

  /**
   * Generate approval URL for the Web UI.
   * CEO clicks this link to open the approval page.
   */
  getApprovalUrl(requestId: string): string {
    return getApprovalInboxUrl(this.gatewayUrl, requestId);
  }
}
