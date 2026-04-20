/**
 * Notification Dispatcher
 *
 * Sends approval notifications through all enabled channels.
 * Tracks delivery status on the request.
 *
 * Input:  ApprovalRequest
 * Output: Updated request with notification delivery results
 */

import { createLogger } from '../logger';
import type { ApprovalRequest, NotificationDelivery } from './types';
import { getEnabledChannels } from './channels';

const log = createLogger('Dispatcher');

async function executeCustomCallback(request: ApprovalRequest): Promise<void> {
  const callback = request.response?.action === 'approved'
    ? request.onApproved
    : request.response?.action === 'rejected'
      ? request.onRejected
      : request.onFeedback;

  if (!callback) return;

  if (callback.type !== 'custom') {
    log.info({
      requestId: request.id,
      callbackType: callback.type,
    }, 'Approval callback recorded without runtime executor');
    return;
  }

  const action = typeof callback.payload.action === 'string' ? callback.payload.action : '';
  if (action === 'publish-evolution-proposal' && typeof callback.payload.proposalId === 'string') {
    const { publishEvolutionProposal } = await import('../evolution/publisher');
    await Promise.resolve(publishEvolutionProposal(callback.payload.proposalId));
    return;
  }

  if (action === 'reject-evolution-proposal' && typeof callback.payload.proposalId === 'string') {
    const { rejectEvolutionProposal } = await import('../evolution/publisher');
    await Promise.resolve(rejectEvolutionProposal(
      callback.payload.proposalId,
      request.response?.message,
    ));
    return;
  }

  log.warn({
    requestId: request.id,
    callbackType: callback.type,
    action,
  }, 'Unsupported approval callback action');
}

/**
 * Dispatch notifications for a new or updated approval request.
 *
 * Sends to all enabled channels in parallel.
 * Updates the request's `notifications` array with delivery results.
 *
 * @param request — The approval request to notify about.
 * @returns Array of delivery results.
 */
export async function dispatchNotifications(request: ApprovalRequest): Promise<NotificationDelivery[]> {
  const channels = getEnabledChannels();
  if (channels.length === 0) {
    log.warn({ requestId: request.id }, 'No enabled notification channels');
    return [];
  }

  const deliveries: NotificationDelivery[] = [];

  // Send to all channels in parallel
  const results = await Promise.allSettled(
    channels.map(async (channel) => {
      const result = await channel.send(request);
      const delivery: NotificationDelivery = {
        channel: channel.id,
        success: result.success,
        messageId: result.messageId,
        sentAt: new Date().toISOString(),
        error: result.error,
      };
      return delivery;
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      deliveries.push(result.value);
    } else {
      deliveries.push({
        channel: 'unknown',
        success: false,
        sentAt: new Date().toISOString(),
        error: result.reason?.message || 'Unknown error',
      });
    }
  }

  log.info({
    requestId: request.id,
    total: channels.length,
    success: deliveries.filter(d => d.success).length,
    failed: deliveries.filter(d => !d.success).length,
  }, 'Notifications dispatched');

  return deliveries;
}

/**
 * Dispatch a follow-up notification (e.g. CEO's feedback → agent).
 *
 * TODO: Implement agent notification after CEO responds.
 * This would send a message back to the requesting department/agent.
 *
 * @param request — The updated request with CEO's response.
 */
export async function dispatchFeedbackNotification(request: ApprovalRequest): Promise<void> {
  if (!request.response) return;

  log.info({
    requestId: request.id,
    action: request.response.action,
    workspace: request.workspace,
  }, 'Feedback notification dispatched (placeholder)');

  await executeCustomCallback(request);
}
