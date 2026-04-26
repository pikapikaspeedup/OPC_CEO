/**
 * Approval Handler
 *
 * Orchestrates the approval lifecycle:
 * 1. Create request → dispatch notifications
 * 2. Receive CEO response → update request → dispatch feedback
 *
 * This is the main entry point for the approval framework.
 *
 * Input:  CreateApprovalInput or CEO response (action + message)
 * Output: Updated ApprovalRequest
 */

import { createLogger } from '../logger';
import type {
  ApprovalRequest,
  ApprovalResponse,
  CreateApprovalInput,
  ApprovalConfig,
} from './types';
import {
  createApprovalRequest,
  getApprovalRequest,
  respondToRequest,
  updateRequestNotifications,
} from './request-store';
import { dispatchNotifications, dispatchFeedbackNotification } from './dispatcher';
import { ensureDefaultChannels } from './channels';
import { observeApprovalRequestForAgenda } from '../company-kernel/operating-integration';
import {
  generateApprovalToken as generateToken,
  verifyApprovalToken as verifyToken,
} from './tokens';

const log = createLogger('ApprovalHandler');

function getDefaultApprovalChannels(): string[] {
  const configured = process.env.APPROVAL_CHANNELS
    ?.split(',')
    .map((channel) => channel.trim())
    .filter(Boolean);
  if (configured?.length) return configured;
  return process.env.APPROVAL_WEBHOOK_URL ? ['web', 'webhook'] : ['web'];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

let config: ApprovalConfig = {
  gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:3000',
  hmacSecret: process.env.APPROVAL_HMAC_SECRET || 'default-dev-secret',
  channels: getDefaultApprovalChannels(),
  autoRequestQuotaThreshold: 0.8,
};

/** Update handler configuration. */
export function setApprovalConfig(newConfig: Partial<ApprovalConfig>): void {
  config = { ...config, ...newConfig };
}

/** Get current configuration. */
export function getApprovalConfig(): ApprovalConfig {
  return { ...config };
}

// ---------------------------------------------------------------------------
// HMAC Token (for one-click approval links)
// ---------------------------------------------------------------------------

/**
 * Generate a signed HMAC token for a one-click approval URL.
 *
 * Token format: `hmac(secret, requestId + action + timestamp)`
 * Valid for 24 hours.
 *
 * @param requestId — The approval request ID.
 * @param action — 'approve' | 'reject' | 'feedback'
 */
export function generateApprovalToken(requestId: string, action: string): string {
  return generateToken(requestId, action, config.hmacSecret);
}

/**
 * Verify an approval token.
 *
 * @param requestId — The approval request ID.
 * @param action — 'approve' | 'reject' | 'feedback'
 * @param token — The token from the URL.
 * @returns true if valid and not expired (24h TTL).
 */
export function verifyApprovalToken(requestId: string, action: string, token: string): boolean {
  return verifyToken(requestId, action, token, config.hmacSecret);
}

// ---------------------------------------------------------------------------
// Main Operations
// ---------------------------------------------------------------------------

/**
 * Submit a new approval request.
 *
 * 1. Creates the request in the store
 * 2. Dispatches notifications to all enabled channels
 * 3. Returns the created request with notification status
 *
 * @param input — Request details.
 * @returns The created ApprovalRequest.
 */
export async function submitApprovalRequest(input: CreateApprovalInput): Promise<ApprovalRequest> {
  const request = createApprovalRequest(input);
  try {
    observeApprovalRequestForAgenda(request);
  } catch (err: unknown) {
    log.debug({ requestId: request.id, err: err instanceof Error ? err.message : String(err) }, 'Failed to observe approval request for agenda');
  }

  ensureDefaultChannels(config.gatewayUrl);

  // Dispatch notifications (non-blocking)
  const deliveries = await dispatchNotifications(request, config.channels);
  const updated = updateRequestNotifications(request.id, deliveries);
  if (updated) {
    request.notifications = updated.notifications;
    request.updatedAt = updated.updatedAt;
  } else {
    request.notifications = deliveries;
  }

  log.info({
    requestId: request.id,
    type: request.type,
    urgency: request.urgency,
    delivered: deliveries.filter(d => d.success).length,
  }, 'Approval request submitted');

  return request;
}

/**
 * Handle CEO's response to an approval request.
 *
 * 1. Validates the request exists
 * 2. Updates the request with CEO's response
 * 3. Dispatches feedback notification to the requesting department
 *
 * @param requestId — The approval request ID.
 * @param action — 'approved' | 'rejected' | 'feedback'
 * @param message — CEO's message/reason.
 * @param channel — Which channel the response came from.
 * @returns Updated ApprovalRequest, or null if not found.
 */
export async function handleApprovalResponse(
  requestId: string,
  action: 'approved' | 'rejected' | 'feedback',
  message: string,
  channel: string = 'web',
): Promise<ApprovalRequest | null> {
  const existing = getApprovalRequest(requestId);
  if (!existing) {
    log.warn({ requestId }, 'Approval request not found');
    return null;
  }

  if (existing.status !== 'pending' && existing.status !== 'feedback') {
    log.warn({ requestId, currentStatus: existing.status }, 'Request already resolved');
    return existing;
  }

  const response: ApprovalResponse = {
    action,
    message,
    respondedAt: new Date().toISOString(),
    channel,
  };

  const updated = respondToRequest(requestId, response);
  if (!updated) return null;
  try {
    observeApprovalRequestForAgenda(updated);
  } catch (err: unknown) {
    log.debug({ requestId: updated.id, err: err instanceof Error ? err.message : String(err) }, 'Failed to observe approval response for agenda');
  }

  // Dispatch feedback to requesting department
  await dispatchFeedbackNotification(updated);

  log.info({
    requestId,
    action,
    channel,
    workspace: updated.workspace,
  }, 'CEO response processed');

  return updated;
}
