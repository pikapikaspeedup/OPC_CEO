/**
 * Approval API — List & Create
 *
 * GET  /api/approval                 — List all approval requests (filterable)
 * POST /api/approval                 — Submit a new approval request
 *
 * Query params (GET):
 *   status=pending|approved|rejected|feedback
 *   workspace=<uri>
 *   type=token_increase|tool_access|...
 *
 * Body (POST): CreateApprovalInput
 */

import {
  handleApprovalCreatePost,
  handleApprovalListGet,
} from '@/server/control-plane/routes/approval';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// GET /api/approval
export async function GET(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleApprovalListGet(req);
}

// POST /api/approval
export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleApprovalCreatePost(req);
}
