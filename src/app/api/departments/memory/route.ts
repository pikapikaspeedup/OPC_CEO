import {
  handleDepartmentsMemoryGet,
  handleDepartmentsMemoryPost,
} from '@/server/control-plane/routes/departments';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// GET /api/departments/memory?workspace=<uri>[&scope=department|organization]
export async function GET(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleDepartmentsMemoryGet(req);
}

// POST /api/departments/memory?workspace=<uri>&category=<knowledge|decisions|patterns>
// Body: { content: string, source?: string }
export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleDepartmentsMemoryPost(req);
}
