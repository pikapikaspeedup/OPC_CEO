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

import * as crypto from 'crypto';
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
} from './request-store';
import { dispatchNotifications, dispatchFeedbackNotification } from './dispatcher';

const log = createLogger('ApprovalHandler');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

let config: ApprovalConfig = {
  gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:3000',
  hmacSecret: process.env.APPROVAL_HMAC_SECRET || 'default-dev-secret',
  channels: ['web'],
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
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${requestId}:${action}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', config.hmacSecret).update(payload).digest('hex');
  // Include timestamp in token for expiry check
  return `${timestamp}.${hmac}`;
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
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const timestamp = parseInt(parts[0], 10);
  if (isNaN(timestamp)) return false;

  // Check expiry (24 hours)
  const now = Math.floor(Date.now() / 1000);
  if (now - timestamp > 86400) return false;

  // Verify HMAC
  const payload = `${requestId}:${action}:${timestamp}`;
  const expected = crypto.createHmac('sha256', config.hmacSecret).update(payload).digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(parts[1], 'hex'),
    Buffer.from(expected, 'hex'),
  );
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

  // Dispatch notifications (non-blocking)
  const deliveries = await dispatchNotifications(request);
  request.notifications = deliveries;

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
