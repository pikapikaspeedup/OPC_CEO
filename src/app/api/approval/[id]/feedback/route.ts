/**
 * Approval Feedback API — One-Click Approval via Signed Link
 *
 * POST /api/approval/[id]/feedback?action=approve&token=<hmac>
 * GET  /api/approval/[id]/feedback?action=approve&token=<hmac>
 *
 * This endpoint is accessed from one-click approval links sent via IM/Webhook.
 * The token is an HMAC signature that validates the action without login.
 *
 * Supports both GET (browser click) and POST (API call).
 *
 * Security:
 * - HMAC token verification (24h TTL)
 * - Action must match token
 * - Request must be in 'pending' or 'feedback' status
 */

import { handleApprovalFeedback } from '@/server/control-plane/routes/approval';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>
}

// Both GET and POST use the same logic
export async function GET(req: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleApprovalFeedback(req, id);
}

export async function POST(req: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleApprovalFeedback(req, id);
}
