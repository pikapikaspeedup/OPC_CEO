import { handleDepartmentsQuotaGet } from '@/server/control-plane/routes/departments';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// GET /api/departments/quota?workspace=<uri>
// Returns real-time token quota and usage for a workspace.
export async function GET(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleDepartmentsQuotaGet(req);
}
