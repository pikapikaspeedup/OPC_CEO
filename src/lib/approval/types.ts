/**
 * CEO Approval Framework — Core Types
 *
 * Defines the data model for approval requests, notification channels,
 * and callback actions.
 *
 * Design:
 * - ApprovalRequest: the canonical request object
 * - ApprovalCallback: what to do when approved/rejected/feedback
 * - NotificationChannel: pluggable channel interface (Web, IM, Webhook, ...)
 * - TokenQuota: department-level token budget (placeholder)
 */

// ---------------------------------------------------------------------------
// Approval Request
// ---------------------------------------------------------------------------

/** Types of CEO-level approval requests. */
export type ApprovalRequestType =
  | 'token_increase'     // 部门请求增加 Token 配额
  | 'tool_access'        // 请求新增工具/MCP 权限
  | 'provider_change'    // 请求切换 Provider
  | 'scope_extension'    // 请求扩展写入范围
  | 'pipeline_approval'  // Pipeline 阶段卡点审批
  | 'proposal_publish'   // Evolution proposal 发布审批
  | 'other';

export type ApprovalUrgency = 'low' | 'normal' | 'high' | 'critical';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'feedback';

/** CEO's response to a request. */
export interface ApprovalResponse {
  action: 'approved' | 'rejected' | 'feedback'
  message: string
  respondedAt: string
  /** Which channel the CEO responded through. */
  channel: string
}

/** Callback action triggered after approval decision. */
export interface ApprovalCallback {
  type: 'update_quota' | 'resume_run' | 'notify_agent' | 'custom'
  payload: Record<string, unknown>
}

/** Canonical approval request. */
export interface ApprovalRequest {
  id: string
  type: ApprovalRequestType
  /** Workspace URI that originated the request (identifies the department). */
  workspace: string
  /** Associated run ID, if any. */
  runId?: string
  /** Short title for notifications. */
  title: string
  /** Detailed description. */
  description: string
  urgency: ApprovalUrgency
  status: ApprovalStatus
  createdAt: string
  updatedAt: string

  /** CEO's response. */
  response?: ApprovalResponse

  /** Action to execute when approved. */
  onApproved?: ApprovalCallback
  /** Action to execute when rejected. */
  onRejected?: ApprovalCallback
  /** Action to execute when feedback is given. */
  onFeedback?: ApprovalCallback

  /** Notification delivery status per channel. */
  notifications?: NotificationDelivery[]
}

/** Input for creating a new request. */
export interface CreateApprovalInput {
  type: ApprovalRequestType
  workspace: string
  runId?: string
  title: string
  description: string
  urgency?: ApprovalUrgency
  onApproved?: ApprovalCallback
  onRejected?: ApprovalCallback
  onFeedback?: ApprovalCallback
}

// ---------------------------------------------------------------------------
// Notification Channel
// ---------------------------------------------------------------------------

/** Per-channel delivery record. */
export interface NotificationDelivery {
  channel: string
  success: boolean
  messageId?: string
  sentAt: string
  error?: string
}

/** Result from sending a notification. */
export interface NotificationResult {
  success: boolean
  channel: string
  messageId?: string
  error?: string
}

/**
 * Pluggable notification channel.
 *
 * Implementations: WebChannel, IMChannel, WebhookChannel.
 * Future: EmailChannel, SlackChannel, DiscordChannel, etc.
 */
export interface NotificationChannel {
  /** Unique channel identifier (e.g. 'web', 'cc-connect', 'webhook-slack'). */
  readonly id: string
  /** Whether this channel is currently enabled. */
  readonly enabled: boolean

  /**
   * Send a notification about a new or updated approval request.
   *
   * @param request — The approval request to notify about.
   * @returns Delivery result (success/failure + optional messageId).
   */
  send(request: ApprovalRequest): Promise<NotificationResult>

  /**
   * Generate a one-click approval URL for this request.
   *
   * The URL contains an HMAC token so CEO can approve without logging in.
   * Example: `{gateway}/api/approval/{id}/feedback?action=approve&token={hmac}`
   *
   * @param requestId — The approval request ID.
   * @returns Fully qualified URL string.
   */
  getApprovalUrl(requestId: string): string
}

// ---------------------------------------------------------------------------
// Token Quota (placeholder types)
// ---------------------------------------------------------------------------

/** Department-level token budget. */
export interface TokenQuota {
  /** Maximum tokens per day. */
  daily: number
  /** Maximum tokens per month. */
  monthly: number
  /** Current usage. */
  used: {
    daily: number
    monthly: number
  }
  /** Whether the department can request more when exhausted. */
  canRequestMore: boolean
}

/** Token usage event for tracking. */
export interface TokenUsageEvent {
  workspace: string
  runId: string
  tokens: number
  timestamp: string
}

// ---------------------------------------------------------------------------
// Approval Framework Configuration
// ---------------------------------------------------------------------------

/** Configuration for the approval framework. */
export interface ApprovalConfig {
  /** Gateway base URL for generating approval links. */
  gatewayUrl: string
  /** HMAC secret for signing approval tokens. */
  hmacSecret: string
  /** Enabled notification channels. */
  channels: string[]
  /** Auto-request quota threshold (0-1, e.g. 0.8 = 80%). */
  autoRequestQuotaThreshold: number
}
