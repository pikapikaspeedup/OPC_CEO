import {
  handleDepartmentsGet,
  handleDepartmentsPut,
} from '@/server/control-plane/routes/departments';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// GET /api/departments?workspace=<encoded_uri>
export async function GET(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleDepartmentsGet(req);
}

// PUT /api/departments?workspace=<encoded_uri>
export async function PUT(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleDepartmentsPut(req);
}
