import { handleDepartmentsSyncPost } from '@/server/control-plane/routes/departments';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// POST /api/departments/sync?workspace=<uri>&target=<ide|all>
export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleDepartmentsSyncPost(req);
}
