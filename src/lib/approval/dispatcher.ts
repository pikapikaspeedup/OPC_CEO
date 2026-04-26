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
import { publishApprovalNotificationEvent } from './notification-events';

const log = createLogger('Dispatcher');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

  if (action === 'publish-growth-proposal' && typeof callback.payload.proposalId === 'string') {
    const { publishGrowthProposal } = await import('../company-kernel/growth-publisher');
    await Promise.resolve(publishGrowthProposal(callback.payload.proposalId, { force: true }));
    return;
  }

  if (action === 'reject-growth-proposal' && typeof callback.payload.proposalId === 'string') {
    const { rejectGrowthProposal } = await import('../company-kernel/growth-evaluator');
    await Promise.resolve(rejectGrowthProposal(
      callback.payload.proposalId,
      request.response?.message,
    ));
    return;
  }

  if (action === 'approve-system-improvement-proposal' && typeof callback.payload.proposalId === 'string') {
    const { approveSystemImprovementProposal } = await import('../company-kernel/self-improvement-approval');
    await Promise.resolve(approveSystemImprovementProposal(callback.payload.proposalId));
    return;
  }

  if (action === 'reject-system-improvement-proposal' && typeof callback.payload.proposalId === 'string') {
    const { rejectSystemImprovementProposal } = await import('../company-kernel/self-improvement-approval');
    await Promise.resolve(rejectSystemImprovementProposal(
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
export async function dispatchNotifications(
  request: ApprovalRequest,
  channelIds?: string[],
): Promise<NotificationDelivery[]> {
  const channels = getEnabledChannels(channelIds);
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
        error: getErrorMessage(result.reason),
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
 * @param request — The updated request with CEO's response.
 */
export async function dispatchFeedbackNotification(request: ApprovalRequest): Promise<void> {
  if (!request.response) return;

  const event = publishApprovalNotificationEvent({
    type: 'approval_response',
    request,
  });

  log.info({
    requestId: request.id,
    eventId: event.id,
    action: request.response.action,
    workspace: request.workspace,
  }, 'Feedback notification published');

  await executeCustomCallback(request);
}
