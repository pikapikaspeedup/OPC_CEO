import { handleDepartmentsDigestGet } from '@/server/control-plane/routes/departments';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// GET /api/departments/digest?workspace=<encoded_uri>&date=2026-01-15&period=day|week|month
export async function GET(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleDepartmentsDigestGet(req);
}
