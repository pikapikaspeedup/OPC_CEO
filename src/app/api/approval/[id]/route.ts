/**
 * Approval Detail API — Get & Respond
 *
 * GET   /api/approval/[id]           — Get request details
 * PATCH /api/approval/[id]           — CEO responds (approve/reject/feedback)
 *
 * Body (PATCH):
 *   { action: 'approved' | 'rejected' | 'feedback', message: string }
 */

import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/approval/[id]
export async function GET(req: Request, { params }: RouteParams) {
  const { id } = await params;
  return runControlPlaneRoute(req, async () => {
    const { handleApprovalDetailGet } = await import('@/server/control-plane/routes/approval');
    return handleApprovalDetailGet(id);
  })
}

// PATCH /api/approval/[id]
export async function PATCH(req: Request, { params }: RouteParams) {
  const { id } = await params;
  return runControlPlaneRoute(req, async () => {
    const { handleApprovalDetailPatch } = await import('@/server/control-plane/routes/approval');
    return handleApprovalDetailPatch(req, id);
  })
}
