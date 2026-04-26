/**
 * Approval Events API
 *
 * GET /api/approval/events — Server-Sent Events stream for approval request
 * and approval response notifications.
 */

import { handleApprovalEventsStream } from '@/server/control-plane/routes/approval-events';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleApprovalEventsStream(req);
}
