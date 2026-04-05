/**
 * Webhook Notification Channel
 *
 * Sends approval notifications to external services via HTTP POST.
 * Supports arbitrary webhook endpoints (Slack, Discord, custom services).
 *
 * Input:  ApprovalRequest
 * Output: NotificationResult
 *
 * Security:
 * - HMAC signature in `X-Signature-256` header for payload verification
 * - Configurable per-webhook secrets
 */

import * as crypto from 'crypto';
import { createLogger } from '../../logger';
import type {
  ApprovalRequest,
  NotificationChannel,
  NotificationResult,
} from '../types';

const log = createLogger('WebhookChannel');

// ---------------------------------------------------------------------------
// Webhook endpoint configuration
// ---------------------------------------------------------------------------

/** A registered webhook endpoint. */
export interface WebhookEndpoint {
  /** Unique endpoint ID (e.g. 'slack-ceo', 'discord-alerts'). */
  id: string
  /** Target URL to POST to. */
  url: string
  /** HMAC secret for signing (optional). */
  secret?: string
  /** Whether this endpoint is enabled. */
  enabled: boolean
  /** Custom headers to include. */
  headers?: Record<string, string>
  /**
   * Transform function to convert ApprovalRequest to webhook-specific payload.
   * If not provided, sends the raw ApprovalRequest JSON.
   */
  transform?: (request: ApprovalRequest, approvalUrl: string) => Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Built-in transforms for popular services
// ---------------------------------------------------------------------------

/** Slack incoming webhook payload format. */
export function slackTransform(
  request: ApprovalRequest,
  approvalUrl: string,
): Record<string, unknown> {
  const urgencyEmoji: Record<string, string> = {
    low: ':large_green_circle:', normal: ':large_blue_circle:',
    high: ':large_orange_circle:', critical: ':red_circle:',
  };
  return {
    text: `${urgencyEmoji[request.urgency] || ':blue_circle:'} CEO审批: ${request.title}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*${request.title}*`,
            `类型: \`${request.type}\` | 紧急度: \`${request.urgency}\``,
            `部门: ${request.workspace}`,
            request.description,
          ].join('\n'),
        },
      },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: '✅ 批准' }, url: `${approvalUrl}?action=approve` },
          { type: 'button', text: { type: 'plain_text', text: '❌ 拒绝' }, url: `${approvalUrl}?action=reject` },
          { type: 'button', text: { type: 'plain_text', text: '💬 详情' }, url: approvalUrl },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// WebhookChannel
// ---------------------------------------------------------------------------

export class WebhookChannel implements NotificationChannel {
  readonly id = 'webhook';
  readonly enabled = true;

  private endpoints: WebhookEndpoint[] = [];

  constructor(private gatewayUrl: string) {}

  /** Register a webhook endpoint. */
  addEndpoint(endpoint: WebhookEndpoint): void {
    this.endpoints.push(endpoint);
    log.info({ endpointId: endpoint.id, url: endpoint.url.slice(0, 30) + '...' }, 'Webhook endpoint registered');
  }

  /** Remove a webhook endpoint by ID. */
  removeEndpoint(endpointId: string): void {
    this.endpoints = this.endpoints.filter(e => e.id !== endpointId);
  }

  /**
   * Send notification to all registered webhook endpoints.
   *
   * - Constructs payload (raw or transformed)
   * - Signs with HMAC if secret is configured
   * - POSTs to each enabled endpoint
   *
   * TODO: Implement actual HTTP POST (currently placeholder).
   */
  async send(request: ApprovalRequest): Promise<NotificationResult> {
    const enabledEndpoints = this.endpoints.filter(e => e.enabled);
    if (enabledEndpoints.length === 0) {
      return { success: false, channel: this.id, error: 'No webhook endpoints configured' };
    }

    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const endpoint of enabledEndpoints) {
      try {
        const approvalUrl = this.getApprovalUrl(request.id);
        const payload = endpoint.transform
          ? endpoint.transform(request, approvalUrl)
          : { ...request, approvalUrl };

        const body = JSON.stringify(payload);

        // Compute HMAC signature
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...endpoint.headers,
        };
        if (endpoint.secret) {
          const signature = crypto
            .createHmac('sha256', endpoint.secret)
            .update(body)
            .digest('hex');
          headers['X-Signature-256'] = `sha256=${signature}`;
        }

        // TODO: Replace with actual fetch/http call
        // const response = await fetch(endpoint.url, {
        //   method: 'POST',
        //   headers,
        //   body,
        // });

        log.info({
          endpointId: endpoint.id,
          requestId: request.id,
          url: endpoint.url.slice(0, 30) + '...',
        }, 'Webhook notification dispatched (placeholder)');

        results.push({ id: endpoint.id, success: true });
      } catch (err: any) {
        log.error({ endpointId: endpoint.id, err: err.message }, 'Webhook notification failed');
        results.push({ id: endpoint.id, success: false, error: err.message });
      }
    }

    const allSuccess = results.every(r => r.success);
    return {
      success: allSuccess,
      channel: this.id,
      messageId: results.map(r => r.id).join(','),
      error: allSuccess ? undefined : results.filter(r => !r.success).map(r => `${r.id}: ${r.error}`).join('; '),
    };
  }

  getApprovalUrl(requestId: string): string {
    return `${this.gatewayUrl}/approval/${requestId}`;
  }
}
