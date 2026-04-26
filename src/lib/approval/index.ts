/**
 * Approval Framework — Entry Point
 *
 * Re-exports all public APIs for the CEO approval system.
 */

// Types
export type {
  ApprovalRequest,
  ApprovalRequestType,
  ApprovalResponse,
  ApprovalCallback,
  ApprovalStatus,
  ApprovalUrgency,
  ApprovalConfig,
  CreateApprovalInput,
  NotificationChannel,
  NotificationDelivery,
  NotificationResult,
  TokenQuota,
  TokenUsageEvent,
} from './types';

// Handler (main entry points)
export {
  submitApprovalRequest,
  handleApprovalResponse,
  generateApprovalToken,
  verifyApprovalToken,
  setApprovalConfig,
  getApprovalConfig,
} from './handler';

// Request store
export {
  getApprovalRequest,
  listApprovalRequests,
  getRequestSummary,
  loadPersistedRequests,
  updateRequestNotifications,
} from './request-store';

// Dispatcher
export {
  dispatchNotifications,
  dispatchFeedbackNotification,
} from './dispatcher';

// Channel management
export {
  registerChannel,
  getChannel,
  getAllChannels,
  getEnabledChannels,
  initDefaultChannels,
  ensureDefaultChannels,
} from './channels';

export {
  publishApprovalNotificationEvent,
  subscribeApprovalNotificationEvents,
  listRecentApprovalNotificationEvents,
} from './notification-events';

// Token quota (placeholder)
export {
  checkTokenQuota,
  recordTokenUsage,
  shouldAutoRequestQuota,
  getQuotaSummary,
  resetDailyUsage,
} from './token-quota';
