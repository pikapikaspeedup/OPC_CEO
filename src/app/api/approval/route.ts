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

import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// GET /api/approval
export async function GET(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleApprovalListGet } = await import('@/server/control-plane/routes/approval');
    return handleApprovalListGet(req);
  })
}

// POST /api/approval
export async function POST(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleApprovalCreatePost } = await import('@/server/control-plane/routes/approval');
    return handleApprovalCreatePost(req);
  })
}
