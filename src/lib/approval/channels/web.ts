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

const log = createLogger('WebChannel');

export class WebChannel implements NotificationChannel {
  readonly id = 'web';
  readonly enabled = true;

  constructor(private gatewayUrl: string) {}

  /**
   * Push notification to connected Web UI clients.
   *
   * TODO: Implement SSE/WebSocket push to frontend.
   * Currently logs the notification for debugging.
   */
  async send(request: ApprovalRequest): Promise<NotificationResult> {
    log.info({
      requestId: request.id,
      type: request.type,
      urgency: request.urgency,
      title: request.title,
    }, 'Web notification dispatched (placeholder)');

    // TODO: Push to SSE event stream or WebSocket
    // e.g. sseClients.broadcast({ type: 'approval_request', data: request })

    return {
      success: true,
      channel: this.id,
      messageId: `web-${request.id}`,
    };
  }

  /**
   * Generate approval URL for the Web UI.
   * CEO clicks this link to open the approval page.
   */
  getApprovalUrl(requestId: string): string {
    return `${this.gatewayUrl}/approval/${requestId}`;
  }
}
