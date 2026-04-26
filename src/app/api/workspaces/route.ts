import { handleWorkspacesGet } from '@/server/control-plane/routes/workspaces';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

const DEFAULT_REQUEST = new Request('http://localhost/api/workspaces');

export async function GET(req: Request = DEFAULT_REQUEST) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleWorkspacesGet();
}
