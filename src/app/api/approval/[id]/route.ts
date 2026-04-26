/**
 * Approval Detail API — Get & Respond
 *
 * GET   /api/approval/[id]           — Get request details
 * PATCH /api/approval/[id]           — CEO responds (approve/reject/feedback)
 *
 * Body (PATCH):
 *   { action: 'approved' | 'rejected' | 'feedback', message: string }
 */

import {
  handleApprovalDetailGet,
  handleApprovalDetailPatch,
} from '@/server/control-plane/routes/approval';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/approval/[id]
export async function GET(req: Request, { params }: RouteParams) {
  const { id } = await params;
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleApprovalDetailGet(id);
}

// PATCH /api/approval/[id]
export async function PATCH(req: Request, { params }: RouteParams) {
  const { id } = await params;
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleApprovalDetailPatch(req, id);
}
