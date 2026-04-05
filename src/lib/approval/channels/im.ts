/**
 * IM (Instant Messaging) Notification Channel
 *
 * Sends approval notifications via CC Connect ACP (WeChat) or other IM adapters.
 * CEO can reply directly in IM or click the approval link.
 *
 * Input:  ApprovalRequest
 * Output: NotificationResult
 *
 * Future adapters: Telegram, Slack DM, Discord DM, Feishu/Lark.
 */

import { createLogger } from '../../logger';
import type {
  ApprovalRequest,
  NotificationChannel,
  NotificationResult,
} from '../types';

const log = createLogger('IMChannel');

// ---------------------------------------------------------------------------
// IM adapter interface (pluggable per-platform)
// ---------------------------------------------------------------------------

/**
 * Generic IM adapter.
 * Implementations: CCConnectAdapter, TelegramAdapter, SlackAdapter, etc.
 */
export interface IMAdapter {
  /** Platform identifier. */
  readonly platform: string
  /** Whether this adapter is currently connected. */
  readonly connected: boolean
  /** Send a text message to the CEO. */
  sendMessage(text: string): Promise<{ messageId: string }>
  /** Send a rich card message (with buttons). */
  sendCard?(title: string, body: string, actions: { label: string; url: string }[]): Promise<{ messageId: string }>
}

// ---------------------------------------------------------------------------
// IMChannel
// ---------------------------------------------------------------------------

export class IMChannel implements NotificationChannel {
  readonly id = 'cc-connect';
  readonly enabled = true;

  private adapter: IMAdapter | null = null;

  constructor(private gatewayUrl: string) {}

  /** Register an IM adapter (called when CC Connect is available). */
  setAdapter(adapter: IMAdapter): void {
    this.adapter = adapter;
    log.info({ platform: adapter.platform }, 'IM adapter registered');
  }

  /**
   * Send notification via IM.
   *
   * Formats a rich message with:
   * - Request title and type
   * - Urgency badge
   * - One-click approval/rejection links
   *
   * TODO: Implement CC Connect ACP integration.
   */
  async send(request: ApprovalRequest): Promise<NotificationResult> {
    if (!this.adapter?.connected) {
      log.debug({ requestId: request.id }, 'IM adapter not connected, skipping');
      return { success: false, channel: this.id, error: 'IM adapter not connected' };
    }

    const urgencyEmoji: Record<string, string> = {
      low: '🟢', normal: '🔵', high: '🟠', critical: '🔴',
    };

    const approveUrl = this.getApprovalUrl(request.id) + '?action=approve';
    const rejectUrl = this.getApprovalUrl(request.id) + '?action=reject';

    // Try rich card first, fall back to text
    if (this.adapter.sendCard) {
      try {
        const result = await this.adapter.sendCard(
          `${urgencyEmoji[request.urgency] || '🔵'} CEO 审批: ${request.title}`,
          [
            `**类型**: ${request.type}`,
            `**部门**: ${request.workspace}`,
            `**描述**: ${request.description}`,
            request.runId ? `**关联 Run**: ${request.runId.slice(0, 8)}` : '',
          ].filter(Boolean).join('\n'),
          [
            { label: '✅ 批准', url: approveUrl },
            { label: '❌ 拒绝', url: rejectUrl },
            { label: '💬 查看详情', url: this.getApprovalUrl(request.id) },
          ],
        );
        return { success: true, channel: this.id, messageId: result.messageId };
      } catch (err: any) {
        log.warn({ requestId: request.id, err: err.message }, 'IM card send failed, trying text');
      }
    }

    // Fallback: plain text message
    const text = [
      `${urgencyEmoji[request.urgency] || '🔵'} CEO 审批请求: ${request.title}`,
      `类型: ${request.type} | 部门: ${request.workspace}`,
      request.description,
      '',
      `批准: ${approveUrl}`,
      `拒绝: ${rejectUrl}`,
      `详情: ${this.getApprovalUrl(request.id)}`,
    ].join('\n');

    try {
      const result = await this.adapter.sendMessage(text);
      return { success: true, channel: this.id, messageId: result.messageId };
    } catch (err: any) {
      log.error({ requestId: request.id, err: err.message }, 'IM notification failed');
      return { success: false, channel: this.id, error: err.message };
    }
  }

  /**
   * Generate approval URL.
   * CEO can click from IM to approve/reject in browser.
   */
  getApprovalUrl(requestId: string): string {
    return `${this.gatewayUrl}/approval/${requestId}`;
  }
}
