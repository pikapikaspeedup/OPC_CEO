import { generateApprovalToken } from './tokens';

export type ApprovalLinkAction = 'approve' | 'reject' | 'feedback';

function normalizeGatewayUrl(gatewayUrl: string): string {
  return gatewayUrl.replace(/\/+$/, '');
}

export function getApprovalInboxUrl(gatewayUrl: string, requestId: string): string {
  const url = new URL(normalizeGatewayUrl(gatewayUrl));
  url.searchParams.set('panel', 'approvals');
  url.searchParams.set('approval', requestId);
  return url.toString();
}

export function getApprovalFeedbackUrl(
  gatewayUrl: string,
  requestId: string,
  action: ApprovalLinkAction,
): string {
  const url = new URL(`/api/approval/${encodeURIComponent(requestId)}/feedback`, normalizeGatewayUrl(gatewayUrl));
  url.searchParams.set('action', action);
  url.searchParams.set('token', generateApprovalToken(requestId, action));
  return url.toString();
}
