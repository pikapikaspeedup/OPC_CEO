/**
 * Approval Events API
 *
 * GET /api/approval/events — Server-Sent Events stream for approval request
 * and approval response notifications.
 */

import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleApprovalEventsStream } = await import('@/server/control-plane/routes/approval-events');
    return handleApprovalEventsStream(req);
  })
}
